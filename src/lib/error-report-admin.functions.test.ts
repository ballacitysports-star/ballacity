import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A server function is its handler for these tests: validate the input, then run it. A call is
// async, as a real one is, so a refused input is a rejected promise.
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
      handler(fn: (ctx: { data: unknown; context: unknown }) => unknown) {
        return async (arg?: { data?: unknown }) =>
          fn({ data: validate(arg?.data), context: { userId: "admin-1", supabase: {} } });
      },
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

type Call = [method: string, ...args: unknown[]];
const h = vi.hoisted(() => ({
  calls: [] as [string, ...unknown[]][],
  rows: [] as Record<string, unknown>[],
  assertSuperadmin: vi.fn(async (..._args: unknown[]) => undefined),
}));
vi.mock("@/lib/superadmin.server", () => ({
  assertSuperadmin: h.assertSuperadmin,
  getAdmin: async () => {
    const query: Record<string, unknown> = {};
    for (const m of ["select", "gte", "in", "order", "limit"]) {
      query[m] = (...args: unknown[]) => {
        h.calls.push([m, ...args]);
        return query;
      };
    }
    query.then = (resolve: (r: unknown) => unknown) => resolve({ data: h.rows, error: null });
    return {
      from: (table: string) => {
        h.calls.push(["from", table]);
        return query;
      },
    };
  },
}));

import { superadminListErrors } from "./error-report-admin.functions";

const NOW = new Date("2026-11-11T12:00:00.000Z");
const list = (data?: unknown) =>
  superadminListErrors({ data } as Parameters<typeof superadminListErrors>[0]);
const sinceOf = (calls: Call[]) => calls.find((c) => c[0] === "gte")?.[2];
const hoursBefore = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  h.calls.length = 0;
  h.rows = [];
  h.assertSuperadmin.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("superadminListErrors window (P0-8)", () => {
  it("reads the last hour when asked: the first hour after a publish", async () => {
    await list({ hours: 1 });
    expect(h.assertSuperadmin).toHaveBeenCalledTimes(1);
    expect(h.calls).toEqual([
      ["from", "app_error_events"],
      ["select", "fingerprint, message, route, source, kind, created_at, signed_in"],
      ["gte", "created_at", hoursBefore(1)],
      ["order", "created_at", { ascending: false }],
      ["limit", 2000],
    ]);
  });

  it("keeps the day views: 7 days by default, and days from tabs opened before the change", async () => {
    await list(undefined);
    expect(sinceOf(h.calls)).toBe(hoursBefore(7 * 24));
    h.calls.length = 0;
    await list({ days: 1 });
    expect(sinceOf(h.calls)).toBe(hoursBefore(24));
    h.calls.length = 0;
    await list({ days: 30 });
    expect(sinceOf(h.calls)).toBe(hoursBefore(30 * 24));
    h.calls.length = 0;
    await list({ hours: 1, days: 30 });
    expect(sinceOf(h.calls)).toBe(hoursBefore(1));
  });

  it("server only keeps page renders and server functions", async () => {
    await list({ hours: 1, serverOnly: true });
    expect(h.calls).toContainEqual(["in", "kind", ["ssr", "server_fn"]]);
    h.calls.length = 0;
    await list({ hours: 1, serverOnly: false });
    expect(h.calls.some((c) => c[0] === "in")).toBe(false);
  });

  it("refuses anyone who is not a superadmin before reading a row", async () => {
    const refusal = new Error("Forbidden"); // what assertSuperadmin throws
    h.assertSuperadmin.mockRejectedValueOnce(refusal);
    await expect(list({ hours: 1 })).rejects.toBe(refusal);
    expect(h.assertSuperadmin).toHaveBeenCalledTimes(1);
    expect(h.calls).toEqual([]);
  });

  it.each([
    [{ hours: 0 }],
    [{ hours: 721 }],
    [{ hours: 1.5 }],
    [{ hours: -1 }],
    [{ hours: "1" }],
    [{ days: 31 }],
    [{ serverOnly: "yes" }],
  ])("refuses a window outside 1 hour to 30 days, or a bad flag: %j", async (input) => {
    await expect(list(input)).rejects.toMatchObject({ name: "ZodError" });
    expect(h.calls).toEqual([]);
  });

  it("returns the rows grouped, and says when the cap was hit", async () => {
    const row = (fingerprint: string, kind: string) => ({
      fingerprint,
      message: `m-${fingerprint}`,
      route: "/_serverFn/doThing",
      source: "server",
      kind,
      created_at: "2026-11-11T11:30:00Z",
      signed_in: false,
    });
    h.rows = [row("a", "server_fn"), row("a", "server_fn"), row("b", "ssr")];
    const out = await list({ hours: 1, serverOnly: true });
    expect(out.total).toBe(3);
    expect(out.capped).toBe(false);
    expect(out.groups.map((g) => [g.fingerprint, g.count, g.kinds])).toEqual([
      ["a", 2, ["server_fn"]],
      ["b", 1, ["ssr"]],
    ]);
  });
});
