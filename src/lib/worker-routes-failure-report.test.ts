import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P2-7a, through the real worker routes: a 5xx answer from a scheduled worker is filed once in app_error_events as
 * "<job>: <error>" under the route, with nothing of the request; a run that works, or a caller without the worker secret,
 * files nothing; and a reporter that breaks never changes the answer. The sweeps, the worker check and the database are
 * stood in; the reporter is the real one, counted, and broken on request.
 */
const h = vi.hoisted(() => ({
  auth: "ok" as "ok" | "unauthorized",
  rows: [] as Record<string, unknown>[],
  reporterThrows: false,
  reporterCalls: [] as unknown[][],
  sweeps: vi.fn(),
  flushQueue: vi.fn(),
  rpc: vi.fn(),
  reelsQueue: { data: [] as unknown[], error: null as { message: string } | null },
}));

vi.mock("@/lib/worker-auth.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/worker-auth.server")>();
  return { ...actual, authorizeWorker: async () => h.auth };
});

vi.mock("@/integrations/supabase/client.server", () => {
  const reelsQuery = () => {
    const q: Record<string, unknown> = {};
    for (const step of ["select", "eq", "lt", "or", "order"]) q[step] = () => q;
    q.limit = async () => h.reelsQueue;
    return q;
  };
  return {
    supabaseAdmin: {
      from: (table: string) =>
        table === "app_error_events"
          ? {
              insert: async (row: Record<string, unknown>) => {
                h.rows.push(row);
                return { error: null };
              },
            }
          : reelsQuery(),
      rpc: (...args: unknown[]) => h.rpc(...args),
    },
  };
});

vi.mock("@/lib/error-report.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/error-report.server")>();
  return {
    ...actual,
    reportServerError: async (...args: Parameters<typeof actual.reportServerError>) => {
      h.reporterCalls.push(args);
      if (h.reporterThrows) throw new Error("reporter broken");
      return actual.reportServerError(...args);
    },
  };
});

vi.mock("@/lib/game-reminders.server", () => ({
  runScheduledSweeps: (...args: unknown[]) => h.sweeps(...args),
}));
vi.mock("@/lib/notification-flush.server", () => ({
  flushQueue: (...args: unknown[]) => h.flushQueue(...args),
}));
vi.mock("@/lib/push-curfew.server", () => ({ curfewGateFor: vi.fn() }));
vi.mock("@/lib/push.server", () => ({
  ONESIGNAL_APP_ID: "app",
  ONESIGNAL_API: "https://onesignal.invalid/notifications",
  absolutizeUrl: async (url: string | null) => url ?? undefined,
}));
vi.mock("@/lib/reels-pipeline.server", () => ({
  BATCH_SIZE: 5,
  MAX_ATTEMPTS: 3,
  REEL_WORK_COLUMNS: "id",
  STUCK_AFTER_MS: 600_000,
  processReel: vi.fn(),
}));

import { Route as RemindersRoute } from "@/routes/api/public/reminders/run";
import { Route as FlushRoute } from "@/routes/api/public/notifications/flush";
import { Route as ReleaseHoldsRoute } from "@/routes/api/public/payments/release-holds";
import { Route as ReelsRoute } from "@/routes/api/public/reels/process";

type Handler = (ctx: { request: Request }) => Promise<Response>;
const post = (route: unknown) =>
  (route as { options: { server: { handlers: { POST: Handler } } } }).options.server.handlers.POST;

const UUID = "3f2b1c4d-1111-2222-3333-444455556666";
const SECRET = "s3cret-worker-secret";

/** What pg_net sends: the worker secret, a JSON body, the endpoint's path. */
function workerRequest(path: string) {
  return new Request(`https://app.example${path}?from=cron`, {
    method: "POST",
    headers: {
      "x-worker-secret": SECRET,
      authorization: `Bearer ${SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ user_id: UUID, email: "jane@example.com" }),
  });
}

async function call(route: unknown, path: string) {
  const res = await post(route)({ request: workerRequest(path) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const REMINDERS = "/api/public/reminders/run";
const FLUSH = "/api/public/notifications/flush";
const RELEASE = "/api/public/payments/release-holds";
const REELS = "/api/public/reels/process";

const summary = { sent: 1, checked: 2, pushed: 1, removed: 0, deferred: 0 };

beforeEach(() => {
  h.auth = "ok";
  h.rows.length = 0;
  h.reporterThrows = false;
  h.reporterCalls.length = 0;
  h.sweeps.mockReset();
  h.flushQueue.mockReset();
  h.rpc.mockReset();
  h.reelsQueue = { data: [], error: null };
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("LOVABLE_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("reminders run (P2-7a)", () => {
  const failedRun = () => ({
    reminders: summary,
    invitePushes: null,
    attendancePrompts: { prompted: 0 },
    errors: [
      `invitation check failed: invalid input syntax for type uuid: "${UUID}"`,
      `block read failed for jane@example.com`,
    ],
  });
  const failedBody = {
    ok: false,
    ...summary,
    invitePushes: null,
    attendancePrompts: { prompted: 0 },
    error: `invitation check failed: invalid input syntax for type uuid: "${UUID}"; block read failed for jane@example.com`,
  };

  it("a failed job: the same 500, and one row with the route and a scrubbed message", async () => {
    h.sweeps.mockResolvedValue(failedRun());
    expect(await call(RemindersRoute, REMINDERS)).toEqual({ status: 500, body: failedBody });

    expect(h.reporterCalls).toHaveLength(1);
    expect(h.rows).toEqual([
      {
        source: "server",
        kind: "ssr",
        message:
          'send-game-reminders: invitation check failed: invalid input syntax for type uuid: "[value]"; block read failed for [email]',
        route: REMINDERS,
        fingerprint: expect.stringMatching(/^[a-z0-9]{1,32}$/),
        release: null,
        signed_in: false,
      },
    ]);
    const saved = JSON.stringify(h.rows);
    for (const leak of [UUID, "jane@example.com", SECRET, "cron", "checked", "prompted"]) {
      expect(saved).not.toContain(leak);
    }
  });

  it("a run that works reports nothing", async () => {
    h.sweeps.mockResolvedValue({
      reminders: summary,
      invitePushes: null,
      attendancePrompts: null,
      errors: [],
    });
    expect(await call(RemindersRoute, REMINDERS)).toEqual({
      status: 200,
      body: { ok: true, ...summary, invitePushes: null, attendancePrompts: null },
    });
    expect(h.reporterCalls).toEqual([]);
    expect(h.rows).toEqual([]);
  });

  it("a caller without the worker secret gets 401 and nothing is reported", async () => {
    h.auth = "unauthorized";
    expect(await call(RemindersRoute, REMINDERS)).toEqual({
      status: 401,
      body: { error: "Unauthorized" },
    });
    expect(h.sweeps).not.toHaveBeenCalled();
    expect(h.reporterCalls).toEqual([]);
    expect(h.rows).toEqual([]);
  });

  it("a run that throws answers a JSON 500 and is reported once", async () => {
    h.sweeps.mockRejectedValue(new Error(`connect ECONNREFUSED for ${UUID}`));
    expect(await call(RemindersRoute, REMINDERS)).toEqual({
      status: 500,
      body: { error: "worker_failed" },
    });
    expect(h.reporterCalls).toHaveLength(1);
    expect(h.rows.map((r) => [r.message, r.route])).toEqual([
      ["send-game-reminders: Error: connect ECONNREFUSED for [id]", REMINDERS],
    ]);
  });

  it("a reporter that throws leaves the answer exactly as it was", async () => {
    h.sweeps.mockResolvedValue(failedRun());
    h.reporterThrows = true;
    expect(await call(RemindersRoute, REMINDERS)).toEqual({ status: 500, body: failedBody });
    expect(h.reporterCalls).toHaveLength(1);
    expect(h.rows).toEqual([]);

    h.sweeps.mockRejectedValue(new Error("boom"));
    expect(await call(RemindersRoute, REMINDERS)).toEqual({
      status: 500,
      body: { error: "worker_failed" },
    });
  });
});

describe("the other worker routes (P2-7a)", () => {
  it("notification flush: a failed flush keeps its 500 and is reported once", async () => {
    h.flushQueue.mockRejectedValue(new Error("scheduled_notifications read failed: timeout"));
    expect(await call(FlushRoute, FLUSH)).toEqual({
      status: 500,
      body: { error: "scheduled_notifications read failed: timeout" },
    });
    expect(h.rows.map((r) => [r.message, r.route, r.signed_in])).toEqual([
      ["flush-held-notifications: scheduled_notifications read failed: timeout", FLUSH, false],
    ]);
  });

  it("notification flush: a flush that works, or a 401, reports nothing", async () => {
    h.flushQueue.mockResolvedValue({ processed: 0, sent: 0, overdue: 0 });
    expect((await call(FlushRoute, FLUSH)).status).toBe(200);
    h.auth = "unauthorized";
    expect((await call(FlushRoute, FLUSH)).status).toBe(401);
    expect(h.reporterCalls).toEqual([]);
  });

  it("release holds: a failed sweep keeps its 500 and is reported once", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: `permission denied for function release_expired_payment_holds` },
    });
    expect(await call(ReleaseHoldsRoute, RELEASE)).toEqual({
      status: 500,
      body: { error: "permission denied for function release_expired_payment_holds" },
    });
    expect(h.rows.map((r) => [r.message, r.route])).toEqual([
      [
        "release-expired-payment-holds: permission denied for function release_expired_payment_holds",
        RELEASE,
      ],
    ]);
  });

  it("release holds: a sweep that works reports nothing", async () => {
    h.rpc.mockResolvedValue({ data: 2, error: null });
    expect(await call(ReleaseHoldsRoute, RELEASE)).toEqual({
      status: 200,
      body: { ok: true, released: 2 },
    });
    expect(h.reporterCalls).toEqual([]);
  });

  it("reels: no AI key and a failed queue read are each reported once, as the code the answer carries", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    expect(await call(ReelsRoute, REELS)).toEqual({
      status: 500,
      body: { error: "Missing LOVABLE_API_KEY" },
    });
    vi.stubEnv("LOVABLE_API_KEY", "test-key");
    h.reelsQueue = { data: [], error: { message: `relation "highlight_reels" does not exist` } };
    expect(await call(ReelsRoute, REELS)).toEqual({
      status: 500,
      body: { error: "queue_read_failed" },
    });
    expect(h.rows.map((r) => [r.message, r.route])).toEqual([
      ["process-highlight-reels: Missing LOVABLE_API_KEY", REELS],
      ["process-highlight-reels: queue_read_failed", REELS],
    ]);
  });

  it("reels: an empty queue, or a 401, reports nothing", async () => {
    expect(await call(ReelsRoute, REELS)).toEqual({
      status: 200,
      body: { processed: 0, skipped: 0, results: [] },
    });
    h.auth = "unauthorized";
    expect((await call(ReelsRoute, REELS)).status).toBe(401);
    expect(h.reporterCalls).toEqual([]);
  });
});
