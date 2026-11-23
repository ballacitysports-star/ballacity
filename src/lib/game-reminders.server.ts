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
import { guardianLinksInForce } from "@/lib/guardian-links-in-force.server";
import { formatDatedWhen, formatNotificationWhen } from "@/lib/format";
import { gameEndsAt } from "@/lib/game-time";
import { isAllowedIn, mergeNotifPrefs, type NotifPrefs } from "@/lib/notification-prefs-core";
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
  /** `column IS NULL` (WP 5.4 / 5.6 claims). */
  is: (c: string, v: null) => Q<T>;
  neq: (c: string, v: unknown) => Q<T>;
  order: (c: string, o?: { ascending?: boolean }) => Q<T>;
  /** Rows `from` to `to` (inclusive) of the ordered result: paging past the API's row cap. */
  range: (from: number, to: number) => Q<T>;
};
export type ReminderAdmin = {
  from: (t: string) => Q<unknown> & {
    insert: (row: Record<string, unknown>) => Q<unknown>;
    update: (row: Record<string, unknown>) => Q<unknown>;
    delete: () => Q<unknown>;
  };
  /** The guardian-link rule (public.guardian_links_in_force); a client without it reads the table, as before. */
  rpc?: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
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
 * player with a guardian link in force (guardian_links, status active, the player not yet 18: see
 * guardian-links-in-force.server) the request also needs the
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
    guardianLinksInForce(admin, userIds) as unknown as Q<unknown>,
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
    const prefs = await readNotifPrefs(admin, userIds);
    return new Set(userIds.filter((u) => isAllowedIn(prefs.get(u)!, "game_reminder", "push")));
  } catch (e) {
    console.warn("[reminders] preferences unavailable; no pushes this run", e);
    return new Set();
  }
}

/**
 * Each member's notification settings (notification_preferences.prefs), merged exactly as the
 * app merges them; a member with no saved row gets the defaults. One query. Throws when the read
 * fails: no caller pushes on a guess.
 */
async function readNotifPrefs(
  admin: ReminderAdmin,
  userIds: string[],
): Promise<Map<string, NotifPrefs>> {
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
  return new Map(
    userIds.map((u) => {
      const p = stored.get(u);
      return [
        u,
        mergeNotifPrefs(p && typeof p === "object" ? (p as Record<string, unknown>) : null),
      ];
    }),
  );
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

// ---------------------------------------------------------------------------------------------------------------------
// WP 5.4: invites reach the phone. The game_invite and game_invite_accepted notifications are written by the database
// (game_invite_player, game_respond_invite), which cannot push. The sweep pushes each one of the last hour once.

/** The notification types the sweep pushes. */
export const INVITE_PUSH_TYPES = ["game_invite", "game_invite_accepted"] as const;
/** Older rows are left alone: an invite push an hour late is noise, and the in-app row is there. */
export const INVITE_PUSH_MAX_AGE_MS = 60 * 60_000;
/** Rows one read takes, oldest first; the rest wait for the next read or run (5 minutes) while still in the hour. */
export const MAX_INVITE_PUSHES_PER_RUN = 50;
/** Reads one run makes. A read whose rows were all passed over is followed by the next, so they never crowd out the rest. */
const MAX_INVITE_READS_PER_RUN = 4;
/** How far apart an acceptance's notification and its invitation's answer may be written (one transaction: the same now()). */
const ACCEPT_MATCH_MS = 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InvitePushSummary = {
  /** Rows this run took (push_sent_at set by this run). */
  taken: number;
  /** Pushes handed to deliverPush (it may still hold one for quiet hours or skip it; see the delivery log). */
  pushed: number;
  /** Taken without a push: the member switched that push off, or had already read the notification. */
  passed: number;
  /** Rows a push was wanted for but left for the next run (not taken): the run's time was up. */
  deferred: number;
};

type InviteNotice = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

/** The invitation an invite link names (`inv=<uuid>`, written by game_invite_player), or null. */
function inviteIdOf(link: string | null): string | null {
  if (!link) return null;
  try {
    const inv = new URL(link, "https://app.local").searchParams.get("inv");
    return inv && UUID_RE.test(inv) ? inv.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The game an acceptance links to (`/games/<id>`, written by game_respond_invite), or null. */
function gameIdOf(link: string | null): string | null {
  // A query or hash after the game id is ignored.
  const m = /^\/games\/([^/?#]+)(?:[?#].*)?$/.exec(link ?? "");
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
}

/**
 * The rows whose push may go, decided now from the invitations themselves (the notification row stays as it was written,
 * whatever happened since):
 * - an invite: its `inv=` names an invitation to this row's recipient that public.invite_pushes_allowed (20261129100000,
 *   service role only) still allows: pending, AND everything game_invite_player checked when it wrote the row still holds
 *   (the game open for invitations: not cancelled or hidden by its host, a moderator or its organization; the host not
 *   suspended or banned; the minor messaging rules; a guardian's game permission; the game's age range). An invitation
 *   stays 'pending' through all of those changes, so its status alone is not enough. A guardian's copy (link /parent)
 *   names none, so only the invitee is pushed;
 * - an acceptance: an invitation to this game from this host (the recipient) was accepted when the row was written;
 * - and no block, either way, between the host and the invited player.
 * Every read throws on failure, and so does a client without the check (no rpc), so the caller takes nothing and the rows
 * stay due: an invite is never pushed on a guess.
 */
async function invitePushesStillWanted(
  admin: ReminderAdmin,
  rows: InviteNotice[],
): Promise<Set<string>> {
  const pairs = new Map<string, [string, string][]>();
  const invIds = [
    ...new Set(
      rows
        .filter((n) => n.type === "game_invite")
        .map((n) => inviteIdOf(n.link))
        .filter((v): v is string => v != null),
    ),
  ];
  if (invIds.length > 0) {
    if (typeof admin.rpc !== "function") throw new Error("invitation check unavailable");
    const { data, error } = await admin.rpc("invite_pushes_allowed", { _invites: invIds });
    if (error) throw new Error(`invitation check failed: ${error.message}`);
    if (!Array.isArray(data)) throw new Error("invitation check failed: no rows");
    const byId = new Map(
      (data as { id: string; host_id: string; invitee_id: string }[]).map((i) => [
        String(i.id).toLowerCase(),
        i,
      ]),
    );
    for (const n of rows) {
      if (n.type !== "game_invite") continue;
      const i = byId.get(inviteIdOf(n.link) ?? "");
      if (i && String(i.invitee_id) === String(n.user_id)) {
        pairs.set(String(n.id), [[String(i.host_id), String(i.invitee_id)]]);
      }
    }
  }

  const acceptances = rows.filter((n) => n.type === "game_invite_accepted" && gameIdOf(n.link));
  if (acceptances.length > 0) {
    const earliest = Math.min(...acceptances.map((n) => Date.parse(n.created_at)));
    const { data, error } = await (admin
      .from("game_invites")
      .select("game_id, host_id, invitee_id, responded_at")
      .in("game_id", [...new Set(acceptances.map((n) => gameIdOf(n.link)!))])
      .eq("status", "accepted")
      .gt("responded_at", new Date(earliest - ACCEPT_MATCH_MS).toISOString()) as Q<unknown>);
    if (error) throw new Error(`invitation read failed: ${error.message}`);
    const answered = (data ?? []) as {
      game_id: string;
      host_id: string;
      invitee_id: string;
      responded_at: string;
    }[];
    for (const n of acceptances) {
      const at = Date.parse(n.created_at);
      const match = answered.filter(
        (i) =>
          String(i.game_id) === gameIdOf(n.link) &&
          String(i.host_id) === String(n.user_id) &&
          Math.abs(Date.parse(i.responded_at) - at) <= ACCEPT_MATCH_MS,
      );
      if (match.length > 0) {
        pairs.set(
          String(n.id),
          match.map((i) => [String(i.host_id), String(i.invitee_id)]),
        );
      }
    }
  }
  if (pairs.size === 0) return new Set();

  const people = [...new Set([...pairs.values()].flat(2))];
  const { data: blocks, error: bErr } = await (admin
    .from("user_blocks")
    .select("blocker_id, blocked_id")
    .in("blocker_id", people)
    .in("blocked_id", people) as Q<unknown>);
  if (bErr) throw new Error(`block read failed: ${bErr.message}`);
  const blocked = new Set(
    ((blocks ?? []) as { blocker_id: string; blocked_id: string }[]).flatMap((b) => [
      `${b.blocker_id}|${b.blocked_id}`,
      `${b.blocked_id}|${b.blocker_id}`,
    ]),
  );
  return new Set(
    [...pairs.entries()]
      .filter(([, ps]) => ps.every(([host, player]) => !blocked.has(`${host}|${player}`)))
      .map(([id]) => id),
  );
}

/**
 * The game's start from an invite link (`exp=<ms>`, written by game_invite_player): a push held past it (a minor's quiet
 * hours) is dropped rather than sent after the game began. Null when the link has none.
 */
export function inviteLinkExpiry(link: string | null): string | null {
  if (!link) return null;
  try {
    const exp = Number(new URL(link, "https://app.local").searchParams.get("exp"));
    return Number.isFinite(exp) && exp > 0 ? new Date(exp).toISOString() : null;
  } catch {
    return null;
  }
}

/**
 * Pushes the invite notifications of the last hour that no run has taken yet.
 *
 * - Settings first: one read of the members' notification settings. If it fails nothing is taken, so the rows stay due.
 * - Then the invitations behind the rows (invitePushesStillWanted): an invitation that is no longer pending, or that
 *   game_invite_player would no longer allow (game cancelled or hidden, host suspended or banned, a block either way, the
 *   minor messaging rules, a guardian's game permission, the age range), or a row no invitation stands behind, gets no
 *   push. A failed read or check takes nothing.
 * - A row is TAKEN by an update that sets push_sent_at only where it is still NULL; the rows it returns are this run's
 *   alone, so two runs at once (the scheduler retrying, two instances) split the rows and never push one twice. Rows that
 *   get no push (the member switched that category's push off: game_invite: Invitations, game_invite_accepted: Game
 *   updates; already read in the app; the invitation no longer stands) are taken together, so they are never pushed later.
 * - Rows that get a push are taken PUSH_CONCURRENCY at a time, each group just before its pushes, and the next group only
 *   once those pushes have finished. pg_net stops waiting after 5 seconds and the Worker's remaining work is then
 *   cancelled, so a row taken long before its push could be stamped and never pushed. Once the run's time is up
 *   (RUN_BUDGET_MS, shared with the other jobs by runScheduledSweeps) no more rows are read or taken: they stay due
 *   (summary.deferred) for the next run, 5 minutes later, while still in the hour. At most one group can be in flight when
 *   a run is cut off.
 * - A taken row is pushed through deliverPush, which applies a minor's quiet hours and a guardian's off switch. The push
 *   says exactly what the notification says: its title and body (the sport and time for an invite, the game's title for
 *   an acceptance; never a venue) and its link.
 * - A run reads up to MAX_INVITE_PUSHES_PER_RUN rows at a time, oldest first, and reads again (at most
 *   MAX_INVITE_READS_PER_RUN times) while a read came back full and fewer than that many pushes went out, so rows passed
 *   over never hold back the rest. The database stamps rows it did not write for an invite as it stores them
 *   (20261129100000), so a member's own rows never reach this read.
 * Pushes are best effort after the row is taken: a failed push is logged by deliverPush and not retried.
 */
export async function pushInviteNotifications(
  admin: ReminderAdmin,
  opts: { now?: number; max?: number; clock?: () => number; budgetMs?: number } = {},
): Promise<InvitePushSummary> {
  const clock = opts.clock ?? Date.now;
  const startedAt = clock();
  const overBudget = () => clock() - startedAt >= (opts.budgetMs ?? RUN_BUDGET_MS);
  const now = opts.now ?? Date.now();
  const pageSize = Math.max(1, opts.max ?? MAX_INVITE_PUSHES_PER_RUN);
  const summary: InvitePushSummary = { taken: 0, pushed: 0, passed: 0, deferred: 0 };

  /** Takes these rows; returns the ids this run took. */
  const take = async (ids: string[]): Promise<Set<string>> => {
    if (ids.length === 0) return new Set();
    const { data, error } = await (admin
      .from("notifications")
      .update({ push_sent_at: new Date(now).toISOString() })
      .in("id", ids)
      .is("push_sent_at", null)
      .select("id") as Q<unknown>);
    if (error) throw new Error(`invite notification claim failed: ${error.message}`);
    return new Set(((data ?? []) as { id: string }[]).map((r) => String(r.id)));
  };

  for (let read = 0; read < MAX_INVITE_READS_PER_RUN && summary.pushed < pageSize; read++) {
    if (overBudget()) break;
    const { data, error } = await (admin
      .from("notifications")
      .select("id, user_id, type, title, body, link, read_at, created_at")
      .in("type", INVITE_PUSH_TYPES)
      .is("push_sent_at", null)
      .gt("created_at", new Date(now - INVITE_PUSH_MAX_AGE_MS).toISOString())
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(pageSize) as Q<unknown>);
    if (error) throw new Error(`invite notification read failed: ${error.message}`);
    const due = (data ?? []) as InviteNotice[];
    if (due.length === 0) break;

    const prefs = await readNotifPrefs(admin, [...new Set(due.map((n) => String(n.user_id)))]);
    const wanted = await invitePushesStillWanted(admin, due);
    const pushFor = (n: InviteNotice) => {
      const memberPrefs = prefs.get(String(n.user_id));
      return (
        wanted.has(String(n.id)) &&
        n.read_at == null &&
        memberPrefs != null &&
        isAllowedIn(memberPrefs, n.type, "push")
      );
    };

    const quiet = await take(due.filter((n) => !pushFor(n)).map((n) => String(n.id)));
    summary.taken += quiet.size;
    summary.passed += quiet.size;

    const loud = due.filter(pushFor);
    for (let i = 0; i < loud.length; i += PUSH_CONCURRENCY) {
      if (overBudget()) {
        // Out of time: these stay untaken, so the next run pushes them.
        summary.deferred += loud.length - i;
        return summary;
      }
      const group = loud.slice(i, i + PUSH_CONCURRENCY);
      const mine = await take(group.map((n) => String(n.id)));
      const pushes: PushInput[] = group
        .filter((n) => mine.has(String(n.id)))
        .map((n) => ({
          userId: String(n.user_id),
          title: n.title,
          body: n.body,
          url: n.link,
          expiresAt: inviteLinkExpiry(n.link),
          notificationId: String(n.id),
        }));
      summary.taken += pushes.length;
      summary.pushed += pushes.length;
      const results = await Promise.allSettled(pushes.map((p) => deliverPush(p)));
      for (const res of results) {
        if (res.status === "rejected") console.warn("[invite-push] push failed", res.reason);
      }
    }
    if (due.length < pageSize) break;
  }
  return summary;
}

// ---------------------------------------------------------------------------------------------------------------------
// WP 5.6: prompt hosts to mark attendance. Nothing reminded hosts to record who showed up.

/** The notification type of the prompt (notification settings: Game reminders). */
export const ATTENDANCE_PROMPT_TYPE = "game_attendance_prompt";
/** The prompt goes out this long after the game ends. */
export const ATTENDANCE_PROMPT_DELAY_MS = 2 * 60 * 60_000;
/**
 * And not later than this after it was due: a game whose prompt time passed while the sweep was not running (or before
 * the prompt existed) gets none, instead of every past game prompting at once.
 */
export const ATTENDANCE_PROMPT_WINDOW_MS = 24 * 60 * 60_000;
/** Games one run prompts for, soonest due first. */
export const MAX_ATTENDANCE_PROMPTS_PER_RUN = 50;
/** Games looked at: started at most this long ago (covers the window plus a long game). */
const ATTENDANCE_LOOKBACK_MS = 3 * 86_400_000;
/** Rows asked for per read. The API may return fewer (its row cap); reads continue until one returns none. */
const READ_PAGE = 1000;
/** Reads of unprompted games one run makes (READ_PAGE each); past this the oldest are looked at first. */
const MAX_GAME_PAGES = 10;
/** Reads of one batch's roster; a roster still unread after this many is not decided on (no prompt this run). */
const MAX_ROSTER_PAGES = 20;

/**
 * Every row of a read, page by page (`range`), so the API's row cap never cuts it short silently. `query` must order the
 * rows by a unique key. Stops when a page comes back empty (`complete`), or after `maxPages` pages with the rows read so
 * far (`complete: false`).
 */
async function readAllPages<T>(
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  maxPages: number,
  what: string,
): Promise<{ rows: T[]; complete: boolean }> {
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await query(rows.length, rows.length + READ_PAGE - 1);
    if (error) throw new Error(`${what} read failed: ${error.message}`);
    const got = (data ?? []) as T[];
    if (got.length === 0) return { rows, complete: true };
    rows.push(...got);
  }
  return { rows, complete: false };
}

/** Where the prompt opens: the Attendance block on the game page's roster (src/routes/games.$gameId.index.tsx). */
export function attendancePromptLink(gameId: string): string {
  return `/games/${gameId}?tab=overview#attendance`;
}

/** The prompt's words, in-app and on the lock screen alike: the game's title, never a player's name. */
export function attendancePromptText(gameTitle: string): { title: string; body: string } {
  return {
    title: `Who showed up at ${gameTitle}?`,
    body: "Mark who showed up. It builds your host reliability score.",
  };
}

export type AttendanceGame = {
  id: string;
  host_id: string;
  title: string;
  date: string;
  duration: string | null;
  ends_at: string | null;
  status: string | null;
  cancelled_at: string | null;
};

export type AttendancePromptSummary = {
  /** Prompts sent (in-app notice written; attendance_prompted_at set). */
  prompted: number;
  /** Pushes handed to deliverPush. */
  pushed: number;
  /** Games in the prompt window left for the next run (past the run's budget or cap), checked or not. */
  deferred: number;
};

/**
 * Sends each host whose game ended 2 hours ago one prompt to mark attendance, in the app and as a push.
 *
 * A game gets one when ALL hold: it is not cancelled (status or cancelled_at); 2 hours have passed since its end
 * (gameEndsAt, the app's rule: ends_at, or the start plus its duration) but not 26; it has at least one participant
 * other than the host; nobody's attendance is marked (no roster row with attended or attendance_marked_at); and no
 * prompt was sent (attendance_prompted_at is NULL). Each game of a series is its own row and is prompted once.
 *
 * The prompt goes to the game's host (hosted_games.host_id), the one person host_mark_attendance lets mark it besides
 * moderators. public.send_attendance_prompt (20261129110000, service role only) stamps attendance_prompted_at where it is
 * still NULL (so two runs never both prompt), checks the game is still due (not cancelled, a non-host participant, nothing
 * marked), and writes the notice, in one transaction: a run cut off part way (pg_net stops waiting after 5 seconds) never
 * leaves a game stamped without its notice, and a notice that cannot be written leaves nothing stamped, so the next run
 * tries again. A run whose time is already up (runScheduledSweeps shares RUN_BUDGET_MS) reads nothing. The push follows the
 * host's Game reminders push setting and goes through deliverPush (a minor's quiet hours, a guardian's off switch).
 */
export async function promptHostsForAttendance(
  admin: ReminderAdmin,
  opts: { now?: number; clock?: () => number; budgetMs?: number; max?: number } = {},
): Promise<AttendancePromptSummary> {
  const clock = opts.clock ?? Date.now;
  const startedAt = clock();
  const overBudget = () => clock() - startedAt >= (opts.budgetMs ?? RUN_BUDGET_MS);
  const now = opts.now ?? Date.now();
  const max = Math.max(1, opts.max ?? MAX_ATTENDANCE_PROMPTS_PER_RUN);
  const summary: AttendancePromptSummary = { prompted: 0, pushed: 0, deferred: 0 };
  if (overBudget()) return summary;
  if (typeof admin.rpc !== "function") throw new Error("attendance prompt unavailable");
  const rpc = admin.rpc.bind(admin);

  // The database drops cancelled games; every unprompted game left in the lookback is read, page by page, oldest first.
  const games = await readAllPages<AttendanceGame>(
    (from, to) =>
      admin
        .from("hosted_games")
        .select("id, host_id, title, date, duration, ends_at, status, cancelled_at")
        .is("attendance_prompted_at", null)
        .is("cancelled_at", null)
        .or("status.is.null,status.neq.cancelled")
        .gt("date", new Date(now - ATTENDANCE_LOOKBACK_MS).toISOString())
        .lte("date", new Date(now - ATTENDANCE_PROMPT_DELAY_MS).toISOString())
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to) as Q<unknown>,
    MAX_GAME_PAGES,
    "game",
  );
  if (!games.complete) {
    console.warn(
      "[attendance-prompt] more unprompted games than one run reads; the oldest go first",
    );
  }
  const dueAt = (g: AttendanceGame) =>
    gameEndsAt({ date: g.date, duration: g.duration ?? "", endsAt: g.ends_at }) +
    ATTENDANCE_PROMPT_DELAY_MS;
  const candidates = games.rows
    .filter((g) => {
      if (g.status === "cancelled" || g.cancelled_at != null || !g.host_id) return false;
      const due = dueAt(g);
      return due <= now && now - due < ATTENDANCE_PROMPT_WINDOW_MS;
    })
    .sort((a, b) => dueAt(a) - dueAt(b));

  // Soonest due first, a batch at a time: a game that is marked or has only its host never holds back the ones after it.
  const pushes: PushInput[] = [];
  let next = 0;
  while (next < candidates.length && summary.prompted < max && !overBudget()) {
    const chunk = candidates.slice(next, next + max);
    next += chunk.length;
    const ids = chunk.map((g) => g.id);
    const roster = await readAllPages<{
      game_id: string;
      user_id: string;
      attended: boolean | null;
      attendance_marked_at: string | null;
    }>(
      (from, to) =>
        admin
          .from("game_participants")
          .select("game_id, user_id, attended, attendance_marked_at")
          .in("game_id", ids)
          .order("game_id", { ascending: true })
          .order("user_id", { ascending: true })
          .range(from, to) as Q<unknown>,
      MAX_ROSTER_PAGES,
      "roster",
    );
    if (!roster.complete) {
      console.warn(
        "[attendance-prompt] a roster batch was too large to read; no prompts for it this run",
      );
      summary.deferred += chunk.length;
      continue;
    }
    const byId = new Map(chunk.map((g) => [g.id, g]));
    const others = new Set<string>();
    const marked = new Set<string>();
    for (const p of roster.rows) {
      const g = byId.get(p.game_id);
      if (!g) continue;
      if (p.attended != null || p.attendance_marked_at != null) marked.add(g.id);
      if (String(p.user_id) !== String(g.host_id)) others.add(g.id);
    }
    const due = chunk.filter((g) => others.has(g.id) && !marked.has(g.id));
    if (due.length === 0) continue;

    // A failed settings read sends no push (the in-app notice still goes), as for reminders.
    let prefs = new Map<string, NotifPrefs>();
    try {
      prefs = await readNotifPrefs(admin, [...new Set(due.map((g) => String(g.host_id)))]);
    } catch (e) {
      console.warn("[attendance-prompt] preferences unavailable; no pushes this run", e);
    }

    for (let i = 0; i < due.length; i++) {
      if (summary.prompted >= max || overBudget()) {
        summary.deferred += due.length - i;
        break;
      }
      const g = due[i]!;
      const text = attendancePromptText(g.title);
      const link = attendancePromptLink(g.id);
      // The stamp and the notice in one call: both or neither. NULL: another run sent it, or the game is no longer due.
      const { data: noticeId, error: pErr } = await rpc("send_attendance_prompt", {
        _game: g.id,
        _title: text.title,
        _body: text.body,
        _link: link,
      });
      if (pErr) {
        console.warn("[attendance-prompt] prompt not sent; the next run tries again", pErr.message);
        continue;
      }
      if (noticeId == null) continue;
      summary.prompted += 1;

      const hostPrefs = prefs.get(String(g.host_id));
      if (hostPrefs && isAllowedIn(hostPrefs, ATTENDANCE_PROMPT_TYPE, "push")) {
        pushes.push({
          userId: String(g.host_id),
          ...text,
          url: link,
          notificationId: String(noticeId),
        });
      }
    }
  }
  summary.deferred += candidates.length - next;

  const results = await settleWithLimit(pushes, PUSH_CONCURRENCY, (p) => deliverPush(p));
  for (const res of results) {
    if (res.status === "rejected") console.warn("[attendance-prompt] push failed", res.reason);
  }
  summary.pushed = pushes.length;
  return summary;
}

// ---------------------------------------------------------------------------------------------------------------------
// The scheduled run (/api/public/reminders/run): the three jobs, one after another, on one clock.

export type ScheduledSweepResult = {
  reminders: ReminderRunSummary | null;
  invitePushes: InvitePushSummary | null;
  attendancePrompts: AttendancePromptSummary | null;
  /** One message per job that failed; the others still ran. */
  errors: string[];
};

/**
 * Runs the game reminders, then the invite pushes (WP 5.4), then the attendance prompts (WP 5.6), one after another under
 * ONE budget (RUN_BUDGET_MS from the start of the run): pg_net stops waiting for the call after 5 seconds and the Worker's
 * remaining work is then cancelled, so each job gets only the time the jobs before it left, and a job whose time is up
 * takes nothing (its rows stay due for the next run, 5 minutes later). One after another, the pushes in flight never
 * exceed PUSH_CONCURRENCY, so the reminders' pushes are not slowed by the other jobs. One job failing does not stop the
 * others. Reminders go first, as before; invite pushes next (they have an hour, twelve runs); attendance prompts last
 * (they have a day).
 */
export async function runScheduledSweeps(
  admin: ReminderAdmin,
  opts: { clock?: () => number; budgetMs?: number } = {},
): Promise<ScheduledSweepResult> {
  const clock = opts.clock ?? Date.now;
  const startedAt = clock();
  const budget = opts.budgetMs ?? RUN_BUDGET_MS;
  const left = () => Math.max(0, budget - (clock() - startedAt));
  const errors: string[] = [];
  const attempt = async <T>(job: () => Promise<T>): Promise<T | null> => {
    try {
      return await job();
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      return null;
    }
  };
  const reminders = await attempt(() => sendDueGameReminders(admin, { clock, budgetMs: left() }));
  const invitePushes = await attempt(() =>
    pushInviteNotifications(admin, { clock, budgetMs: left() }),
  );
  const attendancePrompts = await attempt(() =>
    promptHostsForAttendance(admin, { clock, budgetMs: left() }),
  );
  return { reminders, invitePushes, attendancePrompts, errors };
}
