/**
 * WP 2.0: game invitations the server stands behind (migration 20261119100000).
 *
 * The host invites through game_invite_player / game_invite_players; the database checks that they host an open game with
 * room, that the player can be reached (one neutral refusal otherwise), and writes the notification from the real game.
 * The invitee answers through game_respond_invite: accepting approves their place request at once, and the roster, payment
 * and guardian steps then follow as for any approved player. Nothing here decides who may invite whom.
 */
import { supabase } from "@/integrations/supabase/client";

export type GameInviteStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired";

export type GameInviteGame = {
  id: string;
  title: string;
  sport: string;
  date: string;
  location: string | null;
  timezone: string | null;
  host_id: string;
};

export type GameInvite = {
  id: string;
  game_id: string;
  host_id: string;
  invitee_id: string;
  availability_id: string | null;
  message: string | null;
  status: GameInviteStatus;
  join_request_id: string | null;
  created_at: string;
  responded_at: string | null;
};

export type GameInviteWithGame = GameInvite & { game: GameInviteGame | null };

export type RespondResult = {
  status: GameInviteStatus | "full";
  join_request_id?: string | null;
};

export type BulkInviteResult = { invited: number; skipped: Record<string, number> };

type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
const rpc = () => supabase.rpc.bind(supabase) as unknown as Rpc;

type InvitesTable = {
  select: (cols: string) => {
    eq: (
      col: string,
      v: unknown,
    ) => {
      order: (
        col: string,
        o: { ascending: boolean },
      ) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
    };
  };
};
const invitesTable = () => supabase.from("game_invites" as never) as unknown as InvitesTable;

const GAME_COLUMNS = "game:hosted_games(id,title,sport,date,location,timezone,host_id)";

/** The sentence a host or player sees for a refusal; the raw code otherwise never reaches the screen. */
export function gameInviteErrorMessage(e: unknown): string {
  const msg = (e as { message?: string } | null)?.message ?? String(e ?? "");
  const code = msg.split(":")[0].trim();
  switch (code) {
    case "NOT_GAME_HOST":
      return "Only the game's host can invite players to it.";
    case "GAME_NOT_OPEN":
      return "This game isn't taking players right now.";
    case "GAME_FULL":
      return "This game is full.";
    case "ALREADY_IN_GAME":
      return "This player already has a spot in this game.";
    case "INVITE_NOT_AVAILABLE":
    case "MINOR_MESSAGING_BLOCKED":
      return "This player can't be invited to this game.";
    case "INVITE_DECLINED_RECENTLY":
      return "This player declined an invitation to this game in the last week.";
    case "INVITE_LIMIT":
      return msg.includes("30")
        ? "You can invite up to 30 players at once."
        : "You've reached the invitation limit for now. Try again later.";
    case "INVITE_NOT_FOUND":
      return "This invitation is no longer available.";
    case "SELF_INVITE":
      return "You can't invite yourself.";
    case "AGE_VERIFICATION_REQUIRED":
      return "Add your date of birth in your profile before joining games.";
    case "CHILD_GAME_PARTICIPATION_BLOCKED":
      return "A parent or guardian needs to allow game participation first.";
    case "BLOCKED_BY_HOST":
      return "You can't join this game.";
    default:
      return "Something went wrong. Please try again.";
  }
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc()(fn, args);
  if (error) throw new Error(error.message ?? fn);
  return data as T;
}

/** The host invites one player. A second call while one is pending returns the same invitation. */
export function inviteToGame(
  gameId: string,
  inviteeId: string,
  opts: { availabilityId?: string | null; message?: string | null } = {},
): Promise<string> {
  return call<string>("game_invite_player", {
    _game: gameId,
    _invitee: inviteeId,
    _availability: opts.availabilityId ?? null,
    _message: opts.message?.trim() ? opts.message.trim().slice(0, 500) : null,
  });
}

/** The host invites up to 30 players; reports how many were invited and why the rest were not. */
export function invitePlayersToGame(
  gameId: string,
  inviteeIds: string[],
  message?: string | null,
): Promise<BulkInviteResult> {
  return call<BulkInviteResult>("game_invite_players", {
    _game: gameId,
    _invitees: inviteeIds,
    _message: message?.trim() ? message.trim().slice(0, 500) : null,
  });
}

export function respondToGameInvite(inviteId: string, accept: boolean): Promise<RespondResult> {
  return call<RespondResult>("game_respond_invite", { _invite: inviteId, _accept: accept });
}

export function cancelGameInvite(inviteId: string): Promise<string> {
  return call<string>("game_cancel_invite", { _invite: inviteId });
}

function normalize(rows: unknown[] | null): GameInviteWithGame[] {
  return ((rows ?? []) as (GameInvite & { game: GameInviteGame | GameInviteGame[] | null })[]).map(
    (r) => ({ ...r, game: Array.isArray(r.game) ? (r.game[0] ?? null) : r.game }),
  );
}

/** Invitations to the signed-in player still waiting for an answer, for games that have not started. */
export async function listMyPendingGameInvites(
  userId: string,
  now: Date = new Date(),
): Promise<GameInviteWithGame[]> {
  const { data, error } = await invitesTable()
    .select(
      `id,game_id,host_id,invitee_id,availability_id,message,status,join_request_id,created_at,responded_at,${GAME_COLUMNS}`,
    )
    .eq("invitee_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return pendingFor(normalize(data), now);
}

/** Pending invitations whose game is still ahead (an invitation to a game that started is over, whatever its status says). */
export function pendingFor(
  rows: GameInviteWithGame[],
  now: Date = new Date(),
): GameInviteWithGame[] {
  return rows.filter(
    (r) => r.status === "pending" && !!r.game && new Date(r.game.date).getTime() > now.getTime(),
  );
}

/** Every invitation the host sent for one game, newest first. */
export async function listGameInvitesForGame(gameId: string): Promise<GameInvite[]> {
  const { data, error } = await invitesTable()
    .select(
      "id,game_id,host_id,invitee_id,availability_id,message,status,join_request_id,created_at,responded_at",
    )
    .eq("game_id", gameId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as GameInvite[];
}

type InviteLookupTable = {
  select: (cols: string) => {
    eq: (
      col: string,
      v: unknown,
    ) => {
      eq: (
        col: string,
        v: unknown,
      ) => {
        order: (
          col: string,
          o: { ascending: boolean },
        ) => {
          limit: (n: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
        };
      };
    };
  };
};

/** The host's latest invitation of one player to one game, or null. */
export async function findGameInvite(
  gameId: string,
  inviteeId: string,
): Promise<GameInvite | null> {
  const t = supabase.from("game_invites" as never) as unknown as InviteLookupTable;
  const { data, error } = await t
    .select(
      "id,game_id,host_id,invitee_id,availability_id,message,status,join_request_id,created_at,responded_at",
    )
    .eq("game_id", gameId)
    .eq("invitee_id", inviteeId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return ((data ?? [])[0] as GameInvite | undefined) ?? null;
}

type InviteByIdTable = {
  select: (cols: string) => {
    eq: (
      col: string,
      v: unknown,
    ) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> };
  };
};

/** One invitation by id, as the signed-in user may read it (invitee, host or the invitee's guardian), or null. */
export async function getGameInvite(inviteId: string): Promise<GameInvite | null> {
  const t = supabase.from("game_invites" as never) as unknown as InviteByIdTable;
  const { data, error } = await t
    .select(
      "id,game_id,host_id,invitee_id,availability_id,message,status,join_request_id,created_at,responded_at",
    )
    .eq("id", inviteId)
    .maybeSingle();
  if (error) throw error;
  return (data as GameInvite | null) ?? null;
}

type ProfilesTable = {
  select: (cols: string) => {
    in: (
      col: string,
      ids: readonly string[],
    ) => PromiseLike<{
      data: { id: string; display_name: string | null }[] | null;
      error: unknown;
    }>;
  };
};

/** Display names for invited players, as the host may read them; an unreadable profile reads "Player". */
export async function inviteeNames(ids: readonly string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return {};
  const t = supabase.from("profiles" as never) as unknown as ProfilesTable;
  const { data } = await t.select("id, display_name").in("id", unique);
  const out: Record<string, string> = {};
  for (const id of unique) out[id] = "Player";
  for (const p of data ?? []) if (p.display_name?.trim()) out[p.id] = p.display_name.trim();
  return out;
}
