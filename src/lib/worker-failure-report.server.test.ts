import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P2-7a: the shared worker-failure reporter, run through the real server reporter (reportServerError) with only the
 * database insert stood in, so what these tests read is the row app_error_events would get.
 */
const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
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
        return { error: null };
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
  REMINDERS_WORKER,
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

  it("a save that hangs holds the answer back at most REPORT_TIMEOUT_MS", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
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
    // The time limit starts with the save; wait until the save is under way.
    while (!h.inserting) await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(REPORT_TIMEOUT_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await answering;
    expect(settled).toBe(original);
  });
});

describe("reportWorkerFailure (P2-7a)", () => {
  it("never throws", async () => {
    h.reporterThrows = true;
    await expect(reportWorkerFailure(WORKER, new Error("x"))).resolves.toBeUndefined();
  });
});
