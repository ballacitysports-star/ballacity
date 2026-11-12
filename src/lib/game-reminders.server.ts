/**
 * P2-7: sending due game reminders, shared by the player's own flush (the app, on load and on an
 * interval) and the scheduled sweep (pg_cron → /api/public/reminders/run), so reminders arrive
 * while the app is closed.
 *
 * Who gets one is decided on every run from the game's roster and join requests, not from the
 * reminder row alone (rows are written at join and at join request and are not cleared on leave):
 *   - a player with a place in the game (a game_participants row), or whose request the host
 *     approved for a game with no fee (and their guardian too, if they have an active guardian
 *     link; see readRecipients): the in-app reminder, and a push to their phone unless they
 *     switched game-reminder push off;
 *   - a player whose join request is otherwise still open (pending, or approved but not yet a
 *     place: a fee to pay, or a guardian still to approve): the in-app reminder only;
 *   - anyone else (declined, withdrew, left, removed): nothing, and their reminder row for that
 *     game is deleted so later runs stop checking it.
 *
 * Each reminder is CLAIMED before its notification is written: last_sent_offset moves only if
 * it is still above the offset being sent, so two callers at once (the app and the scheduler,
 * or two tabs) send it once. When several windows have opened at once (the player joined late),
 * one reminder goes out, for the smallest of them, or for a smaller one that opens within its
 * margin (dueOffset); the claim passes the larger ones with it.
 *
 * pg_net stops waiting for the scheduled call after 5 seconds, so a run stops claiming after
 * RUN_BUDGET_MS and leaves the rest due for the next run, and the pushes go out after the in-app
 * rows are written, PUSH_CONCURRENCY at a time. deliverPush holds a minor's push during their
 * quiet hours for the flush job (or drops it if it would arrive once the game has started) and
 * records each outcome in notification_delivery_log.
 */
import { formatDatedWhen, formatNotificationWhen } from "@/lib/format";
import { isAllowedIn, mergeNotifPrefs } from "@/lib/notification-prefs-core";
import { deliverPush, type PushInput } from "@/lib/push.server";

/** A run stops claiming reminders once it has taken this long; the rest stay due. */
export const RUN_BUDGET_MS = 3_000;
/** Pushes in flight at once. */
export const PUSH_CONCURRENCY = 4;
/** Due reminders one run takes on, soonest game first. Also keeps its .in() lists short. */
export const MAX_DUE_PER_RUN = 100;
/** Join request statuses that are still open: the player may yet get a place. */
const OPEN_REQUEST_STATUSES = ["pending", "approved"];

export type ReminderRow = {
  id: string;
  user_id: string;
  game_id: string;
  offsets: number[] | null;
  last_sent_offset: number | null;
  updated_at: string;
};
export type ReminderGame = {
  id: string;
  title: string;
  date: string;
  location: string | null;
  all_day: boolean | null;
  status?: string | null;
  /** The game's payee (private_sec.game_payee is the host): only their payment settings count. */
  host_id?: string | null;
  /** The listed price, the fee when the payee has no payment settings for the game. */
  price?: number | null;
};

export type ReminderRunSummary = {
  /** In-app reminders written. */
  sent: number;
  /** Reminders whose game is still ahead. */
  checked: number;
  /** Pushes handed to deliverPush (it may still hold or skip one; see the delivery log). */
  pushed: number;
  /** Reminder rows deleted: the player no longer has a place or an open request. */
  removed: number;
  /** Due reminders left for the next run: past the run's budget or its cap. */
  deferred: number;
};

/**
 * How soon a window that has not opened yet must open to go out with one that has: 15 minutes,
 * or a ninth of the window when that is longer (2 hours 40 minutes for a day).
 * - 15 minutes is three runs of the sweep (every 5 minutes), so a late joiner does not get the
 *   same reminder again a few minutes later. A ninth alone would not do that for small windows
 *   (3 minutes for 30, less than one run).
 * - A ninth matches leadText: it names the whole window while the time left is within a tenth of
 *   the time left, which is up to ten ninths of the window (1600 minutes still reads "starts in
 *   1 day"). So whatever is sent now reads exactly like the window it stands for, and that window
 *   is never sent again with the same words.
 */
function earlyMargin(window: number): number {
  return Math.max(15, window / 9);
}

/**
 * The window (minutes before start) to send now, or null. Nothing is due until a window that
 * was not sent has opened. Then the SMALLEST unsent window that has opened, or opens within its
 * margin (earlyMargin), is sent, and claiming it passes the larger ones too: a player who joins
 * 100 minutes before a game with [1440, 120] gets one reminder, not "1 day" and then "2 hours"
 * minutes later, and one who joins 125 minutes before gets "2 hours" once, not again when the
 * 2-hour window opens 5 minutes later. The margin never makes a reminder due by itself.
 */
export function dueOffset(
  offsets: number[] | null,
  lastSent: number | null,
  minutesToStart: number,
): number | null {
  const unsent = (offsets ?? [])
    .map(Number)
    .filter((m) => Number.isFinite(m) && m > 0)
    .filter((m) => lastSent == null || m < lastSent);
  if (!unsent.some((m) => m >= minutesToStart)) return null;
  return Math.min(...unsent.filter((m) => m + earlyMargin(m) >= minutesToStart));
}

/**
 * The time left before a game, as a reminder words it: "25 minutes", "1 hour 40 minutes",
 * "2 hours", "35 hours", "1 day", "7 days". Whole hours or a whole day when that is within a
 * tenth of the time left, hours and minutes under 3 hours otherwise, whole days from 1.5 days.
 */
export function leadText(minutesLeft: number): string {
  const m = Math.max(1, Math.round(minutesLeft));
  const n = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"}`;
  if (m < 60) return n(m, "minute");
  const days = Math.round(m / 1440);
  if (days >= 2 || (days === 1 && Math.abs(m - 1440) <= m / 10)) return n(days, "day");
  const hours = Math.round(m / 60);
  if (m >= 180 || Math.abs(m - hours * 60) <= m / 10) return n(hours, "hour");
  return `${n(Math.floor(m / 60), "hour")} ${n(m % 60, "minute")}`;
}

type Res<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
type Q<T> = Res<T> & {
  select: (c: string) => Q<T>;
  eq: (c: string, v: unknown) => Q<T>;
  in: (c: string, v: readonly unknown[]) => Q<T>;
  gt: (c: string, v: unknown) => Q<T>;
  lt: (c: string, v: unknown) => Q<T>;
  lte: (c: string, v: unknown) => Q<T>;
  or: (f: string) => Q<T>;
  limit: (n: number) => Q<T>;
};
export type ReminderAdmin = {
  from: (t: string) => Q<unknown> & {
    insert: (row: Record<string, unknown>) => Q<unknown>;
    update: (row: Record<string, unknown>) => Q<unknown>;
    delete: () => Q<unknown>;
  };
};

const pairKey = (gameId: string, userId: string) => `${gameId}\u0000${userId}`;

type SettingsRow = { game_id: string; host_id: string; entry_fee: number; created_at: string };
type RequestRow = {
  game_id: string;
  player_id: string;
  status: string;
  guardian_approved_at: string | null;
};

/**
 * The games that charge no fee, by the rule the app and the database use (refreshStatus on the
 * game page, quoteGamePayPalFee, enforce_game_join_gate): the entry fee of the newest payment
 * settings row held by the game's payee, or the game's price when the payee has none. The payee is
 * private_sec.game_payee, the game's host (hosted_games.host_id), read with the games instead of
 * one game_payee_id call per game; a row held by anyone else is ignored, as there.
 */
function gamesWithoutFee(games: ReminderGame[], settings: SettingsRow[]): Set<string> {
  const payeeOf = new Map(games.map((g) => [String(g.id), g.host_id]));
  const newest = new Map<string, SettingsRow>();
  for (const s of settings) {
    const payee = payeeOf.get(String(s.game_id));
    if (payee == null || String(s.host_id) !== String(payee)) continue;
    const seen = newest.get(String(s.game_id));
    if (!seen || String(s.created_at) > String(seen.created_at)) newest.set(String(s.game_id), s);
  }
  const fee = (g: ReminderGame) => Number(newest.get(String(g.id))?.entry_fee ?? g.price ?? 0);
  return new Set(games.filter((g) => !(fee(g) > 0)).map((g) => String(g.id)));
}

/**
 * Who among these players has a place in each game, and who has an open join request, from one
 * query per table for the run: the roster (game_participants), open requests (join_requests,
 * pending or approved), the games' payment settings and the players' active guardian links.
 *
 * A place is a roster row, or a request the host approved for a game with no fee: nothing on the
 * server rosters that player (reviewJoinRequest only changes the status; the game page's
 * refreshStatus adds the row when they next open it), and they were told "You're in". For a
 * player with an active guardian link (guardian_links, status active) the request also needs the
 * guardian's approval (guardian_approved_at), as the game page and the roster gate require.
 * Pending requests, and approved ones on a paid game, are open requests without a place.
 *
 * Throws when any read fails, so nothing is sent or deleted on a guess; the reminders stay due
 * for the next run.
 */
async function readRecipients(admin: ReminderAdmin, games: ReminderGame[], userIds: string[]) {
  const gameIds = games.map((g) => String(g.id));
  const [roster, requests, settings, guardians] = await Promise.all([
    admin
      .from("game_participants")
      .select("game_id, user_id")
      .in("game_id", gameIds)
      .in("user_id", userIds) as Q<unknown>,
    admin
      .from("join_requests")
      .select("game_id, player_id, status, guardian_approved_at")
      .in("game_id", gameIds)
      .in("player_id", userIds)
      .in("status", OPEN_REQUEST_STATUSES) as Q<unknown>,
    admin
      .from("game_payment_settings")
      .select("game_id, host_id, entry_fee, created_at")
      .in("game_id", gameIds) as Q<unknown>,
    admin
      .from("guardian_links")
      .select("child_user_id")
      .in("child_user_id", userIds)
      .eq("status", "active") as Q<unknown>,
  ]);
  if (roster.error) throw new Error(`roster read failed: ${roster.error.message}`);
  if (requests.error) throw new Error(`join request read failed: ${requests.error.message}`);
  if (settings.error) throw new Error(`payment settings read failed: ${settings.error.message}`);
  if (guardians.error) throw new Error(`guardian link read failed: ${guardians.error.message}`);
  const free = gamesWithoutFee(games, (settings.data ?? []) as SettingsRow[]);
  const guarded = new Set(
    ((guardians.data ?? []) as { child_user_id: string }[]).map((l) => String(l.child_user_id)),
  );
  const places = new Set(
    ((roster.data ?? []) as { game_id: string; user_id: string }[]).map((p) =>
      pairKey(String(p.game_id), String(p.user_id)),
    ),
  );
  const openRequests = new Set<string>();
  for (const q of (requests.data ?? []) as RequestRow[]) {
    const key = pairKey(String(q.game_id), String(q.player_id));
    openRequests.add(key);
    const guardianOk = !guarded.has(String(q.player_id)) || q.guardian_approved_at != null;
    if (q.status === "approved" && free.has(String(q.game_id)) && guardianOk) places.add(key);
  }
  return { places, openRequests };
}

/**
 * Which of these players want game reminders pushed to their phone: their saved preferences
 * (notification_preferences.prefs), merged exactly as the app merges them, so it is on unless
 * they switched it off. One query for the run. A failed read pushes to nobody: the in-app
 * reminders are written either way, and a push a player may have turned off is never sent on
 * a guess.
 */
async function playersWantingPush(admin: ReminderAdmin, userIds: string[]): Promise<Set<string>> {
  try {
    const { data, error } = await (admin
      .from("notification_preferences")
      .select("user_id, prefs")
      .in("user_id", userIds) as Q<unknown>);
    if (error) throw new Error(error.message);
    const stored = new Map(
      ((data ?? []) as { user_id: string; prefs?: unknown }[]).map((r) => [
        String(r.user_id),
        r.prefs,
      ]),
    );
    return new Set(
      userIds.filter((u) => {
        const p = stored.get(u);
        const prefs = mergeNotifPrefs(
          p && typeof p === "object" ? (p as Record<string, unknown>) : null,
        );
        return isAllowedIn(prefs, "game_reminder", "push");
      }),
    );
  } catch (e) {
    console.warn("[reminders] preferences unavailable; no pushes this run", e);
    return new Set();
  }
}

/** Runs `task` over `items`, at most `limit` at a time, and waits for every one to settle. */
async function settleWithLimit<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<unknown>,
): Promise<PromiseSettledResult<unknown>[]> {
  const results: PromiseSettledResult<unknown>[] = [];
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      [results[i]] = await Promise.allSettled([Promise.resolve().then(() => task(items[i]!))]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

/**
 * Sends due reminders. `userId` limits it to one player (their own flush); without it, the
 * sweep covers every player with an upcoming game in the next 8 days (the longest lead offered
 * is a week). `clock` is the wall clock the run budget is measured on (tests inject one).
 */
export async function sendDueGameReminders(
  admin: ReminderAdmin,
  opts: {
    userId?: string;
    now?: number;
    limit?: number;
    clock?: () => number;
    budgetMs?: number;
    maxDue?: number;
  } = {},
): Promise<ReminderRunSummary> {
  const clock = opts.clock ?? Date.now;
  const startedAt = clock();
  const now = opts.now ?? Date.now();
  const summary: ReminderRunSummary = { sent: 0, checked: 0, pushed: 0, removed: 0, deferred: 0 };

  let q = admin
    .from("game_reminders")
    .select("id, user_id, game_id, offsets, last_sent_offset, updated_at") as Q<unknown>;
  if (opts.userId) q = q.eq("user_id", opts.userId);
  const { data: rows, error } = await q.limit(opts.limit ?? 2000);
  if (error) throw new Error(error.message);
  const reminders = ((rows ?? []) as ReminderRow[]).filter((r) => (r.offsets ?? []).length > 0);
  if (reminders.length === 0) return summary;

  const gameIds = [...new Set(reminders.map((r) => r.game_id))];
  const { data: games, error: gErr } = await (admin
    .from("hosted_games")
    .select("id, title, date, location, all_day, status, host_id, price")
    .in("id", gameIds)
    .gt("date", new Date(now).toISOString())
    .lt("date", new Date(now + 8 * 86_400_000).toISOString()) as Q<unknown>);
  if (gErr) throw new Error(gErr.message);
  const byId = new Map(((games ?? []) as ReminderGame[]).map((g) => [String(g.id), g]));

  type Due = { r: ReminderRow; game: ReminderGame; startMs: number; offset: number };
  const due: Due[] = [];
  for (const r of reminders) {
    const game = byId.get(r.game_id);
    if (!game || game.status === "cancelled") continue;
    const startMs = new Date(String(game.date)).getTime();
    if (!Number.isFinite(startMs) || startMs <= now) continue;
    summary.checked += 1;
    const offset = dueOffset(r.offsets, r.last_sent_offset, (startMs - now) / 60000);
    if (offset != null) due.push({ r, game, startMs, offset });
  }
  if (due.length === 0) return summary;

  // Soonest game first: if the run runs out of time, the reminders left are the least urgent.
  due.sort((a, b) => a.startMs - b.startMs);
  const batch = due.slice(0, Math.max(1, opts.maxDue ?? MAX_DUE_PER_RUN));
  summary.deferred += due.length - batch.length;

  const batchUsers = [...new Set(batch.map((d) => d.r.user_id))];
  const batchGames = [...new Map(batch.map((d) => [d.r.game_id, d.game])).values()];
  const [{ places, openRequests }, wantsPush] = await Promise.all([
    readRecipients(admin, batchGames, batchUsers),
    playersWantingPush(admin, batchUsers),
  ]);
  const hasPlace = (d: Due) => places.has(pairKey(d.r.game_id, d.r.user_id));
  const isRecipient = (d: Due) =>
    hasPlace(d) || openRequests.has(pairKey(d.r.game_id, d.r.user_id));

  // No place and no open request: nothing is sent, and the row is deleted so later runs stop
  // checking it. Only rows nobody has saved since this run read them (any update stamps
  // updated_at): a player who joins again right now keeps the reminders they just set.
  const gone = batch.filter((d) => !isRecipient(d));
  if (gone.length > 0) {
    const newest = gone.map((d) => String(d.r.updated_at)).reduce((a, b) => (b > a ? b : a));
    const { data: deleted, error: dErr } = await (admin
      .from("game_reminders")
      .delete()
      .in(
        "id",
        gone.map((d) => d.r.id),
      )
      .lte("updated_at", newest)
      .select("id") as Q<unknown>);
    if (dErr) console.warn("[reminders] could not delete reminders of players who left", dErr);
    else summary.removed += Array.isArray(deleted) ? deleted.length : 0;
  }

  const work = batch.filter(isRecipient);
  const pushes: PushInput[] = [];
  for (let i = 0; i < work.length; i++) {
    if (clock() - startedAt >= (opts.budgetMs ?? RUN_BUDGET_MS)) {
      // Out of time: these stay unclaimed, so they are still due on the next run.
      summary.deferred += work.length - i;
      break;
    }
    const d = work[i]!;
    const { r, game, startMs, offset } = d;

    // Claim: only one caller moves last_sent_offset past this offset. Setting it to the smallest
    // opened window also passes every larger one.
    const claim = admin
      .from("game_reminders")
      .update({ last_sent_offset: offset })
      .eq("id", r.id)
      .or(`last_sent_offset.is.null,last_sent_offset.gt.${offset}`)
      .select("id") as Q<unknown>;
    const { data: claimed, error: cErr } = await claim;
    if (cErr || !Array.isArray(claimed) || claimed.length === 0) continue;

    // Worded from the minutes actually left, not from the window.
    const title = `${game.title} starts in ${leadText((startMs - now) / 60000)}`;
    // All-day games never surface a clock time in reminders.
    const whenFor = { date: String(game.date), allDay: !!game.all_day };
    const link = `/games/${r.game_id}`;
    const { data: inserted, error: insErr } = await (admin
      .from("notifications")
      .insert({
        user_id: r.user_id,
        type: "game_reminder",
        title,
        body:
          [formatNotificationWhen(whenFor), game.location ? `Where: ${game.location}` : null]
            .filter(Boolean)
            .join(" · ") || null,
        link,
      })
      .select("id") as Q<unknown>);
    if (insErr) {
      // Give the claim back so the next run tries again.
      await admin
        .from("game_reminders")
        .update({ last_sent_offset: r.last_sent_offset })
        .eq("id", r.id);
      continue;
    }
    summary.sent += 1;

    if (hasPlace(d) && wantsPush.has(r.user_id)) {
      pushes.push({
        userId: r.user_id,
        title,
        // A lock screen is read away from the app: the weekday and date, never "Today", and no
        // venue.
        body: formatDatedWhen(whenFor),
        url: link,
        // Held past the start (a minor's quiet hours), it is dropped rather than sent late.
        expiresAt: new Date(startMs).toISOString(),
        notificationId: ((inserted ?? []) as { id?: string }[])[0]?.id ?? null,
      });
    }
  }

  // Then the phones, once every in-app row is written, a few at a time. A push is best effort:
  // the notification row is the record.
  const results = await settleWithLimit(pushes, PUSH_CONCURRENCY, (p) => deliverPush(p));
  for (const res of results) {
    if (res.status === "rejected") console.warn("[reminders] push failed", res.reason);
  }
  summary.pushed = pushes.length;
  return summary;
}
