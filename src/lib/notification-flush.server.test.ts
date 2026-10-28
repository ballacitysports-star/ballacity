/* eslint-disable @typescript-eslint/no-explicit-any -- a hand-rolled in-memory Supabase stub */
import { describe, expect, it, vi } from "vitest";
import {
  MAX_ATTEMPTS,
  backoffMs,
  flushQueue,
  type FlushDeps,
  type Gate,
  type QueuedRow,
} from "./notification-flush.server";

const NOW = new Date("2026-10-28T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

type Row = QueuedRow & {
  status: string;
  deliver_after: string;
  last_error?: string | null;
  sent_at?: string | null;
};

/** Select/eq/lte/order/limit, update().eq()...select(), insert. Updates apply when awaited. */
function fakeAdmin(rows: Row[]) {
  const log: any[] = [];
  const admin = {
    log,
    rows,
    from(table: string) {
      if (table === "notification_delivery_log") {
        return { insert: async (r: any) => (log.push(r), { error: null }) };
      }
      // Filters are applied when the query runs, in one step, as a database
      // would: two overlapping updates cannot both match the same old value.
      const filters: ((r: any) => boolean)[] = [];
      let patch: Record<string, unknown> | null = null;
      let max = Infinity;
      const q: any = {
        select: () => q,
        update: (p: Record<string, unknown>) => ((patch = p), q),
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
        lte: (k: string, v: string) => (filters.push((r) => String(r[k]) <= v), q),
        order: () => q,
        limit: (n: number) => ((max = n), q),
        then: (resolve: (v: unknown) => unknown) => {
          const matched = rows.filter((r) => filters.every((f) => f(r))).slice(0, max);
          if (patch) {
            for (const r of matched) Object.assign(r, patch);
            return resolve({ data: matched.map((r) => ({ id: r.id })), error: null });
          }
          return resolve({ data: matched.map((r) => ({ ...r })), error: null });
        },
      };
      return q;
    },
  };
  return admin;
}

const row = (over: Partial<Row> = {}): Row => ({
  id: "n1",
  user_id: "kid",
  title: "Game tonight",
  body: "7pm",
  url: "/games/g1",
  attempts: 0,
  status: "queued",
  deliver_after: ago(60_000),
  ...over,
});

function deps(rows: Row[], over: Partial<FlushDeps> = {}) {
  const admin = fakeAdmin(rows);
  const send = vi.fn(async () => ({ ok: true as const, recipients: 1 }));
  const gateFor = vi.fn(async (): Promise<Gate> => ({ action: "send" }));
  return {
    admin,
    send,
    gateFor,
    deps: { admin, now: NOW, configured: true, gateFor, send, ...over } as FlushDeps,
  };
}

describe("flushQueue", () => {
  it("sends a due row once and marks it sent", async () => {
    const rows = [row()];
    const d = deps(rows);
    const s = await flushQueue(d.deps);
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(rows[0].status).toBe("sent");
    expect(rows[0].sent_at).toBe(NOW.toISOString());
    expect(s).toMatchObject({ processed: 1, sent: 1, failed: 0 });
    expect(d.admin.log[0]).toMatchObject({ user_id: "kid", status: "sent" });
  });

  it("ignores rows that are not yet due or already sent", async () => {
    const rows = [
      row({ id: "a", deliver_after: new Date(NOW.getTime() + 60_000).toISOString() }),
      row({ id: "b", status: "sent" }),
    ];
    const d = deps(rows);
    const s = await flushQueue(d.deps);
    expect(d.send).not.toHaveBeenCalled();
    expect(s.processed).toBe(0);
  });

  it("sends once when two flush calls overlap", async () => {
    const rows = [row()];
    const a = deps(rows);
    const b = deps(rows);
    const [sa, sb] = await Promise.all([flushQueue(a.deps), flushQueue(b.deps)]);
    expect(a.send.mock.calls.length + b.send.mock.calls.length).toBe(1);
    expect(sa.skipped + sb.skipped).toBe(1);
    expect(rows[0].status).toBe("sent");
  });

  it("cancels, and does not send, when the guardian has since switched notifications off", async () => {
    const rows = [row()];
    const d = deps(rows, {
      gateFor: async () => ({ action: "blocked", reason: "guardian_notifications_off" }),
    });
    const s = await flushQueue(d.deps);
    expect(d.send).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({
      status: "cancelled",
      last_error: "guardian_notifications_off",
    });
    expect(s.cancelled).toBe(1);
  });

  it("waits, and gives back the attempt, while the quiet window is still on", async () => {
    const later = new Date(NOW.getTime() + 3 * 3600_000).toISOString();
    const rows = [row({ attempts: 2 })];
    const d = deps(rows, { gateFor: async () => ({ action: "queue", deliverAfter: later }) });
    const s = await flushQueue(d.deps);
    expect(d.send).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ status: "queued", attempts: 2, deliver_after: later });
    expect(s.rescheduled).toBe(1);
  });

  it("holds the row, never sends, when the settings lookup fails", async () => {
    const rows = [row()];
    const d = deps(rows, {
      gateFor: async () => {
        throw new Error("db down");
      },
    });
    const s = await flushQueue(d.deps);
    expect(d.send).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ status: "queued", last_error: "settings_lookup_failed" });
    expect(s.retrying).toBe(1);
  });

  it("retries a failed send later with a longer wait each time, then gives up", async () => {
    const rows = [row()];
    const d = deps(rows, { send: vi.fn(async () => ({ ok: false as const, error: "http_503" })) });
    await flushQueue(d.deps);
    expect(rows[0]).toMatchObject({ status: "queued", attempts: 1, last_error: "http_503" });
    expect(new Date(rows[0].deliver_after).getTime()).toBe(NOW.getTime() + backoffMs(1));
    expect(backoffMs(3)).toBe(backoffMs(1) * 4);

    rows[0].attempts = MAX_ATTEMPTS - 1;
    rows[0].deliver_after = ago(1000);
    const s = await flushQueue(d.deps);
    expect(rows[0].status).toBe("failed");
    expect(s.failed).toBe(1);
  });

  it("treats a thrown send as a failure, not a crash", async () => {
    const rows = [row(), row({ id: "n2", user_id: "kid2" })];
    const send = vi.fn(async (r: QueuedRow) => {
      if (r.id === "n1") throw new Error("network");
      return { ok: true as const, recipients: 1 };
    });
    const d = deps(rows, { send });
    const s = await flushQueue(d.deps);
    expect(s).toMatchObject({ retrying: 1, sent: 1 });
  });

  it("fails rows rather than retrying forever when push is not configured", async () => {
    const rows = [row()];
    const d = deps(rows, { configured: false });
    await flushQueue(d.deps);
    expect(d.send).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ status: "failed", last_error: "not_configured" });
  });

  it("records a push nobody received as skipped, not sent", async () => {
    const rows = [row()];
    const d = deps(rows, { send: vi.fn(async () => ({ ok: true as const, recipients: 0 })) });
    await flushQueue(d.deps);
    expect(rows[0]).toMatchObject({ status: "sent", last_error: "no_subscribers" });
    expect(d.admin.log[0]).toMatchObject({ status: "skipped", error: "no_subscribers" });
  });

  it("reports rows more than an hour overdue", async () => {
    const rows = [row({ id: "late", deliver_after: ago(3 * 3600_000), attempts: 0 })];
    const d = deps(rows, {
      gateFor: async () => ({ action: "queue", deliverAfter: ago(2 * 3600_000) }),
    });
    const s = await flushQueue(d.deps);
    expect(s.overdue).toBe(1);
  });
});
