/**
 * reportClientError is open to signed-out visitors, so its reports must spend the client budget,
 * never the server's: a caller who keeps calling it cannot stop server failures from being
 * recorded. A server function is its handler here: validate the input, then run it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (d: unknown) => d;
    const b = {
      middleware() {
        return b;
      },
      inputValidator(fn: (d: unknown) => unknown) {
        validate = fn;
        return b;
      },
      handler(fn: (ctx: { data: unknown }) => unknown) {
        return (arg: { data: unknown }) => fn({ data: validate(arg.data) });
      },
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        h.rows.push({ table, ...row });
        return { error: null };
      },
    }),
  },
}));

const { reportClientError } = await import("./error-report.functions");
const { REPORTS_PER_MINUTE, reportServerError } = await import("./error-report.server");

type Call = (arg: { data: unknown }) => Promise<{ saved: boolean }>;
const report = (message: string) =>
  (reportClientError as unknown as Call)({
    data: { kind: "window", message, route: "/feed", signedIn: false },
  });

beforeEach(() => {
  h.rows.length = 0;
});

describe("reportClientError (P0-8)", () => {
  it("files a browser report as source client, scrubbed again on the server", async () => {
    const res = await report("TypeError: x is undefined for jane@example.com");
    expect(res.saved).toBe(true);
    expect(h.rows).toEqual([
      expect.objectContaining({
        table: "app_error_events",
        source: "client",
        kind: "window",
        message: "TypeError: x is undefined for [email]",
        route: "/feed",
        signed_in: false,
      }),
    ]);
  });

  it("a flood of browser reports uses up only the client budget; server failures are still saved", async () => {
    for (let i = 0; i < REPORTS_PER_MINUTE + 5; i++) await report(`flood ${i}`);
    const client = h.rows.filter((r) => r.source === "client");
    expect(client.length).toBeLessThanOrEqual(REPORTS_PER_MINUTE);
    expect((await report("one more")).saved).toBe(false);

    await reportServerError(new Error('relation "public.x" does not exist'), null, "server_fn");
    expect(h.rows.filter((r) => r.source === "server")).toEqual([
      expect.objectContaining({ source: "server", kind: "server_fn" }),
    ]);
  });
});
