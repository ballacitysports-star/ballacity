import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertSafeE2eTarget,
  checkBaseUrl,
  documentedProductionRefs,
  E2eTargetError,
  NON_PRODUCTION_E2E_PROJECT_REFS,
  PRODUCTION_PROJECT_REFS,
  refFromJwt,
  refFromSupabaseUrl,
  resolveE2eTarget,
  verifyServedAppTarget,
} from "../../e2e/safety/target-guard";

const PROD = PRODUCTION_PROJECT_REFS[0];
const SANDBOX = NON_PRODUCTION_E2E_PROJECT_REFS[0];
const UNKNOWN = "abcdefghijklmnopqrst"; // a valid-looking ref nobody designated

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** A JWT-shaped key; the signature is junk because the guard only decodes. */
const key = (claims: Record<string, unknown>) =>
  `${b64({ alg: "HS256" })}.${b64(claims)}.sig-not-checked`;
const url = (ref: string) => `https://${ref}.supabase.co`;

const sandboxEnv = (over: Record<string, string | undefined> = {}) => ({
  E2E_BASE_URL: "http://localhost:8080",
  SUPABASE_URL: url(SANDBOX),
  VITE_SUPABASE_URL: url(SANDBOX),
  SUPABASE_PROJECT_ID: SANDBOX,
  VITE_SUPABASE_PROJECT_ID: SANDBOX,
  ...over,
});

const reasonsOf = (env: Record<string, string | undefined>, extra: string[] = []) => {
  const r = resolveE2eTarget(env, extra);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.reasons.join("\n");
};

describe("designations", () => {
  it("never lists a project as both production and sandbox", () => {
    for (const ref of NON_PRODUCTION_E2E_PROJECT_REFS)
      expect(PRODUCTION_PROJECT_REFS).not.toContain(ref);
  });

  it("blocks every production reference the repo documents", () => {
    const refs = documentedProductionRefs((p) => {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return null;
      }
    });
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(PRODUCTION_PROJECT_REFS).toContain(ref);
  });

  it("uses the sandbox that supabase/config.e2e.toml names", () => {
    const toml = readFileSync("supabase/config.e2e.toml", "utf8");
    expect(/project_id\s*=\s*"([a-z0-9]{20})"/.exec(toml)?.[1]).toBe(SANDBOX);
  });

  it("reads project ids out of config.toml and .env.production text", () => {
    const text: Record<string, string> = {
      "supabase/config.toml": 'project_id = "aaaaaaaaaaaaaaaaaaaa"\n',
      ".env.production":
        'SUPABASE_PROJECT_ID="bbbbbbbbbbbbbbbbbbbb"\nVITE_SUPABASE_PROJECT_ID="bbbbbbbbbbbbbbbbbbbb"\n',
    };
    expect(documentedProductionRefs((p) => text[p] ?? null).sort()).toEqual([
      "aaaaaaaaaaaaaaaaaaaa",
      "bbbbbbbbbbbbbbbbbbbb",
    ]);
    expect(documentedProductionRefs(() => null)).toEqual([]);
  });
});

describe("a production project is blocked", () => {
  it("by the Supabase URL", () => {
    expect(
      reasonsOf(sandboxEnv({ SUPABASE_URL: url(PROD), VITE_SUPABASE_URL: url(PROD) })),
    ).toContain("PRODUCTION");
  });

  it("by the project id alone, even beside a sandbox URL", () => {
    expect(reasonsOf(sandboxEnv({ SUPABASE_PROJECT_ID: PROD }))).toContain("PRODUCTION");
  });

  it("by the ref claim inside a key, even when the URL and id look safe", () => {
    const env = sandboxEnv({ SUPABASE_SERVICE_ROLE_KEY: key({ role: "service_role", ref: PROD }) });
    expect(reasonsOf(env)).toContain("PRODUCTION");
  });

  it("by a pre-injected browser session", () => {
    const session = JSON.stringify({
      access_token: key({ iss: `${url(PROD)}/auth/v1`, sub: "x" }),
    });
    const env = {
      E2E_BASE_URL: "http://localhost:8080",
      LOVABLE_BROWSER_SUPABASE_SESSION_JSON: session,
      LOVABLE_BROWSER_SUPABASE_STORAGE_KEY: `sb-${PROD}-auth-token`,
    };
    expect(reasonsOf(env)).toContain("PRODUCTION");
  });

  it("by a reference documented elsewhere in the repo", () => {
    const other = "zzzzzzzzzzzzzzzzzzzz";
    const env = sandboxEnv({
      SUPABASE_URL: url(other),
      VITE_SUPABASE_URL: url(other),
      SUPABASE_PROJECT_ID: other,
      VITE_SUPABASE_PROJECT_ID: other,
    });
    expect(reasonsOf(env, [other])).toContain("PRODUCTION");
  });

  it("when the sources disagree about the project", () => {
    expect(reasonsOf(sandboxEnv({ VITE_SUPABASE_URL: url(UNKNOWN) }))).toContain("disagree");
  });

  it("by a production base URL, with an otherwise safe environment", () => {
    expect(checkBaseUrl("https://ballacity.lovable.app").length).toBe(1);
    expect(reasonsOf(sandboxEnv({ E2E_BASE_URL: "https://ballacity.com" }))).toContain("not local");
  });
});

describe("an unknown or missing project is blocked", () => {
  it("when nothing is configured, because the app would fall back to production", () => {
    expect(reasonsOf({})).toContain("fall back to the production backend");
  });

  it("when only keys or ids are set and no URL", () => {
    expect(reasonsOf({ SUPABASE_PROJECT_ID: SANDBOX })).toContain("No Supabase URL");
  });

  it("when the project is real but not designated", () => {
    const env = sandboxEnv({
      SUPABASE_URL: url(UNKNOWN),
      VITE_SUPABASE_URL: url(UNKNOWN),
      SUPABASE_PROJECT_ID: UNKNOWN,
      VITE_SUPABASE_PROJECT_ID: UNKNOWN,
    });
    expect(reasonsOf(env)).toContain("not a designated E2E sandbox");
  });

  it("when the URL host cannot be identified (custom domain)", () => {
    expect(
      reasonsOf(
        sandboxEnv({ SUPABASE_URL: "https://api.example.com", VITE_SUPABASE_URL: undefined }),
      ),
    ).toContain("identify");
  });

  it("when the project ids are missing, so only the URLs name the project", () => {
    const env = {
      E2E_BASE_URL: "http://localhost:8080",
      SUPABASE_URL: url(SANDBOX),
      VITE_SUPABASE_URL: url(SANDBOX),
    };
    const text = reasonsOf(env);
    expect(text).toContain("SUPABASE_PROJECT_ID is not set");
    expect(text).toContain("VITE_SUPABASE_PROJECT_ID is not set");
  });

  it("when an injected session cannot be identified", () => {
    const env = { ...sandboxEnv(), LOVABLE_BROWSER_SUPABASE_SESSION_JSON: "not json" };
    expect(reasonsOf(env)).toContain("cannot be identified");
  });
});

describe("a verified non-production project proceeds", () => {
  it("with the URL and project id agreeing", () => {
    expect(assertSafeE2eTarget(sandboxEnv())).toEqual({ kind: "sandbox", ref: SANDBOX });
  });

  it("with keys whose ref claims agree, in addition to the URLs and ids", () => {
    const env = sandboxEnv({
      SUPABASE_PUBLISHABLE_KEY: key({ role: "anon", ref: SANDBOX }),
      SUPABASE_SERVICE_ROLE_KEY: key({ role: "service_role", ref: SANDBOX }),
    });
    expect(assertSafeE2eTarget(env)).toEqual({ kind: "sandbox", ref: SANDBOX });
  });

  it("with an injected session for the sandbox", () => {
    const session = JSON.stringify({ access_token: key({ iss: `${url(SANDBOX)}/auth/v1` }) });
    const env = sandboxEnv({
      LOVABLE_BROWSER_SUPABASE_SESSION_JSON: session,
      LOVABLE_BROWSER_SUPABASE_STORAGE_KEY: `sb-${SANDBOX}-auth-token`,
    });
    expect(assertSafeE2eTarget(env).kind).toBe("sandbox");
  });
});

describe("local-only runs keep working", () => {
  it("allows a local Supabase with the CLI's demo keys", () => {
    const env = {
      E2E_BASE_URL: "http://127.0.0.1:8080",
      SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_PUBLISHABLE_KEY: key({ iss: "supabase-demo", role: "anon" }),
      SUPABASE_SERVICE_ROLE_KEY: key({ iss: "supabase-demo", role: "service_role" }),
    };
    expect(assertSafeE2eTarget(env)).toEqual({ kind: "local" });
  });

  it("refuses a local URL that sits beside a remote project", () => {
    const env = { SUPABASE_URL: "http://localhost:54321", SUPABASE_PROJECT_ID: SANDBOX };
    expect(reasonsOf(env)).toContain("local Supabase URL");
  });
});

describe("what the error says", () => {
  it("explains the fix and never contains a credential", () => {
    const secret = "SUPER-SECRET-SERVICE-VALUE";
    const token = key({ role: "service_role", ref: PROD, note: secret });
    let err: unknown;
    try {
      assertSafeE2eTarget(
        sandboxEnv({ SUPABASE_SERVICE_ROLE_KEY: token, SUPABASE_PUBLISHABLE_KEY: secret }),
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(E2eTargetError);
    const msg = (err as Error).message;
    expect(msg).toContain("supabase start");
    expect(msg).toContain("NON_PRODUCTION_E2E_PROJECT_REFS");
    expect(msg).not.toContain(secret);
    expect(msg).not.toContain(token);
  });
});

describe("identity parsing", () => {
  it("reads refs from hosts, keys and rejects look-alikes", () => {
    expect(refFromSupabaseUrl(url(SANDBOX))).toBe(SANDBOX);
    expect(refFromSupabaseUrl("http://localhost:54321")).toBe("local");
    expect(refFromSupabaseUrl(`https://${SANDBOX}.supabase.co.evil.test`)).toBeNull();
    expect(refFromSupabaseUrl(`https://evil.test/${SANDBOX}.supabase.co`)).toBeNull();
    expect(refFromJwt(key({ ref: SANDBOX }))).toBe(SANDBOX);
    expect(refFromJwt("sb_publishable_not_a_jwt")).toBeNull();
  });
});

describe("the running app is checked too", () => {
  const app =
    (body: string, ok = true) =>
    async () => ({ ok, text: async () => body });

  it("passes when the served app names the same sandbox", async () => {
    await expect(
      verifyServedAppTarget(
        "http://localhost:8080",
        { kind: "sandbox", ref: SANDBOX },
        app(`const u="${url(SANDBOX)}"`),
      ),
    ).resolves.toBeUndefined();
  });

  it("blocks when the served app is configured for production", async () => {
    await expect(
      verifyServedAppTarget(
        "http://localhost:8080",
        { kind: "sandbox", ref: SANDBOX },
        app(`const u="${url(PROD)}"`),
      ),
    ).rejects.toThrow(PROD);
  });

  it("blocks when the served app names no project, or cannot be read", async () => {
    await expect(
      verifyServedAppTarget(
        "http://localhost:8080",
        { kind: "sandbox", ref: SANDBOX },
        app("nothing here"),
      ),
    ).rejects.toBeInstanceOf(E2eTargetError);
    await expect(
      verifyServedAppTarget(
        "http://localhost:8080",
        { kind: "sandbox", ref: SANDBOX },
        app("", false),
      ),
    ).rejects.toThrow("Could not read");
    await expect(
      verifyServedAppTarget(
        "http://localhost:8080",
        { kind: "sandbox", ref: SANDBOX },
        async () => {
          throw new Error("ECONNREFUSED");
        },
      ),
    ).rejects.toThrow("Could not read");
  });

  it("blocks a local run whose app points at a remote project", async () => {
    await expect(
      verifyServedAppTarget("http://localhost:8080", { kind: "local" }, app(`"${url(PROD)}"`)),
    ).rejects.toBeInstanceOf(E2eTargetError);
    await expect(
      verifyServedAppTarget(
        "http://localhost:8080",
        { kind: "local" },
        app(`"http://127.0.0.1:54321" supabase`),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("enforcement runs before any side effect", () => {
  const createClient = vi.fn();
  const fetchSpy = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    createClient.mockReset();
    fetchSpy.mockReset();
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));
    vi.stubGlobal("fetch", fetchSpy);
    for (const k of Object.keys(process.env)) {
      if (/SUPABASE|E2E_BASE_URL/.test(k)) vi.stubEnv(k, "");
    }
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock("@supabase/supabase-js");
  });

  const setEnv = (env: Record<string, string>) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  };

  it("global setup stops on production before it fetches, signs in, seeds or cleans up", async () => {
    setEnv({
      E2E_BASE_URL: "http://localhost:8080",
      SUPABASE_URL: url(PROD),
      SUPABASE_PROJECT_ID: PROD,
      SUPABASE_PUBLISHABLE_KEY: key({ ref: PROD }),
      SUPABASE_SERVICE_ROLE_KEY: key({ ref: PROD, role: "service_role" }),
      // The sandbox's own pass-through path must not run either.
      LOVABLE_BROWSER_SUPABASE_SESSION_JSON: JSON.stringify({
        access_token: key({ iss: `${url(PROD)}/auth/v1` }),
      }),
      LOVABLE_BROWSER_SUPABASE_STORAGE_KEY: `sb-${PROD}-auth-token`,
    });
    const { default: globalSetup } = await import("../../e2e/global-setup");
    await expect(globalSetup()).rejects.toMatchObject({ name: "E2eTargetError" });
    expect(createClient).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("global setup stops on an empty environment", async () => {
    const { default: globalSetup } = await import("../../e2e/global-setup");
    await expect(globalSetup()).rejects.toMatchObject({ name: "E2eTargetError" });
    expect(createClient).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("global setup stops, with no client created, when the running app cannot be confirmed", async () => {
    setEnv({
      ...sandboxEnv(),
      SUPABASE_PUBLISHABLE_KEY: key({ ref: SANDBOX }),
      SUPABASE_SERVICE_ROLE_KEY: key({ ref: SANDBOX, role: "service_role" }),
    } as Record<string, string>);
    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));
    const { default: globalSetup } = await import("../../e2e/global-setup");
    await expect(globalSetup()).rejects.toMatchObject({ name: "E2eTargetError" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("the Playwright config refuses to load for production and for an empty environment", async () => {
    setEnv({ SUPABASE_URL: url(PROD), SUPABASE_PROJECT_ID: PROD });
    await expect(import("../../playwright.config")).rejects.toMatchObject({
      name: "E2eTargetError",
    });
    vi.resetModules();
    vi.unstubAllEnvs();
    for (const k of Object.keys(process.env)) {
      if (/SUPABASE|E2E_BASE_URL/.test(k)) vi.stubEnv(k, "");
    }
    await expect(import("../../playwright.config")).rejects.toMatchObject({
      name: "E2eTargetError",
    });
  });

  it("the Playwright config loads for a verified sandbox and for a local backend", async () => {
    setEnv({ ...sandboxEnv() } as Record<string, string>);
    await expect(import("../../playwright.config")).resolves.toBeDefined();
    vi.resetModules();
    vi.unstubAllEnvs();
    setEnv({ SUPABASE_URL: "http://127.0.0.1:54321", VITE_SUPABASE_URL: "http://127.0.0.1:54321" });
    await expect(import("../../playwright.config")).resolves.toBeDefined();
  });
});

describe("references are compared in one canonical form", () => {
  const upper = PROD.toUpperCase();
  const mixed = PROD.slice(0, 10).toUpperCase() + PROD.slice(10);

  it("blocks a mixed-case production id, by name and not only by disagreement", () => {
    for (const id of [upper, mixed]) {
      const text = reasonsOf(sandboxEnv({ SUPABASE_PROJECT_ID: id }));
      expect(text).toContain("SUPABASE_PROJECT_ID names the PRODUCTION project");
    }
  });

  it("blocks it when every id and URL agree on the same mixed-case production ref", () => {
    const env = sandboxEnv({
      SUPABASE_URL: `https://${upper}.supabase.co`,
      VITE_SUPABASE_URL: `https://${mixed}.SUPABASE.CO`,
      SUPABASE_PROJECT_ID: mixed,
      VITE_SUPABASE_PROJECT_ID: upper,
    });
    const text = reasonsOf(env);
    expect(text).toContain("PRODUCTION");
    expect(text).not.toContain("disagree");
  });

  it("blocks mixed-case production refs in key claims, session issuer and storage key", () => {
    expect(reasonsOf(sandboxEnv({ SUPABASE_SERVICE_ROLE_KEY: key({ ref: upper }) }))).toContain(
      "PRODUCTION",
    );
    const session = JSON.stringify({
      access_token: key({ iss: `https://${upper}.supabase.co/auth/v1` }),
    });
    expect(reasonsOf(sandboxEnv({ LOVABLE_BROWSER_SUPABASE_SESSION_JSON: session }))).toContain(
      "PRODUCTION",
    );
    expect(
      reasonsOf(sandboxEnv({ LOVABLE_BROWSER_SUPABASE_STORAGE_KEY: `sb-${mixed}-auth-token` })),
    ).toContain("PRODUCTION");
  });

  it("blocks a mixed-case reference documented elsewhere in the repo", () => {
    const other = "zzzzzzzzzzzzzzzzzzzz";
    const env = sandboxEnv({
      SUPABASE_URL: url(other),
      VITE_SUPABASE_URL: url(other),
      SUPABASE_PROJECT_ID: other,
      VITE_SUPABASE_PROJECT_ID: other,
    });
    expect(reasonsOf(env, [other.toUpperCase()])).toContain("PRODUCTION");
    const text = {
      "supabase/config.toml": `project_id = "${other}"\n`,
      ".env.production": `SUPABASE_PROJECT_ID="${other.toUpperCase()}"\n`,
    };
    expect(documentedProductionRefs((f) => (text as Record<string, string>)[f] ?? null)).toEqual([
      other,
    ]);
  });

  it("treats a differently cased copy of the sandbox as the sandbox, not a conflict", () => {
    const env = sandboxEnv({
      SUPABASE_PROJECT_ID: SANDBOX.toUpperCase(),
      VITE_SUPABASE_PROJECT_ID: ` ${SANDBOX} `,
    });
    expect(assertSafeE2eTarget(env)).toEqual({ kind: "sandbox", ref: SANDBOX });
  });
});

describe("a remote target needs complete, consistent configuration", () => {
  it.each(["SUPABASE_URL", "VITE_SUPABASE_URL", "SUPABASE_PROJECT_ID", "VITE_SUPABASE_PROJECT_ID"])(
    "is blocked when %s is missing",
    (name) => {
      expect(reasonsOf(sandboxEnv({ [name]: undefined }))).toContain(`${name} is not set`);
    },
  );

  it("is blocked when only the browser variables are set", () => {
    const env = sandboxEnv({ SUPABASE_URL: undefined, SUPABASE_PROJECT_ID: undefined });
    const text = reasonsOf(env);
    expect(text).toContain("SUPABASE_URL is not set");
    expect(text).toContain("SUPABASE_PROJECT_ID is not set");
  });

  it("is blocked when only the server variables are set", () => {
    const env = sandboxEnv({ VITE_SUPABASE_URL: undefined, VITE_SUPABASE_PROJECT_ID: undefined });
    expect(reasonsOf(env)).toContain("VITE_SUPABASE_URL is not set");
  });

  it("is blocked when the two URLs name different projects", () => {
    expect(reasonsOf(sandboxEnv({ VITE_SUPABASE_URL: url(UNKNOWN) }))).toContain("disagree");
  });

  it("is blocked when the URL and a project id name different projects", () => {
    expect(reasonsOf(sandboxEnv({ VITE_SUPABASE_PROJECT_ID: UNKNOWN }))).toContain("disagree");
  });

  it("is blocked when a key's ref claim names another project", () => {
    expect(reasonsOf(sandboxEnv({ SUPABASE_PUBLISHABLE_KEY: key({ ref: UNKNOWN }) }))).toContain(
      "disagree",
    );
  });

  it("is blocked when every source agrees on an undesignated project", () => {
    const env = sandboxEnv({
      SUPABASE_URL: url(UNKNOWN),
      VITE_SUPABASE_URL: url(UNKNOWN),
      SUPABASE_PROJECT_ID: UNKNOWN,
      VITE_SUPABASE_PROJECT_ID: UNKNOWN,
    });
    expect(reasonsOf(env)).toContain("not a designated E2E sandbox");
  });
});

describe("local fixture workflows", () => {
  const local = (over: Record<string, string | undefined> = {}) => ({
    E2E_BASE_URL: "http://127.0.0.1:8080",
    SUPABASE_URL: "http://127.0.0.1:54321",
    VITE_SUPABASE_URL: "http://127.0.0.1:54321",
    ...over,
  });
  const demoKeys = {
    SUPABASE_PUBLISHABLE_KEY: key({ iss: "supabase-demo", role: "anon" }),
    SUPABASE_SERVICE_ROLE_KEY: key({ iss: "supabase-demo", role: "service_role" }),
  };

  it.each(["local", "127", "Local", "my-local_1"])(
    "allows a local Supabase with the local project label %s",
    (label) => {
      const env = local({
        SUPABASE_PROJECT_ID: label,
        VITE_SUPABASE_PROJECT_ID: label,
        ...demoKeys,
      });
      expect(assertSafeE2eTarget(env)).toEqual({ kind: "local" });
    },
  );

  it("still blocks a local target that sets only one of the two URLs", () => {
    expect(reasonsOf(local({ VITE_SUPABASE_URL: undefined }))).toContain(
      "VITE_SUPABASE_URL is not set",
    );
  });

  it("refuses a local URL when the project id is a real-looking reference, designated or not", () => {
    for (const id of [SANDBOX, PROD, UNKNOWN]) {
      expect(reasonsOf(local({ SUPABASE_PROJECT_ID: id }))).toContain("remote project reference");
    }
  });

  it("refuses a local project label that is not a plain label", () => {
    expect(reasonsOf(local({ SUPABASE_PROJECT_ID: "a b!" }))).toContain(
      "not a valid local project label",
    );
  });

  it("does not let a local-looking label turn a remote URL into a local target", () => {
    for (const label of ["local", "127", "localhost"]) {
      const env = sandboxEnv({ SUPABASE_PROJECT_ID: label, VITE_SUPABASE_PROJECT_ID: label });
      expect(reasonsOf(env)).toContain("disagree");
    }
  });

  it("does not let a local-looking label make an unidentifiable host acceptable", () => {
    const env = {
      E2E_BASE_URL: "http://localhost:8080",
      SUPABASE_URL: "https://api.example.com",
      VITE_SUPABASE_URL: "https://api.example.com",
      SUPABASE_PROJECT_ID: "local",
      VITE_SUPABASE_PROJECT_ID: "local",
    };
    expect(reasonsOf(env)).toContain("identify");
  });

  it("does not let a local URL in one variable override a remote URL in the other", () => {
    expect(reasonsOf(sandboxEnv({ VITE_SUPABASE_URL: "http://127.0.0.1:54321" }))).toContain(
      "alongside a remote one",
    );
  });

  it("does not let a local-looking host be a look-alike", () => {
    expect(refFromSupabaseUrl("http://localhost.evil.test:54321")).toBeNull();
    expect(refFromSupabaseUrl("http://127.0.0.1.nip.io:54321")).toBeNull();
  });
});

describe("the server-side half cannot be observed, so completeness is required instead", () => {
  const app = (body: string) => async () => ({ ok: true, text: async () => body });
  const keyValue = key({ role: "anon", ref: SANDBOX });

  it("requires the served build to carry the publishable key from this environment", async () => {
    const t = { kind: "sandbox", ref: SANDBOX } as const;
    await expect(
      verifyServedAppTarget("http://localhost:8080", t, app(`"${url(SANDBOX)}" "${keyValue}"`), {
        publishableKey: keyValue,
      }),
    ).resolves.toBeUndefined();
    const other = key({ role: "anon", ref: SANDBOX, note: "someone else" });
    const err = await verifyServedAppTarget(
      "http://localhost:8080",
      t,
      app(`"${url(SANDBOX)}" "${other}"`),
      { publishableKey: keyValue },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(E2eTargetError);
    expect(err.message).toContain("publishable key from this environment");
    expect(err.message).not.toContain(keyValue);
    expect(err.message).not.toContain(other);
  });

  it("skips the key comparison when no key is configured, but still checks the project", async () => {
    const t = { kind: "sandbox", ref: SANDBOX } as const;
    await expect(
      verifyServedAppTarget("http://localhost:8080", t, app(`"${url(SANDBOX)}"`), {}),
    ).resolves.toBeUndefined();
    await expect(
      verifyServedAppTarget("http://localhost:8080", t, app(`"${url(PROD)}"`), {}),
    ).rejects.toBeInstanceOf(E2eTargetError);
  });

  it("states what it can and cannot verify in the guard's own documentation", () => {
    const source = readFileSync("e2e/safety/target-guard.ts", "utf8");
    expect(source).toContain("CANNOT see: the dev server's own process environment");
  });
});

describe("partial or conflicting configuration stops global setup before any side effect", () => {
  const createClient = vi.fn();
  const fetchSpy = vi.fn();
  beforeEach(() => {
    vi.resetModules();
    createClient.mockReset();
    fetchSpy.mockReset();
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));
    vi.stubGlobal("fetch", fetchSpy);
    for (const k of Object.keys(process.env))
      if (/SUPABASE|E2E_BASE_URL/.test(k)) vi.stubEnv(k, "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock("@supabase/supabase-js");
  });

  it.each([
    ["only the server variables", { VITE_SUPABASE_URL: "", VITE_SUPABASE_PROJECT_ID: "" }],
    ["only the browser variables", { SUPABASE_URL: "", SUPABASE_PROJECT_ID: "" }],
    ["conflicting URLs", { VITE_SUPABASE_URL: url(UNKNOWN) }],
    ["a mixed-case production id", { SUPABASE_PROJECT_ID: PROD.toUpperCase() }],
    [
      "remote URLs with local-looking ids",
      { SUPABASE_PROJECT_ID: "local", VITE_SUPABASE_PROJECT_ID: "local" },
    ],
  ])("refuses %s without creating a client or fetching", async (_label, over) => {
    for (const [k, v] of Object.entries({ ...sandboxEnv(), ...over })) vi.stubEnv(k, v ?? "");
    const { default: globalSetup } = await import("../../e2e/global-setup");
    await expect(globalSetup()).rejects.toMatchObject({ name: "E2eTargetError" });
    expect(createClient).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
