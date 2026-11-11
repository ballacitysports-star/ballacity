import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { notFound, redirect } from "@tanstack/react-router";
import { runWithStartContext } from "@tanstack/start-storage-context";
import {
  errorReportMiddleware,
  isReportableServerFnError,
  serverFnRoute,
} from "./error-report-middleware";

const h = vi.hoisted(() => ({
  reportServerError: vi.fn(async (..._args: unknown[]) => undefined),
  request: null as Request | null,
}));
vi.mock("@/lib/error-report.server", () => ({ reportServerError: h.reportServerError }));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (!h.request) throw new Error("No StartEvent found in AsyncLocalStorage.");
    return h.request;
  },
}));

const zodError = () => {
  try {
    z.object({ n: z.number() }).parse({ n: "x" });
  } catch (e) {
    return e;
  }
  throw new Error("expected a ZodError");
};
class AppRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiError";
  }
}
const named = (name: string, message: string) => Object.assign(new Error(message), { name });

/** Messages Postgres, PostgREST and the runtime write when something is broken. */
const FAILURES = [
  'relation "public.app_error_events" does not exist',
  "column hosted_games.joined does not exist",
  'column "joined" of relation "hosted_games" does not exist',
  "function public.is_superadmin(_user_id => uuid) does not exist",
  "operator does not exist: text = uuid",
  "Could not find the function public.admin_audit_log_facets without parameters in the schema cache",
  "Could not find the table 'public.managed_accounts' in the schema cache",
  "Could not choose the best candidate function between: public.f(a => uuid), public.f(a => text)",
  'record "new" has no field "updated_at"',
  "permission denied for table app_error_events",
  'new row violates row-level security policy for table "posts"',
  'infinite recursion detected in policy for relation "team_members"',
  'duplicate key value violates unique constraint "follows_pkey"',
  'invalid input syntax for type uuid: "abc"',
  "value too long for type character varying(120)",
  "JSON object requested, multiple (or no) rows returned",
  "canceling statement due to statement timeout",
  "deadlock detected",
  "sorry, too many clients already",
  "TypeError: fetch failed",
  "connect ECONNREFUSED 127.0.0.1:5432",
  "upstream connect error or disconnect/reset before headers",
  "<html><body><h1>502 Bad Gateway</h1></body></html>",
];

/** Refusals written for the person to read, as handlers in src/lib/*.functions.ts throw them. */
const REFUSALS = [
  "Game not found.",
  "Only owners, managers and coaches can view this.",
  "You host this game.",
  "reelId is required",
  "EVENT_FULL",
  "INVITE_EXPIRED: that invitation has expired.",
  "This player is not accepting new messages.",
  "AI is not configured yet — please try again later",
  "Something went wrong. Please try again.",
];

describe("which server-function failures are reported (P0-8)", () => {
  it.each(FAILURES)("reports a database or network failure passed on as text: %s", (message) => {
    expect(isReportableServerFnError(new Error(message))).toBe(true);
    // The same text in an error-shaped object (a PostgREST error thrown as is).
    expect(isReportableServerFnError({ message, code: "XX000" })).toBe(true);
  });

  it("reports JavaScript runtime errors and timeouts: a bug or a failed call", () => {
    expect(isReportableServerFnError(new TypeError("Cannot read properties of undefined"))).toBe(
      true,
    );
    expect(isReportableServerFnError(new ReferenceError("x is not defined"))).toBe(true);
    expect(isReportableServerFnError(new RangeError("Invalid time value"))).toBe(true);
    let parseError: unknown;
    try {
      JSON.parse("{");
    } catch (e) {
      parseError = e;
    }
    expect(isReportableServerFnError(parseError)).toBe(true);
    expect(
      isReportableServerFnError(
        new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      ),
    ).toBe(true);
  });

  it("reports what is thrown that is not an Error and has no message", () => {
    expect(isReportableServerFnError("boom")).toBe(true);
    expect(isReportableServerFnError(undefined)).toBe(true);
    expect(isReportableServerFnError({ code: "XX000" })).toBe(true);
  });

  it.each(REFUSALS)("does not report a refusal meant for the person: %s", (message) => {
    expect(isReportableServerFnError(new Error(message))).toBe(false);
    expect(isReportableServerFnError({ message, code: "P0001" })).toBe(false);
    expect(isReportableServerFnError(new AppRefusal(message))).toBe(false);
  });

  it("does not report redirects, notFound or thrown Responses", () => {
    expect(isReportableServerFnError(redirect({ to: "/" }))).toBe(false);
    expect(isReportableServerFnError(notFound())).toBe(false);
    expect(isReportableServerFnError(new Response(null, { status: 404 }))).toBe(false);
  });

  it("does not report input validation errors", () => {
    expect(isReportableServerFnError(zodError())).toBe(false);
    // A schema validator's issues, as TanStack Start throws them.
    const issues = JSON.stringify([{ code: "invalid_type", path: ["n"], message: "Required" }]);
    expect(isReportableServerFnError(new Error(issues))).toBe(false);
  });

  it("does not report auth refusals", () => {
    for (const message of [
      "Unauthorized: No request headers available",
      "Unauthorized: No authorization header provided",
      "Unauthorized: Only Bearer tokens are supported",
      "Unauthorized: No token provided",
      "Unauthorized: Invalid token",
      "Unauthorized: No user ID found in token",
      "Forbidden",
      "FORBIDDEN: admin access required.",
      "Not authenticated",
      "AUTH_REQUIRED: sign in first.",
      "NOT_SIGNED_IN",
      "JWT expired",
    ]) {
      expect(isReportableServerFnError(new Error(message)), message).toBe(false);
    }
  });

  it("does not report aborts", () => {
    expect(isReportableServerFnError(named("AbortError", "This operation was aborted"))).toBe(
      false,
    );
    expect(isReportableServerFnError(new DOMException("aborted", "AbortError"))).toBe(false);
  });

  it("no message the app writes itself is reported: every string in src, every RAISE EXCEPTION", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
      );
    // A template's ${…} and a RAISE's % become each of these in turn, so a message built from a
    // value is checked as it would read with a plain word, a qualified name, a quoted name, a call
    // signature or a number in it.
    const SAMPLES = ["x", "public.f", '"x"', "f(uuid)", "42"];
    const reportable = (texts: string[]) =>
      texts.some((t) => isReportableServerFnError(new Error(t)));

    // Every string literal in the app's own code, comments removed: not only `new Error("…")`, but
    // also the texts handlers throw from a map (ERRORS[code]), a constant, or a mapper such as
    // friendly(error.message), and whatever a helper in src/lib/*.server.ts throws for them.
    const files = walk("src").filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    const fromCode = new Set<string>();
    const reportedCode = new Set<string>();
    for (const file of files) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const quoted = [...code.matchAll(/(["'])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map((m) => [m[2]]);
      const templates = [...code.matchAll(/`((?:\\.|[^\\`])*)`/g)].map((m) => [
        m[1],
        ...SAMPLES.map((v) => m[1].replace(/\$\{[^}]*\}/g, v)),
      ]);
      for (const [literal, ...rest] of [...quoted, ...templates]) {
        fromCode.add(literal);
        if (reportable([literal, ...rest])) reportedCode.add(literal);
      }
    }
    const fromSql = new Set<string>();
    const reportedSql = new Set<string>();
    for (const file of readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"))) {
      const sql = readFileSync(join("supabase/migrations", file), "utf8");
      for (const m of sql.matchAll(/RAISE\s+EXCEPTION\s+'((?:''|[^'])*)'/gi)) {
        const message = m[1].replace(/''/g, "'");
        fromSql.add(message);
        if (reportable(SAMPLES.map((v) => message.replace(/%/g, v)))) reportedSql.add(message);
      }
    }

    // The scan really read both places: every server-function file, and refusals written each way.
    expect(files.filter((f) => /^src\/lib\/[^/]+\.functions\.ts$/.test(f)).length).toBeGreaterThan(
      60,
    );
    expect(fromCode.size).toBeGreaterThan(5000);
    expect(fromSql.size).toBeGreaterThan(300);
    expect(fromCode).toContain("Game not found."); // thrown as is
    expect(fromCode).toContain("That invitation has expired. Ask for a new link."); // from a mapper
    expect(fromCode).toContain("AI couldn't finish that. Please try again."); // from a map
    expect(fromSql).toContain("EVENT_FULL");
    expect(fromSql).toContain("Unknown sport: %");

    expect([...reportedSql]).toEqual([]);
    // The only texts of the app's own that read as a failure describe a fetch that really failed
    // (two log lines and a source's status); none of them is a refusal.
    expect([...reportedCode].sort()).toEqual(
      ["fetch failed", "[push] fetch failed", "[pay] fetch failed: ${msg}"].sort(),
    );
  });

  it("files a report under the function's name, never its opaque RPC id", () => {
    expect(serverFnRoute({ name: "superadminListErrors" })).toBe("/_serverFn/superadminListErrors");
    expect(serverFnRoute({ name: "../../x?y=1" })).toBe("/_serverFn/xy1");
    expect(serverFnRoute({ name: "" })).toBeNull();
    expect(serverFnRoute(undefined)).toBeNull();
  });
});

const meta = { id: "f00d", name: "doThing", filename: "src/lib/thing.functions.ts" };
const middlewareServer = errorReportMiddleware.options.server!;
/** Runs the middleware as TanStack would, with `next` standing for everything downstream. */
const runMiddleware = (next: () => Promise<unknown>) =>
  middlewareServer({
    next,
    serverFnMeta: meta,
    data: undefined,
    context: {},
    method: "POST",
    signal: new AbortController().signal,
  } as unknown as Parameters<typeof middlewareServer>[0]);

beforeEach(() => {
  h.reportServerError.mockReset();
  h.reportServerError.mockResolvedValue(undefined);
  h.request = new Request("https://ballacity.example/_serverFn/f00d", {
    method: "POST",
    headers: { authorization: "Bearer t" },
  });
});
afterEach(() => {
  h.request = null;
});

describe("errorReportMiddleware", () => {
  it("reports an unexpected failure as server_fn and rethrows the very same error", async () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'id')");
    await expect(runMiddleware(() => Promise.reject(error))).rejects.toBe(error);
    expect(h.reportServerError).toHaveBeenCalledTimes(1);
    expect(h.reportServerError).toHaveBeenCalledWith(error, h.request, "server_fn", {
      route: "/_serverFn/doThing",
    });
  });

  it("passes a result through untouched and reports nothing", async () => {
    const result = { result: { ok: true } };
    await expect(runMiddleware(() => Promise.resolve(result))).resolves.toBe(result);
    expect(h.reportServerError).not.toHaveBeenCalled();
  });

  it.each([
    ["a redirect", () => redirect({ to: "/auth" })],
    ["notFound", () => notFound()],
    ["a validation error", zodError],
    ["an auth refusal", () => new Error("Unauthorized: No authorization header provided")],
    ["a refusal for the person", () => new Error("Game not found.")],
    ["an abort", () => named("AbortError", "aborted")],
  ])("skips %s and rethrows it unchanged", async (_label, make) => {
    const error = make();
    await expect(runMiddleware(() => Promise.reject(error))).rejects.toBe(error);
    expect(h.reportServerError).not.toHaveBeenCalled();
  });

  it("a reporter that fails never changes what the caller gets", async () => {
    const error = new Error("canceling statement due to statement timeout");
    h.reportServerError.mockRejectedValueOnce(new Error("db down"));
    await expect(runMiddleware(() => Promise.reject(error))).rejects.toBe(error);
    h.reportServerError.mockImplementationOnce(() => {
      throw new Error("sync failure");
    });
    await expect(runMiddleware(() => Promise.reject(error))).rejects.toBe(error);
    expect(h.reportServerError).toHaveBeenCalledTimes(2);
  });

  it("reports nothing once the caller has gone", async () => {
    const aborted = new AbortController();
    aborted.abort();
    h.request = new Request("https://ballacity.example/_serverFn/f00d", {
      method: "POST",
      signal: aborted.signal,
    });
    const error = new TypeError("boom");
    await expect(runMiddleware(() => Promise.reject(error))).rejects.toBe(error);
    expect(h.reportServerError).not.toHaveBeenCalled();
  });

  it("still reports, as signed out, when there is no request to read", async () => {
    h.request = null;
    const error = new TypeError("boom");
    await expect(runMiddleware(() => Promise.reject(error))).rejects.toBe(error);
    expect(h.reportServerError).toHaveBeenCalledWith(error, null, "server_fn", {
      route: "/_serverFn/doThing",
    });
  });
});

describe("errorReportMiddleware inside TanStack Start's own server-function pipeline", () => {
  // requireSupabaseAuth's shape: a function middleware that refuses before the handler runs.
  const auth = createMiddleware({ type: "function" }).server(async ({ next }) => {
    if (!h.request?.headers.has("authorization")) {
      throw new Error("Unauthorized: No authorization header provided");
    }
    return next({ context: { userId: "u1" } });
  });

  type Executed = { result: unknown; error: unknown };
  /** A server function as the compiler emits it: handler(extractedFn, serverFn). */
  function serverFn(run: (data: { n: number }) => unknown) {
    const builder = createServerFn({ method: "POST" })
      .middleware([auth])
      .inputValidator((d: { n: number }) => z.object({ n: z.number() }).parse(d));
    const handler = builder.handler as unknown as (
      extracted: { serverFnMeta: typeof meta },
      fn: (ctx: { data: { n: number } }) => unknown,
    ) => { __executeServer: (opts: { data: unknown; context: object }) => Promise<Executed> };
    return handler({ serverFnMeta: meta }, ({ data }) => run(data));
  }
  /** Calls it the way the server does, with this file's middleware registered globally. */
  const call = (fn: ReturnType<typeof serverFn>, data: unknown) =>
    runWithStartContext(
      {
        startOptions: { functionMiddleware: [errorReportMiddleware] },
        contextAfterGlobalMiddlewares: {},
        request: h.request,
        executedRequestMiddlewares: new Set(),
      } as unknown as Parameters<typeof runWithStartContext>[0],
      () => fn.__executeServer({ data, context: {} }),
    );

  it("reports a handler's unexpected failure and returns the same error to the caller", async () => {
    const error = new TypeError("Cannot read properties of null (reading 'host_id')");
    const out = await call(
      serverFn(() => {
        throw error;
      }),
      { n: 1 },
    );
    expect(out.error).toBe(error);
    expect(h.reportServerError).toHaveBeenCalledTimes(1);
    expect(h.reportServerError).toHaveBeenCalledWith(error, h.request, "server_fn", {
      route: "/_serverFn/doThing",
    });
  });

  it("reports a database failure the handler passed on as text", async () => {
    const out = await call(
      serverFn(() => {
        throw new Error('relation "public.app_error_events" does not exist');
      }),
      { n: 1 },
    );
    expect((out.error as Error).message).toContain("does not exist");
    expect(h.reportServerError).toHaveBeenCalledTimes(1);
  });

  it("returns results untouched", async () => {
    const out = await call(
      serverFn(({ n }) => ({ doubled: n * 2 })),
      { n: 2 },
    );
    expect(out).toMatchObject({ result: { doubled: 4 }, error: undefined });
    expect(h.reportServerError).not.toHaveBeenCalled();
  });

  it("does not report bad input, an auth refusal, a refusal or a redirect", async () => {
    const ok = serverFn(() => ({ ok: true }));
    expect((await call(ok, { n: "x" })).error).toMatchObject({ name: "ZodError" });

    h.request = new Request("https://ballacity.example/_serverFn/f00d", { method: "POST" });
    expect((await call(ok, { n: 1 })).error).toMatchObject({
      message: "Unauthorized: No authorization header provided",
    });
    h.request = new Request("https://ballacity.example/_serverFn/f00d", {
      method: "POST",
      headers: { authorization: "Bearer t" },
    });

    const refusal = new Error("Game not found.");
    expect(
      (
        await call(
          serverFn(() => {
            throw refusal;
          }),
          { n: 1 },
        )
      ).error,
    ).toBe(refusal);

    const moved = redirect({ to: "/auth" });
    expect(
      (
        await call(
          serverFn(() => {
            throw moved;
          }),
          { n: 1 },
        )
      ).error,
    ).toBe(moved);

    expect(h.reportServerError).not.toHaveBeenCalled();
  });
});
