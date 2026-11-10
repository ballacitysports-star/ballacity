/**
 * P2-7: sending due game reminders, shared by the player's own flush (the app, on load and on an
 * interval) and the scheduled sweep (pg_cron → /api/public/reminders/run), so reminders arrive
 * while the app is closed.
 *
 * Each reminder is CLAIMED before its notification is written: last_sent_offset moves only if
 * it is still above the offset being sent, so two callers at once (the app and the scheduler,
 * or two tabs) send it once.
 *
 * Once the in-app notification is written, the reminder also goes to the player's phone through
 * deliverPush (OneSignal), unless they switched game-reminder push off. deliverPush holds a
 * minor's push during their quiet hours for the flush job and records each outcome in
 * notification_delivery_log.
 */
import { formatNotificationWhen } from "@/lib/format";
import { isAllowedIn, mergeNotifPrefs } from "@/lib/notification-prefs-core";
import { deliverPush } from "@/lib/push.server";

export type ReminderRow = {
  id: string;
  user_id: string;
  game_id: string;
  offsets: number[] | null;
  last_sent_offset: number | null;
};
export type ReminderGame = {
  id: string;
  title: string;
  date: string;
  location: string | null;
  all_day: boolean | null;
  status?: string | null;
};

/** The offset (minutes before start) to send now, or null. The largest window that has opened and was not sent. */
export function dueOffset(
  offsets: number[] | null,
  lastSent: number | null,
  minutesToStart: number,
): number | null {
  const candidates = (offsets ?? [])
    .map(Number)
    .filter((m) => Number.isFinite(m) && m > 0)
    .filter((m) => m >= minutesToStart)
    .filter((m) => lastSent == null || m < lastSent)
    .sort((a, b) => b - a);
  return candidates[0] ?? null;
}

export function leadText(offset: number): string {
  return offset >= 1440
    ? `${Math.round(offset / 1440)} day${offset >= 2880 ? "s" : ""}`
    : offset >= 60
      ? `${Math.round(offset / 60)} hour${offset >= 120 ? "s" : ""}`
      : `${offset} minutes`;
}

type Res<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
type Q<T> = Res<T> & {
  select: (c: string) => Q<T>;
  eq: (c: string, v: unknown) => Q<T>;
  in: (c: string, v: readonly unknown[]) => Q<T>;
  gt: (c: string, v: unknown) => Q<T>;
  lt: (c: string, v: unknown) => Q<T>;
  or: (f: string) => Q<T>;
  limit: (n: number) => Q<T>;
};
export type ReminderAdmin = {
  from: (t: string) => Q<unknown> & {
    insert: (row: Record<string, unknown>) => Res<unknown>;
    update: (row: Record<string, unknown>) => Q<unknown>;
  };
};

/**
 * Whether the player wants game reminders pushed to their phone: their saved preferences
 * (notification_preferences.prefs), merged exactly as the app merges them, so it is on unless
 * they switched it off. A failed read sends no push: the in-app notification is already
 * written, and a push the player may have turned off is never sent on a guess.
 */
async function wantsReminderPush(admin: ReminderAdmin, userId: string): Promise<boolean> {
  const { data, error } = await (admin
    .from("notification_preferences")
    .select("prefs")
    .eq("user_id", userId)
    .limit(1) as Q<unknown>);
  if (error) return false;
  const stored = ((data ?? []) as { prefs?: unknown }[])[0]?.prefs;
  const prefs = mergeNotifPrefs(
    stored && typeof stored === "object" ? (stored as Record<string, unknown>) : null,
  );
  return isAllowedIn(prefs, "game_reminder", "push");
}

/**
 * Sends due reminders. `userId` limits it to one player (their own flush); without it, the
 * sweep covers every player with an upcoming game in the next 8 days (the longest lead offered
 * is a week). Returns how many were sent.
 */
export async function sendDueGameReminders(
  admin: ReminderAdmin,
  opts: { userId?: string; now?: number; limit?: number } = {},
): Promise<{ sent: number; checked: number }> {
  const now = opts.now ?? Date.now();
  let q = admin
    .from("game_reminders")
    .select("id, user_id, game_id, offsets, last_sent_offset") as Q<unknown>;
  if (opts.userId) q = q.eq("user_id", opts.userId);
  const { data: rows, error } = await q.limit(opts.limit ?? 2000);
  if (error) throw new Error(error.message);
  const reminders = ((rows ?? []) as ReminderRow[]).filter((r) => (r.offsets ?? []).length > 0);
  if (reminders.length === 0) return { sent: 0, checked: 0 };

  const gameIds = [...new Set(reminders.map((r) => r.game_id))];
  const { data: games, error: gErr } = await (admin
    .from("hosted_games")
    .select("id, title, date, location, all_day, status")
    .in("id", gameIds)
    .gt("date", new Date(now).toISOString())
    .lt("date", new Date(now + 8 * 86_400_000).toISOString()) as Q<unknown>);
  if (gErr) throw new Error(gErr.message);
  const byId = new Map(((games ?? []) as ReminderGame[]).map((g) => [String(g.id), g]));

  let sent = 0;
  let checked = 0;
  // One preferences read per player per run, however many of their reminders are due.
  const pushWanted = new Map<string, Promise<boolean>>();
  for (const r of reminders) {
    const game = byId.get(r.game_id);
    if (!game || game.status === "cancelled") continue;
    const startMs = new Date(String(game.date)).getTime();
    if (!Number.isFinite(startMs) || startMs <= now) continue;
    checked += 1;
    const offset = dueOffset(r.offsets, r.last_sent_offset, (startMs - now) / 60000);
    if (offset == null) continue;

    // Claim: only one caller moves last_sent_offset past this offset.
    const claim = admin
      .from("game_reminders")
      .update({ last_sent_offset: offset })
      .eq("id", r.id)
      .or(`last_sent_offset.is.null,last_sent_offset.gt.${offset}`)
      .select("id") as Q<unknown>;
    const { data: claimed, error: cErr } = await claim;
    if (cErr || !Array.isArray(claimed) || claimed.length === 0) continue;

    const title = `${game.title} starts in ${leadText(offset)}`;
    // All-day games never surface a clock time in reminders.
    const when = formatNotificationWhen({ date: String(game.date), allDay: !!game.all_day });
    const link = `/games/${r.game_id}`;
    const { error: insErr } = await admin.from("notifications").insert({
      user_id: r.user_id,
      type: "game_reminder",
      title,
      body:
        [when, game.location ? `Where: ${game.location}` : null].filter(Boolean).join(" · ") ||
        null,
      link,
    });
    if (insErr) {
      // Give the claim back so the next run tries again.
      await admin
        .from("game_reminders")
        .update({ last_sent_offset: r.last_sent_offset })
        .eq("id", r.id);
      continue;
    }
    sent += 1;

    // Then the phone, with the game's title and start time only: no venue on a lock screen.
    let wanted = pushWanted.get(r.user_id);
    if (!wanted) {
      wanted = wantsReminderPush(admin, r.user_id).catch(() => false);
      pushWanted.set(r.user_id, wanted);
    }
    if (await wanted) {
      try {
        await deliverPush({ userId: r.user_id, title, body: when, url: link });
      } catch (e) {
        // A push is best effort; the notification row is the record.
        console.warn("[reminders] push failed", e);
      }
    }
  }
  return { sent, checked };
}
