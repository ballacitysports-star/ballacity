import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  fail: false,
  hang: false,
  inserting: false,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        h.inserting = true;
        if (h.hang) return new Promise<never>(() => {});
        if (h.fail) throw new Error("db down");
        h.rows.push({ table, ...row });
        return { error: null };
      },
    }),
  },
}));

import { REPORT_TIMEOUT_MS, reportServerError } from "./error-report.server";

beforeEach(() => {
  h.rows.length = 0;
  h.fail = false;
  h.hang = false;
  h.inserting = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("reportServerError (P0-8)", () => {
  it("files a page failure as ssr by default, under the path with ids masked", async () => {
    const request = new Request(
      "https://ballacity.example/games/3f2b1c4d-1111-2222-3333-444455556666?tab=chat",
      { headers: { cookie: "sb-abc-auth-token=secret" } },
    );
    await reportServerError(new Error("render broke for jane@example.com"), request);
    expect(h.rows).toEqual([
      {
        table: "app_error_events",
        source: "server",
        kind: "ssr",
        message: "Error: render broke for [email]",
        route: "/games/:id",
        fingerprint: expect.stringMatching(/^[a-z0-9]+$/),
        release: null,
        signed_in: true,
      },
    ]);
  });

  it("files a server-function failure as server_fn, under the route it is given", async () => {
    const request = new Request("https://ballacity.example/_serverFn/4f9a1c2d", {
      method: "POST",
      headers: { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.x.y" },
    });
    await reportServerError(new TypeError("boom"), request, "server_fn", {
      route: "/_serverFn/doThing",
    });
    expect(h.rows[0]).toMatchObject({
      kind: "server_fn",
      route: "/_serverFn/doThing",
      message: "TypeError: boom",
      signed_in: true,
    });
  });

  it("without a request, files the route only and counts as signed out", async () => {
    await reportServerError(new TypeError("boom"), null, "server_fn", { route: "/_serverFn/x" });
    expect(h.rows[0]).toMatchObject({ kind: "server_fn", route: "/_serverFn/x", signed_in: false });
    await reportServerError(new TypeError("boom"), null, "server_fn");
    expect(h.rows[1]).toMatchObject({ route: null, signed_in: false });
  });

  it("keeps input values Postgres repeats out of the row", async () => {
    await reportServerError(
      new Error('invalid input syntax for type uuid: "jane-smith-1990"'),
      null,
      "server_fn",
    );
    expect(h.rows[0].message).toBe('Error: invalid input syntax for type uuid: "[value]"');
  });

  it("skips aborts and never throws, even when saving fails", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    await reportServerError(abort, null, "server_fn");
    expect(h.rows).toEqual([]);
    h.fail = true;
    await expect(reportServerError(new Error("x"), null)).resolves.toBeUndefined();
  });

  it("stops waiting for a save that hangs after REPORT_TIMEOUT_MS", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    h.hang = true;
    let done = false;
    const reporting = reportServerError(new TypeError("boom"), null, "server_fn").then(() => {
      done = true;
    });
    // The time limit starts with the save; wait until the save is under way.
    while (!h.inserting) await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(REPORT_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await reporting;
    expect(done).toBe(true);
  });
});
