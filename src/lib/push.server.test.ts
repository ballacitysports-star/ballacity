import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What deliverPush writes through the service-role client, and the answers it gets. */
const { db, curfewGateFor } = vi.hoisted(() => ({
  db: {
    inserts: [] as { table: string; row: Record<string, unknown> }[],
    queueError: null as { message: string } | null,
  },
  curfewGateFor: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        db.inserts.push({ table, row });
        if (table === "scheduled_notifications" && db.queueError) {
          return { data: null, error: db.queueError };
        }
        return { data: null, error: null };
      },
    }),
  },
}));
vi.mock("@/lib/push-curfew.server", () => ({ curfewGateFor }));

import { deliverPush } from "./push.server";

const NOW = new Date("2026-11-08T12:00:00.000Z");
const fetchMock = vi.fn(
  async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify({ id: "os-1", recipients: 1 }), { status: 200 }),
);
const queued = () => db.inserts.filter((i) => i.table === "scheduled_notifications");
const logged = () => db.inserts.filter((i) => i.table === "notification_delivery_log");
const push = {
  userId: "kid",
  title: "Run starts in 2 hours",
  body: "Sun, Nov 8 · 2:00 PM",
  url: "https://ballacity.test/games/g1",
  notificationId: "notif-1",
};

beforeEach(() => {
  db.inserts = [];
  db.queueError = null;
  curfewGateFor.mockReset();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ONESIGNAL_REST_API_KEY", "test-key");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("deliverPush: the minor-safety gate fails closed (P2-7 review)", () => {
  it("holds the push for the flush job, and never sends it, when the curfew check fails", async () => {
    curfewGateFor.mockRejectedValue(new Error("profile lookup failed: db down"));
    const out = await deliverPush(push);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: true, queued: true, deliverAfter: NOW.toISOString() });
    // deliver_after = now: the flush job reads the settings again on its next run.
    expect(queued()).toEqual([
      {
        table: "scheduled_notifications",
        row: {
          user_id: "kid",
          title: push.title,
          body: push.body,
          url: push.url,
          channel: "push",
          reason: "curfew_check_failed",
          deliver_after: NOW.toISOString(),
        },
      },
    ]);
    expect(logged().map((l) => l.row)).toMatchObject([
      { status: "skipped", error: "curfew_check_failed", notification_id: "notif-1" },
    ]);
  });

  it("logs a hold that cannot be written as failed, and still does not send", async () => {
    curfewGateFor.mockRejectedValue(new Error("db down"));
    db.queueError = { message: "permission denied" };
    const out = await deliverPush(push);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: false, reason: "queue_failed" });
    expect(logged().map((l) => l.row)).toMatchObject([
      {
        status: "failed",
        error: "queue_failed",
        detail: { held_for: "curfew_check_failed", message: "permission denied" },
      },
    ]);
  });

  it("logs a quiet-hours hold that cannot be written as failed, not as held", async () => {
    curfewGateFor.mockResolvedValue({ action: "queue", deliverAfter: "2026-11-08T11:00:00.000Z" });
    db.queueError = { message: "permission denied" };
    expect(await deliverPush(push)).toEqual({ ok: false, reason: "queue_failed" });
    expect(logged().map((l) => l.row)).toMatchObject([
      {
        status: "failed",
        error: "queue_failed",
        detail: { held_for: "minor_notification_curfew" },
      },
    ]);
  });

  it("holds a minor's push until their quiet hours end, as before", async () => {
    const after = "2026-11-08T11:00:00.000Z";
    curfewGateFor.mockResolvedValue({ action: "queue", deliverAfter: after });
    expect(await deliverPush(push)).toEqual({ ok: true, queued: true, deliverAfter: after });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queued()[0]?.row).toMatchObject({
      reason: "minor_notification_curfew",
      deliver_after: after,
    });
    expect(logged()[0]?.row).toMatchObject({
      status: "skipped",
      error: "minor_notification_curfew",
      detail: { deliver_after: after },
    });
  });

  it("does not send when a guardian switched the child's notifications off", async () => {
    curfewGateFor.mockResolvedValue({ action: "blocked", reason: "guardian_notifications_off" });
    expect(await deliverPush(push)).toEqual({ ok: false, reason: "guardian_notifications_off" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queued()).toEqual([]);
  });
});

describe("deliverPush: a push with an expiry is never delivered late (P2-7 review)", () => {
  const start = "2026-11-08T14:00:00.000Z";

  it.each([
    ["at", start],
    ["after", "2026-11-08T15:00:00.000Z"],
  ])("drops a push that would come out of the hold %s its expiry", async (_when, after) => {
    curfewGateFor.mockResolvedValue({ action: "queue", deliverAfter: after });
    const out = await deliverPush({ ...push, expiresAt: start });
    expect(out).toEqual({ ok: false, reason: "expired" });
    expect(queued()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged().map((l) => l.row)).toMatchObject([
      {
        status: "skipped",
        error: "expired",
        detail: { held_for: "minor_notification_curfew", deliver_after: after, expires_at: start },
      },
    ]);
  });

  it("still holds a push whose hold ends before its expiry", async () => {
    curfewGateFor.mockResolvedValue({ action: "queue", deliverAfter: "2026-11-08T13:59:00.000Z" });
    expect(await deliverPush({ ...push, expiresAt: start })).toMatchObject({ queued: true });
    expect(queued()).toHaveLength(1);
  });

  it("drops a push already past its expiry without sending it", async () => {
    const out = await deliverPush({ ...push, expiresAt: "2026-11-08T11:59:00.000Z" });
    expect(out).toEqual({ ok: false, reason: "expired" });
    expect(curfewGateFor).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged()[0]?.row).toMatchObject({ status: "skipped", error: "expired" });
  });
});

describe("deliverPush: sending", () => {
  it("sends at once when the gate allows it, and links the log row to the in-app notification", async () => {
    curfewGateFor.mockResolvedValue({ action: "send" });
    expect(await deliverPush({ ...push, expiresAt: "2026-11-08T14:00:00.000Z" })).toEqual({
      ok: true,
      recipients: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      include_aliases: { external_id: ["kid"] },
      headings: { en: push.title },
      contents: { en: push.body },
    });
    expect(queued()).toEqual([]);
    expect(logged().map((l) => l.row)).toMatchObject([
      { status: "sent", notification_id: "notif-1", channel: "push" },
    ]);
  });
});
