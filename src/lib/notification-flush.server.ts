/**
 * Sends push notifications that were held back by a minor's notification
 * curfew, once their quiet window has ended. Called by the flush route, which a
 * scheduler hits with the worker secret.
 *
 * What this guarantees, none of which the previous in-route loop did:
 *   * One send per row even if two flush calls overlap (a scheduler retry, two
 *     schedulers): a row is claimed with a compare-and-swap on `attempts`, and
 *     only the call that wins it sends.
 *   * The guardian's settings are checked again at send time. If notifications
 *     were switched off after the row was queued, the row is cancelled, not
 *     sent. If the quiet window moved or has not ended, the row waits.
 *   * A failed settings lookup holds the row; it never sends a minor a push on a
 *     guess.
 *   * Failures retry with a growing delay, up to MAX_ATTEMPTS, then stop.
 *   * The result reports how many rows are overdue, so a monitor can alert when
 *     the scheduler has stopped.
 */

export const BATCH = 50;
export const MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 5 * 60_000;
const OVERDUE_AFTER_MS = 60 * 60_000;

// The service-role client, narrowed to what this file calls.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (table: string) => any };

export type QueuedRow = {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  url: string | null;
  attempts: number | null;
};

export type Gate =
  | { action: "send" }
  | { action: "blocked"; reason: string }
  | { action: "queue"; deliverAfter: string };

export type SendResult = { ok: true; recipients: number | null } | { ok: false; error: string };

export type FlushDeps = {
  admin: Admin;
  now?: Date;
  /** Current curfew/guardian decision for a user. */
  gateFor: (userId: string, now: Date) => Promise<Gate>;
  /** Whether the provider is configured; when not, rows are failed, not retried forever. */
  configured: boolean;
  send: (row: QueuedRow) => Promise<SendResult>;
};

export type FlushSummary = {
  processed: number;
  sent: number;
  rescheduled: number;
  cancelled: number;
  retrying: number;
  failed: number;
  /** Rows another call claimed first. */
  skipped: number;
  /** Rows still queued more than an hour past their delivery time. */
  overdue: number;
};

export function backoffMs(attempts: number): number {
  return BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1);
}

export async function flushQueue(deps: FlushDeps): Promise<FlushSummary> {
  const { admin, gateFor, send, configured } = deps;
  const now = deps.now ?? new Date();
  const nowIso = now.toISOString();
  const summary: FlushSummary = {
    processed: 0,
    sent: 0,
    rescheduled: 0,
    cancelled: 0,
    retrying: 0,
    failed: 0,
    skipped: 0,
    overdue: 0,
  };

  const { data: rows, error } = await admin
    .from("scheduled_notifications")
    .select("id, user_id, title, body, url, attempts")
    .eq("status", "queued")
    .lte("deliver_after", nowIso)
    .order("deliver_after", { ascending: true })
    .limit(BATCH);
  if (error) throw new Error(error.message);

  const log = async (row: QueuedRow, status: "sent" | "failed" | "skipped", err: string | null) => {
    try {
      await admin.from("notification_delivery_log").insert({
        user_id: row.user_id,
        channel: "push",
        status,
        provider: "onesignal",
        error: err,
        detail: { queued: true },
      });
    } catch {
      /* the log is best effort */
    }
  };

  for (const row of (rows ?? []) as QueuedRow[]) {
    summary.processed += 1;
    const before = row.attempts ?? 0;

    // Claim: only one caller can move attempts from `before` to `before + 1`
    // while the row is still queued.
    const { data: claimed } = await admin
      .from("scheduled_notifications")
      .update({ attempts: before + 1 })
      .eq("id", row.id)
      .eq("status", "queued")
      .eq("attempts", before)
      .select("id");
    if (!claimed || claimed.length === 0) {
      summary.skipped += 1;
      continue;
    }
    const attempts = before + 1;

    const settle = (patch: Record<string, unknown>) =>
      admin.from("scheduled_notifications").update(patch).eq("id", row.id);

    // The guardian's settings as they are now, not as they were when queued.
    let gate: Gate | null = null;
    try {
      gate = await gateFor(row.user_id, now);
    } catch {
      gate = null;
    }

    if (gate && gate.action === "blocked") {
      await settle({ status: "cancelled", last_error: gate.reason });
      await log(row, "skipped", gate.reason);
      summary.cancelled += 1;
      continue;
    }
    if (gate && gate.action === "queue") {
      // Still inside a quiet window: wait, and give back the attempt we took.
      await settle({ attempts: before, deliver_after: gate.deliverAfter, last_error: null });
      summary.rescheduled += 1;
      continue;
    }

    const giveUp = attempts >= MAX_ATTEMPTS;
    const retry = async (error: string) => {
      if (giveUp) {
        await settle({ status: "failed", last_error: error });
        await log(row, "failed", error);
        summary.failed += 1;
      } else {
        await settle({
          last_error: error,
          deliver_after: new Date(now.getTime() + backoffMs(attempts)).toISOString(),
        });
        summary.retrying += 1;
      }
    };

    if (!gate) {
      await retry("settings_lookup_failed");
      continue;
    }
    if (!configured) {
      await settle({ status: "failed", last_error: "not_configured" });
      await log(row, "failed", "not_configured");
      summary.failed += 1;
      continue;
    }

    let result: SendResult;
    try {
      result = await send(row);
    } catch (e) {
      result = { ok: false, error: String(e).slice(0, 300) };
    }
    if (result.ok) {
      await settle({
        status: "sent",
        sent_at: nowIso,
        last_error: result.recipients === 0 ? "no_subscribers" : null,
      });
      await log(
        row,
        result.recipients === 0 ? "skipped" : "sent",
        result.recipients === 0 ? "no_subscribers" : null,
      );
      summary.sent += 1;
    } else {
      await retry(result.error);
    }
  }

  // Monitoring signal: queued rows well past due mean the scheduler is behind.
  try {
    const cutoff = new Date(now.getTime() - OVERDUE_AFTER_MS).toISOString();
    const { data: late } = await admin
      .from("scheduled_notifications")
      .select("id")
      .eq("status", "queued")
      .lte("deliver_after", cutoff)
      .limit(1000);
    summary.overdue = (late ?? []).length;
  } catch {
    /* monitoring only */
  }
  return summary;
}
