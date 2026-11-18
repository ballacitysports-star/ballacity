/**
 * Works out the notifications a signed-in member's app may ask for (createNotificationForUser), and every word of them.
 *
 * The app names a type and the row it is about (notification-requests.ts). Here, with the service role, we read that
 * row, check the caller's role on it (the game's host, the player who asked, the message's sender, the post's author),
 * choose the recipients the row allows, and write the title, body and link from the stored rows. Nothing the caller
 * sends ends up in a notification except a host's roster note (game_broadcast), which the request schema keeps short
 * and link-free.
 *
 * This replaces the old rule, "any title, body and link to anyone can_notify says you know", under which one
 * availability contact request let the sender's app put any text and any link on the other person's screen.
 */
import type { NotifyRequest } from "@/lib/notification-requests";
import { isLateCancel } from "@/lib/cancel-window";
import { toAppPath } from "@/lib/deep-links";
import { isAllowedIn, mergeNotifPrefs } from "@/lib/notification-prefs-core";

/* eslint-disable @typescript-eslint/no-explicit-any -- the service-role client is untyped here, as in guardian-push.server */
export type Admin = { from: (table: string) => any };

export type PlannedNotification = {
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string;
};

/** One neutral refusal: the reason would tell a caller things about other people (who is on a roster, who asked). */
export type NotifyPlan = { ok: true; rows: PlannedNotification[] } | { ok: false };

const REFUSE: NotifyPlan = { ok: false };
const none = (): NotifyPlan => ({ ok: true, rows: [] });
const some = (...rows: PlannedNotification[]): NotifyPlan => ({ ok: true, rows });

/** A message notifies only while it is new; an old message cannot be used to ping its thread again. */
export const MESSAGE_MAX_AGE_MS = 10 * 60_000;
/** The most recipients one request can reach (a roster, a thread, the people who asked about a post). */
export const MAX_RECIPIENTS = 200;

type Game = {
  id: string;
  host_id: string;
  title: string | null;
  price: number | null;
  date: string | null;
  cancel_cutoff_min: number | null;
  max_players: number | null;
  sport: string | null;
  location: string | null;
  cancelled_at: string | null;
  completed_at: string | null;
  positions_needed: unknown;
};

const GAME_COLUMNS =
  "id, host_id, title, price, date, cancel_cutoff_min, max_players, sport, location, cancelled_at, completed_at, positions_needed";

/**
 * A waitlist row's position is whatever the joining player wrote (the table does not check it), so it is named only
 * when it is one of the positions the host listed for the game.
 */
function hostListedPosition(game: Game, raw: string | null | undefined): string | null {
  const p = raw?.trim();
  const listed = game.positions_needed;
  if (!p || !listed || typeof listed !== "object" || Array.isArray(listed)) return null;
  return Object.prototype.hasOwnProperty.call(listed, p) ? clip(p, 40) : null;
}

async function maybeOne<T>(q: any): Promise<T | null> {
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  return (data as T | null) ?? null;
}

async function rows<T>(q: any): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as T[] | null) ?? [];
}

async function exists(q: any): Promise<boolean> {
  const { data, error } = await q.limit(1);
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length > 0;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const gameName = (g: Game) => clip(g.title?.trim() || "your game", 120);

function money(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "0";
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/** Every link is an app path built here from a checked id; this refuses anything toAppPath would not keep as-is. */
export function appLink(path: string): string {
  if (toAppPath(path) !== path)
    throw new Error(`Refusing a notification link that is not an app path: ${path}`);
  return path;
}
const gameLink = (id: string, rest = "") => appLink(`/games/${encodeURIComponent(id)}${rest}`);

const PAYMENT_TYPE_NAMES: Record<string, string> = {
  venmo: "Venmo",
  cashapp: "Cash App",
  zelle: "Zelle",
  paypal: "PayPal",
  applecash: "Apple Cash",
  googlepay: "Google Pay",
  cash: "cash",
};

async function loadGame(admin: Admin, id: string): Promise<Game | null> {
  return maybeOne<Game>(admin.from("hosted_games").select(GAME_COLUMNS).eq("id", id));
}

async function displayName(admin: Admin, userId: string, fallback: string): Promise<string> {
  const p = await maybeOne<{ display_name: string | null }>(
    admin.from("profiles").select("display_name").eq("id", userId),
  );
  return clip(p?.display_name?.trim() || fallback, 60);
}

async function isParticipant(admin: Admin, gameId: string, userId: string): Promise<boolean> {
  return exists(
    admin.from("game_participants").select("id").eq("game_id", gameId).eq("user_id", userId),
  );
}

async function latestJoinRequest(admin: Admin, gameId: string, playerId: string) {
  return maybeOne<{
    status: string;
    host_id: string;
    attempt_count: number | null;
    last_rejected_at: string | null;
    reviewer_notes: string | null;
  }>(
    admin
      .from("join_requests")
      .select("status, host_id, attempt_count, last_rejected_at, reviewer_notes")
      .eq("game_id", gameId)
      .eq("player_id", playerId)
      .order("created_at", { ascending: false })
      .limit(1),
  );
}

async function latestSubmission(admin: Admin, gameId: string, playerId: string) {
  return maybeOne<{
    status: string;
    host_id: string;
    paid_amount: number | null;
    payment_type: string | null;
  }>(
    admin
      .from("payment_submissions")
      .select("status, host_id, paid_amount, payment_type")
      .eq("game_id", gameId)
      .eq("player_id", playerId)
      .order("submitted_at", { ascending: false })
      .limit(1),
  );
}

async function latestWaitlistEntry(admin: Admin, gameId: string, userId: string) {
  return maybeOne<{ status: string; position: string | null }>(
    admin
      .from("game_position_waitlist")
      .select("status, position")
      .eq("game_id", gameId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1),
  );
}

async function rosterIds(admin: Admin, game: Game): Promise<string[]> {
  const list = await rows<{ user_id: string }>(
    admin.from("game_participants").select("user_id").eq("game_id", game.id),
  );
  return [...new Set(list.map((r) => String(r.user_id)))]
    .filter((id) => id && id !== game.host_id)
    .slice(0, MAX_RECIPIENTS);
}

const started = (g: Game, now: number) => !!g.date && Date.parse(g.date) <= now;
const closed = (g: Game) => !!g.cancelled_at || !!g.completed_at;

/**
 * The notifications this request may produce. `ok: false` when the caller has no standing to send it; `ok: true` with
 * no rows when there is legitimately nothing to say (a late leave, which the database reports itself).
 */
export async function planNotification(
  admin: Admin,
  callerId: string,
  req: NotifyRequest,
  now: number = Date.now(),
): Promise<NotifyPlan> {
  switch (req.type) {
    case "message":
      return planMessage(admin, callerId, req.message_id, now);
    case "availability_updated":
      return planAvailabilityUpdated(admin, callerId, req.availability_id);
    default:
      break;
  }

  const game = await loadGame(admin, req.game_id);
  if (!game) return REFUSE;
  const T = gameName(game);
  const link = gameLink(game.id);
  const isHost = game.host_id === callerId;

  // ---- A player tells the host. The recipient is the host the game names, never one the app picks.
  if (
    req.type === "join_request" ||
    req.type === "participant_joined" ||
    req.type === "participant_left" ||
    req.type === "waitlist_join" ||
    req.type === "payment_submitted"
  ) {
    if (isHost) return REFUSE;
    const toHost = (type: string, title: string, body: string | null, l = link) =>
      some({ user_id: game.host_id, type, title: clip(title, 200), body, link: l });

    switch (req.type) {
      case "join_request": {
        const jr = await latestJoinRequest(admin, game.id, callerId);
        if (!jr || jr.status !== "pending" || jr.host_id !== game.host_id) return REFUSE;
        const again = (jr.attempt_count ?? 1) > 1 || !!jr.last_rejected_at;
        return again
          ? toHost(
              "join_resubmitted",
              `Resubmitted request: ${T}`,
              "A player resubmitted their request — pending your review.",
            )
          : toHost("join_request", `New request to join ${T}`, "Tap to review.");
      }
      case "participant_joined": {
        if (!(await isParticipant(admin, game.id, callerId))) return REFUSE;
        const who = await displayName(admin, callerId, "A player");
        const { count } = await admin
          .from("game_participants")
          .select("id", { count: "exact", head: true })
          .eq("game_id", game.id);
        const body =
          typeof count === "number" && game.max_players
            ? `${count}/${game.max_players} players confirmed.`
            : null;
        return toHost("participant_joined", `${who} joined ${T}`, body);
      }
      case "participant_left": {
        // Leaving removes the player's rows, so there is nothing left to show they were on it; what limits this one
        // is that it only ever reaches this game's host, in the caller's own name, about the host's own game.
        if (closed(game) || started(game, now)) return REFUSE;
        if (await isParticipant(admin, game.id, callerId)) return REFUSE;
        // Inside the cutoff the database sends its own "cancelled late" notice.
        if (isLateCancel(game.date, game.cancel_cutoff_min, now)) return none();
        const who = await displayName(admin, callerId, "A player");
        return toHost("participant_left", `${who} left ${T}`, "Their spot is open again.");
      }
      case "waitlist_join": {
        const w = await latestWaitlistEntry(admin, game.id, callerId);
        if (!w || w.status !== "waiting") return REFUSE;
        const who = await displayName(admin, callerId, "A player");
        const pos = hostListedPosition(game, w.position);
        return toHost("waitlist_join", `${who} joined the ${pos ? `${pos} ` : ""}waitlist`, T);
      }
      case "payment_submitted": {
        const s = await latestSubmission(admin, game.id, callerId);
        if (!s || s.status !== "pending" || s.host_id !== game.host_id) return REFUSE;
        const via = PAYMENT_TYPE_NAMES[String(s.payment_type)] ?? "another method";
        return toHost(
          "payment_submitted",
          "Payment proof to review",
          `$${money(s.paid_amount)} via ${via} for ${T}`,
        );
      }
    }
  }

  // ---- The host tells their players. Everything below needs the caller to host this game.
  if (!isHost) return REFUSE;

  if (req.type === "game_time_changed" || req.type === "game_broadcast") {
    const ids = await rosterIds(admin, game);
    const [type, title, body] =
      req.type === "game_time_changed"
        ? [
            "game_time_changed",
            `Schedule updated: ${T}`,
            "The host changed the time. Tap to see the new schedule.",
          ]
        : ["game_broadcast", `Host update · ${T}`, req.text.trim()];
    return {
      ok: true,
      rows: ids.map((user_id) => ({ user_id, type, title: clip(title, 200), body, link })),
    };
  }

  const target = req.user_id;
  if (target === callerId) return REFUSE;
  const toPlayer = (type: string, title: string, body: string | null, l = link) =>
    some({ user_id: target, type, title: clip(title, 200), body, link: l });

  switch (req.type) {
    case "join_approved": {
      const jr = await latestJoinRequest(admin, game.id, target);
      if (!jr || jr.status !== "approved") return REFUSE;
      const fee = Number(game.price ?? 0);
      return fee > 0
        ? toPlayer(
            "join_approved",
            `Request approved — payment due for ${T}`,
            `Pay $${money(fee)} to the host to secure your spot. You'll be added to the roster once payment is confirmed.`,
            gameLink(game.id, "/pay"),
          )
        : toPlayer("join_approved", `You're in: ${T}`, "The host approved your request.");
    }
    case "join_declined": {
      const jr = await latestJoinRequest(admin, game.id, target);
      if (!jr || jr.status !== "rejected") return REFUSE;
      // The host's reason is shown on the game page (GameApprovalBanner), not copied into the alert.
      return toPlayer(
        "join_declined",
        `Request declined: ${T}`,
        jr.reviewer_notes?.trim()
          ? "The host declined your request. Open the game to see why."
          : "The host declined your request.",
      );
    }
    case "participant_removed": {
      const linked =
        (await isParticipant(admin, game.id, target)) ||
        (await exists(
          admin.from("join_requests").select("id").eq("game_id", game.id).eq("player_id", target),
        ));
      if (!linked) return REFUSE;
      return toPlayer(
        "participant_removed",
        `Removed from ${T}`,
        "The host removed you from this game.",
      );
    }
    case "payment_verified":
    case "payment_rejected": {
      const s = await latestSubmission(admin, game.id, target);
      const want = req.type === "payment_verified" ? "verified" : "rejected";
      if (!s || s.status !== want || s.host_id !== callerId) return REFUSE;
      return want === "verified"
        ? toPlayer(
            "payment_verified",
            `Payment verified for ${T}`,
            "The host confirmed your payment. You're all set.",
          )
        : toPlayer(
            "payment_rejected",
            `Payment declined for ${T}`,
            "The host couldn't verify your payment. Tap to see why and try again.",
            gameLink(game.id, "/pay"),
          );
    }
    case "payment_reminder": {
      const fee = Number(game.price ?? 0);
      if (!(fee > 0) || closed(game)) return REFUSE;
      const jr = await latestJoinRequest(admin, game.id, target);
      const onIt = (await isParticipant(admin, game.id, target)) || jr?.status === "approved";
      if (!onIt) return REFUSE;
      const s = await latestSubmission(admin, game.id, target);
      if (s && (s.status === "verified" || s.status === "pending")) return REFUSE;
      return toPlayer(
        "payment_reminder",
        `Payment reminder · ${T}`,
        `Your $${money(fee)} spot for ${T} is still unpaid. Tap to pay the host.`,
        gameLink(game.id, "/pay"),
      );
    }
    case "waitlist_approved":
    case "waitlist_declined": {
      const w = await latestWaitlistEntry(admin, game.id, target);
      const want = req.type === "waitlist_approved" ? "approved" : "declined";
      if (!w || w.status !== want) return REFUSE;
      const pos = hostListedPosition(game, w.position);
      return want === "approved"
        ? toPlayer(
            "waitlist_approved",
            pos ? `You're approved for ${pos}` : `You're approved from the waitlist`,
            T,
          )
        : toPlayer(
            "waitlist_declined",
            `Your ${pos ? `${pos} ` : ""}waitlist request was declined`,
            T,
          );
    }
    case "game_invite": {
      if (closed(game) || started(game, now)) return REFUSE;
      const invited = await exists(
        admin
          .from("availability_contact_requests")
          .select("id")
          .eq("from_user_id", callerId)
          .eq("to_user_id", target)
          .eq("kind", "invite")
          .eq("game_id", game.id)
          .eq("status", "pending"),
      );
      if (!invited) return REFUSE;
      const what = [game.sport, game.location]
        .map((s) => (s ?? "").trim())
        .filter(Boolean)
        .join(" · ");
      return toPlayer(
        "game_invite",
        `You're invited to ${T}`,
        what ? clip(what, 300) : null,
        gameLink(game.id, `?invite=1&from=${encodeURIComponent(callerId)}`),
      );
    }
  }
  return REFUSE;
}

async function planMessage(
  admin: Admin,
  callerId: string,
  messageId: string,
  now: number,
): Promise<NotifyPlan> {
  const msg = await maybeOne<{
    id: string;
    conversation_id: string;
    sender_id: string;
    body: string | null;
    attachment_name: string | null;
    deleted_at: string | null;
    created_at: string;
  }>(
    admin
      .from("messages")
      .select("id, conversation_id, sender_id, body, attachment_name, deleted_at, created_at")
      .eq("id", messageId),
  );
  if (!msg || msg.sender_id !== callerId || msg.deleted_at) return REFUSE;
  if (now - Date.parse(msg.created_at) > MESSAGE_MAX_AGE_MS) return REFUSE;

  const [conv, parts] = await Promise.all([
    maybeOne<{ accepted_by: string[] | null }>(
      admin.from("conversations").select("accepted_by").eq("id", msg.conversation_id),
    ),
    rows<{ user_id: string }>(
      admin
        .from("conversation_participants")
        .select("user_id")
        .eq("conversation_id", msg.conversation_id),
    ),
  ]);
  if (!conv) return REFUSE;
  const others = [...new Set(parts.map((p) => String(p.user_id)))]
    .filter((id) => id !== callerId)
    .slice(0, MAX_RECIPIENTS);
  if (others.length === 0) return none();

  const accepted = new Set(conv.accepted_by ?? []);
  const known = others.filter((id) => accepted.has(id));
  const strangers = others.filter((id) => !accepted.has(id));

  // Someone who has not accepted the thread hears only about its opening message, so a sender they never answered
  // cannot keep alerting them. "Opening" is the sender's earliest message, which a quick second message cannot change.
  let opening = false;
  if (strangers.length > 0) {
    const first = await maybeOne<{ id: string }>(
      admin
        .from("messages")
        .select("id")
        .eq("conversation_id", msg.conversation_id)
        .eq("sender_id", callerId)
        .order("created_at", { ascending: true })
        .limit(1),
    );
    opening = first?.id === msg.id;
  }
  if (known.length === 0 && !opening) return none();

  const name = await displayName(admin, callerId, "Someone");
  const link = appLink(`/messages/${encodeURIComponent(msg.conversation_id)}`);
  const text = msg.body?.trim();
  const preview = text
    ? clip(text, 140)
    : `📎 ${clip(msg.attachment_name?.trim() || "Attachment", 80)}`;
  return {
    ok: true,
    rows: [
      ...known.map((user_id) => ({
        user_id,
        type: "message",
        title: `New message from ${name}`,
        body: preview,
        link,
      })),
      // The body never quotes a request: an unaccepted sender does not get to put their words on a lock screen.
      ...(opening
        ? strangers.map((user_id) => ({
            user_id,
            type: "message",
            title: `Message request from ${name}`,
            body: "They'd like to start a conversation.",
            link,
          }))
        : []),
    ],
  };
}

async function planAvailabilityUpdated(
  admin: Admin,
  callerId: string,
  availabilityId: string,
): Promise<NotifyPlan> {
  const post = await maybeOne<{ id: string; user_id: string }>(
    admin.from("player_availabilities").select("id, user_id").eq("id", availabilityId),
  );
  if (!post || post.user_id !== callerId) return REFUSE;
  const asked = await rows<{ from_user_id: string }>(
    admin
      .from("availability_contact_requests")
      .select("from_user_id")
      .eq("availability_id", post.id)
      .eq("to_user_id", callerId),
  );
  const ids = [...new Set(asked.map((r) => String(r.from_user_id)))]
    .filter((id) => id && id !== callerId)
    .slice(0, MAX_RECIPIENTS);
  if (ids.length === 0) return none();
  const name = await displayName(admin, callerId, "A player");
  const link = appLink(`/players?post=${encodeURIComponent(post.id)}`);
  return {
    ok: true,
    rows: ids.map((user_id) => ({
      user_id,
      type: "availability_updated",
      title: `${name} updated their availability`,
      body: "Tap to see the new details.",
      link,
    })),
  };
}

// ---- Repeats -----------------------------------------------------------------------------------------------------

/** How long an identical notification (same person, type, link, title and body) is not sent again. */
export const REPEAT_WINDOW_MS: Record<string, number> = {
  message: 2 * 60_000,
  payment_reminder: 60 * 60_000,
  game_broadcast: 60 * 60_000,
};
const DEFAULT_REPEAT_WINDOW_MS = 10 * 60_000;
/** A host's roster updates: at most this many per player per game in an hour. */
export const BROADCAST_HOURLY_CAP = 10;

/**
 * Drops what the recipient was told moments ago: a double tap, a retried request or a script repeating one call. A
 * failed read drops nothing (the rows were already checked; this only trims repeats).
 */
export async function dropRecentRepeats(
  admin: Admin,
  planned: PlannedNotification[],
  now: number = Date.now(),
): Promise<PlannedNotification[]> {
  if (planned.length === 0) return planned;
  const groups = new Map<string, PlannedNotification[]>();
  for (const r of planned) {
    const k = `${r.type}\u0000${r.link}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const keep: PlannedNotification[] = [];
  for (const group of groups.values()) {
    const { type, link } = group[0];
    // A roster update looks back an hour: that window both caps how many go out and drops an identical one.
    const window = REPEAT_WINDOW_MS[type] ?? DEFAULT_REPEAT_WINDOW_MS;
    let recent: { user_id: string; title: string; body: string | null }[] = [];
    try {
      recent = await rows(
        admin
          .from("notifications")
          .select("user_id, title, body")
          .in(
            "user_id",
            group.map((r) => r.user_id),
          )
          .eq("type", type)
          .eq("link", link)
          .gte("created_at", new Date(now - window).toISOString()),
      );
    } catch (e) {
      console.warn("[notify] repeat check unavailable", e);
    }
    for (const r of group) {
      const mine = recent.filter((n) => n.user_id === r.user_id);
      if (type === "game_broadcast" && mine.length >= BROADCAST_HOURLY_CAP) continue;
      if (mine.some((n) => n.title === r.title && (n.body ?? null) === (r.body ?? null))) continue;
      keep.push(r);
    }
  }
  return keep;
}

// ---- Push ----------------------------------------------------------------------------------------------------------

/**
 * Which recipients want this type pushed to their phone, by their saved preferences merged exactly as the app merges
 * them. A failed read pushes to nobody: the in-app rows are written either way.
 */
export async function pushAllowed(
  admin: Admin,
  planned: PlannedNotification[],
): Promise<Set<PlannedNotification>> {
  const ids = [...new Set(planned.map((r) => r.user_id))];
  if (ids.length === 0) return new Set();
  try {
    const stored = await rows<{ user_id: string; prefs: unknown }>(
      admin.from("notification_preferences").select("user_id, prefs").in("user_id", ids),
    );
    const byUser = new Map(stored.map((s) => [String(s.user_id), s.prefs]));
    return new Set(
      planned.filter((r) => {
        const p = byUser.get(r.user_id);
        const prefs = mergeNotifPrefs(
          p && typeof p === "object" ? (p as Record<string, unknown>) : null,
        );
        return isAllowedIn(prefs, r.type, "push");
      }),
    );
  } catch (e) {
    console.warn("[notify] preferences unavailable; no pushes for this request", e);
    return new Set();
  }
}
