/**
 * WP 2.1: the host's side of game invitations. Which players to offer (available near the game, at its time, for its sport)
 * and how to word the outcome. Pure: the database still decides who may be invited (game_invite_player, migration
 * 20261119100000) and who the host may see at all (players_available_near runs under the read policy).
 */
import type { NearbyAvailabilityQuery } from "./availability";
import type { GameInvite, BulkInviteResult } from "./game-invites";
import { gameEndsAt, isGameFinished, type GameTiming } from "./game-time";
import { SPORTS, type Game } from "./sample-data";

/** How far from the game to look, in miles. Posts must also be within the poster's own travel radius. */
export const INVITE_SEARCH_RADIUS_MI = 25;
/** The bulk invitation takes at most this many players at once. */
export const INVITE_BATCH_MAX = 30;
const DECLINE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** The availability posts' name for a game's sport ("basketball" → "Basketball"), or null when posts never use it. */
export function inviteSportFor(sport: string | null | undefined): string | null {
  const s = (sport ?? "").trim().toLowerCase();
  if (!s) return null;
  return SPORTS.find((x) => x.name.toLowerCase() === s)?.name ?? null;
}

type InviteGame = GameTiming & Pick<Game, "sport" | "lat" | "lng">;

export type InviteSearch =
  { ok: true; query: NearbyAvailabilityQuery } | { ok: false; reason: "finished" | "no_location" };

/**
 * The search for players to invite: posts near the game's place whose times overlap the game, for its sport, nearest first.
 * A game that has started (or is over, or cancelled) takes no invitations, as on the server; one without a mapped place
 * cannot be searched by distance.
 */
export function inviteSearchFor(game: InviteGame, now: Date = new Date()): InviteSearch {
  const start = new Date(game.date);
  if (isGameFinished(game, now.getTime()) || !(start.getTime() > now.getTime())) {
    return { ok: false, reason: "finished" };
  }
  if (typeof game.lat !== "number" || typeof game.lng !== "number") {
    return { ok: false, reason: "no_location" };
  }
  const end = new Date(gameEndsAt(game));
  return {
    ok: true,
    query: {
      lat: game.lat,
      lng: game.lng,
      radiusMi: INVITE_SEARCH_RADIUS_MI,
      sport: inviteSportFor(game.sport),
      from: start.toISOString(),
      to: (end > start ? end : new Date(start.getTime() + 2 * 60 * 60 * 1000)).toISOString(),
      includeUnlocated: false,
      order: "nearest",
      limit: INVITE_BATCH_MAX,
    },
  };
}

/** What stands in the way of inviting one player, or null when they can be offered. */
export type CandidateState = null | "on_roster" | "invited" | "joined" | "declined_recently";

export function candidateState(
  userId: string,
  ctx: { hostId: string | null; rosterIds: readonly string[]; invites: readonly GameInvite[] },
  now: Date = new Date(),
): CandidateState | "host" {
  if (ctx.hostId && userId === ctx.hostId) return "host";
  if (ctx.rosterIds.includes(userId)) return "on_roster";
  const mine = ctx.invites.filter((i) => i.invitee_id === userId);
  if (mine.some((i) => i.status === "pending")) return "invited";
  if (mine.some((i) => i.status === "accepted")) return "joined";
  if (
    mine.some(
      (i) =>
        i.status === "declined" &&
        i.responded_at !== null &&
        now.getTime() - new Date(i.responded_at).getTime() < DECLINE_COOLDOWN_MS,
    )
  ) {
    return "declined_recently";
  }
  return null;
}

/** The server's answer for a regular, in the same terms as candidateState (null: can be invited). */
export function regularState(
  status: "in_game" | "accepted" | "invited" | "declined_recently" | "available",
): CandidateState {
  switch (status) {
    case "in_game":
      return "on_roster";
    case "accepted":
      return "joined";
    case "invited":
      return "invited";
    case "declined_recently":
      return "declined_recently";
    default:
      return null;
  }
}

/** "3 games with you · last Nov 12" for a regular. */
export function regularDetail(games: number, lastPlayed: string): string {
  const d = new Date(lastPlayed);
  const when = Number.isNaN(+d)
    ? ""
    : ` · last ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  return `${games} ${games === 1 ? "game" : "games"} with you${when}`;
}

export const CANDIDATE_LABEL: Record<Exclude<CandidateState, null>, string> = {
  on_roster: "On the roster",
  invited: "Invited",
  joined: "Accepted",
  declined_recently: "Declined this week",
};

export type InviteCounts = { pending: number; accepted: number; declined: number; ended: number };

/** The host's invited list in one line: how many are waiting, accepted, declined. */
export function inviteCounts(invites: readonly GameInvite[]): InviteCounts {
  const c: InviteCounts = { pending: 0, accepted: 0, declined: 0, ended: 0 };
  for (const i of invites) {
    if (i.status === "pending") c.pending++;
    else if (i.status === "accepted") c.accepted++;
    else if (i.status === "declined") c.declined++;
    else c.ended++;
  }
  return c;
}

const SKIP_PHRASE: Record<string, (n: number) => string> = {
  INVITE_NOT_AVAILABLE: (n) => `${n} can't be invited`,
  MINOR_MESSAGING_BLOCKED: (n) => `${n} can't be invited`,
  ALREADY_IN_GAME: (n) => `${n} already ${n === 1 ? "has" : "have"} a spot`,
  INVITE_DECLINED_RECENTLY: (n) => `${n} declined this week`,
  GAME_FULL: () => "the game filled up",
  INVITE_LIMIT: () => "you reached the invitation limit",
  SELF_INVITE: () => "you can't invite yourself",
};

/** "Invited 3 players. 1 can't be invited." for the bulk result; unknown codes count as "couldn't be invited". */
export function bulkInviteMessage(r: BulkInviteResult): string {
  const head =
    r.invited === 0
      ? "No one was invited."
      : `Invited ${r.invited} ${r.invited === 1 ? "player" : "players"}.`;
  const merged = new Map<string, number>();
  for (const [code, n] of Object.entries(r.skipped ?? {})) {
    const phrase = (SKIP_PHRASE[code] ?? ((k: number) => `${k} couldn't be invited`))(n);
    merged.set(phrase, n);
  }
  if (merged.size === 0) return head;
  const parts = Array.from(merged.keys());
  const tail = parts.join(", ");
  return `${head} ${tail.charAt(0).toUpperCase()}${tail.slice(1)}.`;
}
