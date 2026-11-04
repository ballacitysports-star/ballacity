/**
 * SEC-5: how the client reads a game's organizer.
 *
 * `hosted_games.host_id` is the organizer's account id. For a host who is not a confirmed adult it must not reach
 * people who are not related to them, so clients read games and join requests through two security_invoker views
 * (supabase/migrations/20261108110000_public_organizer_ref.sql):
 *
 *  - `hosted_games_public`: every game column, with `host_id` and `image` (a cover path starts with the uploader's
 *    account id) masked for unrelated viewers, plus `organizer_ref` (random per game), `viewer_is_host` and
 *    `organizer_hidden`;
 *  - `join_requests_visible`: join requests with `host_id` masked the same way, plus `viewer_is_host`.
 *
 * Writes (insert, update, delete) still go to the tables. "Is this my game" is `viewer_is_host`, never a filter on
 * `host_id`: after phase 2 the column is not readable by the API roles at all.
 */
export const GAMES_READ = "hosted_games_public" as const;
export const JOIN_REQUESTS_READ = "join_requests_visible" as const;

/** True when the signed-in viewer hosts the game. Falls back to the id for local, not-yet-saved games. */
export function viewerHostsGame(
  game: { viewerIsHost?: boolean; hostUserId?: string | null } | null | undefined,
  viewerId: string | null | undefined,
): boolean {
  if (!game) return false;
  if (game.viewerIsHost === true) return true;
  return !!viewerId && !!game.hostUserId && game.hostUserId === viewerId;
}

/**
 * A realtime row from `hosted_games` or `join_requests` without the columns the views mask. Realtime reads the
 * table, not the view, so until phase 2 its payload still carries them; the client never keeps them.
 */
export function stripMaskedColumns<T extends Record<string, unknown>>(
  row: T | null | undefined,
): Omit<T, "host_id" | "image"> | null {
  if (!row) return null;
  const {
    host_id: _host,
    image: _image,
    ...rest
  } = row as T & { host_id?: unknown; image?: unknown };
  return rest as Omit<T, "host_id" | "image">;
}

/**
 * Invite-link integrity: a personal invite carries `from` (the inviter). It can only be compared with the host when
 * this viewer may know the host; otherwise the database is the check (it names the host on the request itself).
 */
export function inviteMatchesHost(
  inviteFrom: string | null | undefined,
  knownHostId: string | null | undefined,
): boolean {
  if (!inviteFrom) return false;
  if (!knownHostId) return true;
  return inviteFrom === knownHostId;
}
