import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P2-7a: the shared worker-failure reporter, run through the real server reporter (reportServerError) with only the
 * database stood in, so what these tests read is the row app_error_events would get. The stand-in table also answers
 * the check for a recent row with the same fingerprint and route (the once-per-30-minutes rule).
 */
type Saved = Record<string, unknown> & { table: string; id: number; created_at: string };
const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  saved: [] as Saved[],
  checks: [] as Record<string, unknown>[],
  checkFails: null as null | "error" | "throws" | "hangs",
  insertThrows: false,
  insertHangs: false,
  inserting: false,
  reporterThrows: false,
  reporterCalls: 0,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        h.inserting = true;
        if (h.insertHangs) return new Promise<never>(() => {});
        if (h.insertThrows) throw new Error("db down");
        h.rows.push({ table, ...row });
        h.saved.push({
          table,
          id: h.saved.length + 1,
          created_at: new Date().toISOString(),
          ...row,
        });
        return { error: null };
      },
      select: (columns: string) => {
        const eq: Record<string, unknown> = {};
        const gte: Record<string, string> = {};
        const q = {
          eq: (col: string, v: unknown) => {
            eq[col] = v;
            return q;
          },
          gte: (col: string, v: string) => {
            gte[col] = v;
            return q;
          },
          limit: async (n: number) => {
            h.checks.push({ table, columns, eq: { ...eq }, gte: { ...gte }, limit: n });
            if (h.checkFails === "hangs") return new Promise<never>(() => {});
            if (h.checkFails === "throws") throw new Error("check down");
            if (h.checkFails === "error") return { data: null, error: { message: "check failed" } };
            const data = h.saved
              .filter(
                (r) =>
                  r.table === table &&
                  Object.entries(eq).every(([col, v]) => r[col] === v) &&
                  Object.entries(gte).every(([col, v]) => String(r[col]) >= v),
              )
              .slice(0, n)
              .map((r) => ({ id: r.id }));
            return { data, error: null };
          },
        };
        return q;
      },
    }),
  },
}));

// The real reporter, counted, and broken on request (a reporter that throws must not change the answer).
vi.mock("@/lib/error-report.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/error-report.server")>();
  return {
    ...actual,
    reportServerError: async (...args: Parameters<typeof actual.reportServerError>) => {
      h.reporterCalls += 1;
      if (h.reporterThrows) throw new Error("reporter broken");
      return actual.reportServerError(...args);
    },
  };
});

import { REPORT_TIMEOUT_MS } from "@/lib/error-report.server";
import {
  REELS_WORKER,
  REMINDERS_WORKER,
  WORKER_ANSWER_BY_MS,
  WORKER_REPORT_EVERY_MS,
  WORKER_REPORT_WAIT_MS,
  failureOf,
  reportWorkerFailure,
  reportingWorkerFailures,
} from "./worker-failure-report.server";

const WORKER = REMINDERS_WORKER;
const UUID = "3f2b1c4d-1111-2222-3333-444455556666";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A scheduler's call: the worker secret in a header, a body, and a cookie that must not read as signed in. */
function workerRequest(init: RequestInit = {}) {
  // A trailing slash and a query string: the report names the endpoint, not the URL it was called on.
  return new Request("https://app.example/api/public/reminders/run/?debug=1", {
    method: "POST",
    headers: { authorization: "Bearer s3cret-worker-secret", cookie: "sb-abc-auth-token=xyz" },
    body: JSON.stringify({ user_id: UUID }),
    ...init,
  });
}

async function snapshot(res: Response) {
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    body: await res.text(),
  };
}

beforeEach(() => {
  h.rows.length = 0;
  h.saved.length = 0;
  h.checks.length = 0;
  h.checkFails = null;
  h.insertThrows = false;
  h.insertHangs = false;
  h.inserting = false;
  h.reporterThrows = false;
  h.reporterCalls = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("failureOf (P2-7a)", () => {
  it("reads the JSON error field, and the status when there is none", async () => {
    expect(await failureOf(json({ error: "queue_read_failed" }, 500))).toBe("queue_read_failed");
    expect(await failureOf(json({ ok: false }, 500))).toBe("http_500");
    expect(await failureOf(json({ error: "   " }, 502))).toBe("http_502");
    expect(await failureOf(json({ error: { code: "x" } }, 500))).toBe("http_500");
    expect(await failureOf(json(["error"], 500))).toBe("http_500");
    expect(await failureOf(new Response("<html>bad gateway</html>", { status: 503 }))).toBe(
      "http_503",
    );
  });

  it("leaves the answer's body readable", async () => {
    const res = json({ error: "boom", sent: 2 }, 500);
    await failureOf(res);
    expect(await res.json()).toEqual({ error: "boom", sent: 2 });
  });
});

describe("reportingWorkerFailures (P2-7a)", () => {
  it("files a 5xx answer once, as '<job>: <error>' under the route, scrubbed and signed out", async () => {
    const answer = {
      ok: false,
      sent: 3,
      error: `roster read failed: invalid input syntax for type uuid: "${UUID}"; mail to jane@example.com failed; token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl`,
    };
    const handler = reportingWorkerFailures(WORKER, async () => json(answer, 500));
    const res = await handler({ request: workerRequest() });

    expect(await snapshot(res)).toEqual({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify(answer),
    });
    expect(h.rows).toEqual([
      {
        table: "app_error_events",
        source: "server",
        kind: "ssr",
        message:
          'send-game-reminders: roster read failed: invalid input syntax for type uuid: "[value]"; mail to [email] failed; token [redacted]',
        route: "/api/public/reminders/run",
        fingerprint: expect.stringMatching(/^[a-z0-9]{1,32}$/),
        release: null,
        signed_in: false,
      },
    ]);
    const saved = JSON.stringify(h.rows);
    for (const leak of [UUID, "jane@example.com", "s3cret", "eyJ", "sb-abc", "sent", "debug"]) {
      expect(saved).not.toContain(leak);
    }
  });

  it("files a bare id in an error as [id], and a 5xx with no error field by its status", async () => {
    await reportingWorkerFailures(WORKER, async () =>
      json({ error: `claim failed for ${UUID}` }, 500),
    )({ request: workerRequest() });
    await reportingWorkerFailures(
      WORKER,
      async () => new Response("upstream", { status: 503 }),
    )({ request: workerRequest() });
    expect(h.rows.map((r) => r.message)).toEqual([
      "send-game-reminders: claim failed for [id]",
      "send-game-reminders: http_503",
    ]);
  });

  it.each([200, 202, 204, 301, 400, 401, 403, 404, 499])(
    "reports nothing for a %i",
    async (status) => {
      const original = new Response(status === 204 ? null : JSON.stringify({ error: "x" }), {
        status,
      });
      const res = await reportingWorkerFailures(
        WORKER,
        async () => original,
      )({
        request: workerRequest(),
      });
      expect(res).toBe(original);
      expect(h.reporterCalls).toBe(0);
      expect(h.rows).toEqual([]);
    },
  );

  it("returns the handler's own answer object for a 5xx", async () => {
    const original = json({ error: "boom" }, 500);
    const res = await reportingWorkerFailures(
      WORKER,
      async () => original,
    )({
      request: workerRequest(),
    });
    expect(res).toBe(original);
    expect(h.rows).toHaveLength(1);
  });

  it("reports a throw once and answers a JSON 500 without the thrown text", async () => {
    const handler = reportingWorkerFailures(WORKER, async () => {
      throw new TypeError(`Cannot read properties of undefined (reading 'id') for ${UUID}`);
    });
    const res = await handler({ request: workerRequest() });
    expect(await snapshot(res)).toEqual({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "worker_failed" }),
    });
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({
      kind: "ssr",
      route: "/api/public/reminders/run",
      message:
        "send-game-reminders: TypeError: Cannot read properties of undefined (reading 'id') for [id]",
      signed_in: false,
    });
  });

  it("reports a thrown error-shaped object (a PostgREST error) by its message, code and details, scrubbed", async () => {
    const res = await reportingWorkerFailures(WORKER, async () => {
      throw {
        message: "insert failed",
        code: "23505",
        details: "Key (email)=(jane@example.com) already exists.",
      };
    })({ request: workerRequest() });
    expect(await snapshot(res)).toEqual({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "worker_failed" }),
    });
    // The details come last, scrubbed: the key's value goes first, then the reporter's key/token rule takes the rest.
    expect(h.rows.map((r) => r.message)).toEqual([
      "send-game-reminders: insert failed (23505) Key [redacted] already exists.",
    ]);
    expect(JSON.stringify(h.rows)).not.toContain("jane@example.com");
  });

  it("reports a thrown non-Error too", async () => {
    const res = await reportingWorkerFailures(WORKER, async () => {
      throw "sweep exploded";
    })({ request: workerRequest() });
    expect(res.status).toBe(500);
    expect(h.rows.map((r) => r.message)).toEqual(["send-game-reminders: sweep exploded"]);
  });

  it("rethrows an abort unreported", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    const handler = reportingWorkerFailures(WORKER, async () => {
      throw abort;
    });
    await expect(handler({ request: workerRequest() })).rejects.toBe(abort);

    const controller = new AbortController();
    controller.abort();
    const gone = new Error("socket closed");
    await expect(
      reportingWorkerFailures(WORKER, async () => {
        throw gone;
      })({ request: workerRequest({ signal: controller.signal }) }),
    ).rejects.toBe(gone);
    expect(h.reporterCalls).toBe(0);
    expect(h.rows).toEqual([]);
  });

  it("a reporter that throws changes nothing: same answer, no throw", async () => {
    h.reporterThrows = true;
    const original = json({ error: "boom", sent: 1 }, 500);
    const res = await reportingWorkerFailures(
      WORKER,
      async () => original,
    )({
      request: workerRequest(),
    });
    expect(res).toBe(original);
    expect(await res.json()).toEqual({ error: "boom", sent: 1 });
    expect(h.reporterCalls).toBe(1);

    const thrown = await reportingWorkerFailures(WORKER, async () => {
      throw new Error("boom");
    })({ request: workerRequest() });
    expect(thrown.status).toBe(500);
    expect(await thrown.json()).toEqual({ error: "worker_failed" });
  });

  it("a database that fails changes nothing", async () => {
    h.insertThrows = true;
    const original = json({ error: "boom" }, 500);
    const res = await reportingWorkerFailures(
      WORKER,
      async () => original,
    )({
      request: workerRequest(),
    });
    expect(res).toBe(original);
    expect(h.rows).toEqual([]);
  });

  it("a check for a recent row that hangs holds the answer back at most WORKER_REPORT_WAIT_MS too", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    h.checkFails = "hangs";
    const original = json({ error: "boom" }, 500);
    let settled: Response | null = null;
    const answering = reportingWorkerFailures(
      WORKER,
      async () => original,
    )({
      request: workerRequest(),
    }).then((r) => {
      settled = r;
    });
    while (h.checks.length === 0) await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(WORKER_REPORT_WAIT_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await answering;
    expect(settled).toBe(original);
    expect(h.inserting).toBe(false);
  });

  it("a save that hangs holds the answer back at most WORKER_REPORT_WAIT_MS (1.5 s)", async () => {
    expect(WORKER_REPORT_WAIT_MS).toBe(REPORT_TIMEOUT_MS);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    h.insertHangs = true;
    const original = json({ error: "boom" }, 500);
    let settled: Response | null = null;
    const answering = reportingWorkerFailures(
      WORKER,
      async () => original,
    )({
      request: workerRequest(),
    }).then((r) => {
      settled = r;
    });
    // The clock does not move until the timers are advanced; wait until the save is under way.
    while (!h.inserting) await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(WORKER_REPORT_WAIT_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await answering;
    expect(settled).toBe(original);
  });

  // pg_net stops waiting after 5 s: a run that fails late must not be held past WORKER_ANSWER_BY_MS by its report.
  describe.each([
    ["answers 500", () => json({ error: "late failure" }, 500)],
    [
      "throws",
      () => {
        throw new Error("late failure");
      },
    ],
  ] as const)("a run that %s late", (_label, fail) => {
    function lateRun(runMs: number) {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      h.insertHangs = true;
      const state: { settled: Response | null } = { settled: null };
      const answering = reportingWorkerFailures(WORKER, async () => {
        await new Promise((resolve) => setTimeout(resolve, runMs));
        return fail();
      })({ request: workerRequest() }).then((r) => {
        state.settled = r;
      });
      return { state, answering };
    }

    it("answers WORKER_ANSWER_BY_MS (4 s) after the call arrived, not a full wait later", async () => {
      expect(WORKER_ANSWER_BY_MS).toBe(4_000);
      const { state, answering } = lateRun(3_500);
      await vi.advanceTimersByTimeAsync(3_500);
      while (!h.inserting) await new Promise((resolve) => setImmediate(resolve));
      expect(state.settled).toBeNull();
      await vi.advanceTimersByTimeAsync(WORKER_ANSWER_BY_MS - 3_500 - 1);
      expect(state.settled).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      await answering;
      expect(state.settled?.status).toBe(500);
    });

    it("a run that already took longer answers at once, and its report is still started", async () => {
      const { state, answering } = lateRun(WORKER_ANSWER_BY_MS + 200);
      await vi.advanceTimersByTimeAsync(WORKER_ANSWER_BY_MS + 200);
      // No timer is advanced from here on: an answer that waited for one would never come.
      await answering;
      expect(state.settled?.status).toBe(500);
      while (!h.inserting) await new Promise((resolve) => setImmediate(resolve));
      expect(h.reporterCalls).toBe(1);
    });
  });
});

describe("the same failure at most once every 30 minutes (P2-7a)", () => {
  const T0 = new Date("2026-11-27T10:00:00.000Z").getTime();
  const at = (ms: number) => vi.setSystemTime(T0 + ms);
  const failWith = (error: string, worker = WORKER) =>
    reportingWorkerFailures(worker, async () => json({ error, sent: 1 }, 500))({
      request: workerRequest(),
    });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(0);
  });

  it("files the first failure, then nothing more until 30 minutes have passed, then one row again", async () => {
    expect(WORKER_REPORT_EVERY_MS).toBe(30 * 60_000);
    for (const ms of [0, 60_000, 5 * 60_000, WORKER_REPORT_EVERY_MS - 1, WORKER_REPORT_EVERY_MS]) {
      at(ms);
      const res = await failWith("queue_read_failed");
      // Every answer is the handler's own, filed or not.
      expect(await snapshot(res)).toEqual({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "queue_read_failed", sent: 1 }),
      });
    }
    expect(h.rows.map((r) => r.message)).toEqual(["send-game-reminders: queue_read_failed"]);
    expect(h.reporterCalls).toBe(1);

    at(WORKER_REPORT_EVERY_MS + 1);
    await failWith("queue_read_failed");
    expect(h.rows.map((r) => r.message)).toEqual([
      "send-game-reminders: queue_read_failed",
      "send-game-reminders: queue_read_failed",
    ]);
    expect(h.rows[0].fingerprint).toBe(h.rows[1].fingerprint);
  });

  it("checks app_error_events for the row's own fingerprint and route, over the last 30 minutes", async () => {
    at(WORKER_REPORT_EVERY_MS * 3);
    await failWith("queue_read_failed");
    expect(h.checks).toEqual([
      {
        table: "app_error_events",
        columns: "id",
        eq: { fingerprint: h.rows[0].fingerprint, route: "/api/public/reminders/run" },
        gte: { created_at: new Date(T0 + WORKER_REPORT_EVERY_MS * 2).toISOString() },
        limit: 1,
      },
    ]);
  });

  it("a different failure, or the same one on another endpoint, gets its own row", async () => {
    await failWith("queue_read_failed");
    await failWith("Missing LOVABLE_API_KEY");
    await failWith("queue_read_failed", REELS_WORKER);
    await failWith("queue_read_failed");
    await failWith("Missing LOVABLE_API_KEY");
    await failWith("queue_read_failed", REELS_WORKER);
    expect(h.rows.map((r) => [r.message, r.route])).toEqual([
      ["send-game-reminders: queue_read_failed", "/api/public/reminders/run"],
      ["send-game-reminders: Missing LOVABLE_API_KEY", "/api/public/reminders/run"],
      ["process-highlight-reels: queue_read_failed", "/api/public/reels/process"],
    ]);
  });

  it("failures that differ only in numbers or ids are the same group, so they are filed once", async () => {
    await failWith("statement timeout after 5012 ms");
    await failWith("statement timeout after 5023 ms");
    await failWith(`claim failed for ${UUID}`);
    await failWith("claim failed for 9a8b7c6d-1111-2222-3333-444455556666");
    expect(h.rows.map((r) => r.message)).toEqual([
      "send-game-reminders: statement timeout after 5012 ms",
      "send-game-reminders: claim failed for [id]",
    ]);
  });

  it("a handler that keeps throwing is filed once too, and every call still answers the JSON 500", async () => {
    for (const ms of [0, 60_000]) {
      at(ms);
      const res = await reportingWorkerFailures(WORKER, async () => {
        throw new Error("sweep exploded");
      })({ request: workerRequest() });
      expect(await res.json()).toEqual({ error: "worker_failed" });
    }
    expect(h.rows.map((r) => r.message)).toEqual(["send-game-reminders: Error: sweep exploded"]);
  });

  it("a row that was not saved does not count: the next failure files it", async () => {
    h.insertThrows = true;
    await failWith("queue_read_failed");
    expect(h.rows).toEqual([]);
    h.insertThrows = false;
    at(60_000);
    await failWith("queue_read_failed");
    expect(h.rows.map((r) => r.message)).toEqual(["send-game-reminders: queue_read_failed"]);
  });

  it.each(["error", "throws"] as const)(
    "a check that fails (%s) files the row anyway",
    async (how) => {
      await failWith("queue_read_failed");
      h.checkFails = how;
      at(60_000);
      const res = await failWith("queue_read_failed");
      expect(res.status).toBe(500);
      expect(h.rows.map((r) => r.message)).toEqual([
        "send-game-reminders: queue_read_failed",
        "send-game-reminders: queue_read_failed",
      ]);
    },
  );
});

describe("reportWorkerFailure (P2-7a)", () => {
  it("never throws", async () => {
    h.reporterThrows = true;
    await expect(reportWorkerFailure(WORKER, new Error("x"))).resolves.toBeUndefined();
  });
});
