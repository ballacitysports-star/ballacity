/**
 * Exact venues of youth teams' posts (G1).
 *
 * The public `team_posts` columns hold only a coarse form (the team's city) once youth-location privacy is on; the exact venue
 * lives in `team_post_private`, which the database releases to the author, the team's managers and members, verified
 * guardians of members, registered families and moderators. Code that shows a post to someone who may be entitled reads
 * that table with the viewer's own client (row-level security decides) and overlays it with this helper. Code that emails
 * people who are entitled by construction (registered families, the roster) reads it with the server client for that post only.
 */
export type ExactTeamPostLocation = {
  post_id: string;
  location: string | null;
  formatted_address?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  place_id?: string | null;
};

export function exactLocationMap(
  rows: ExactTeamPostLocation[] | null | undefined,
): Map<string, ExactTeamPostLocation> {
  return new Map((rows ?? []).map((r) => [r.post_id, r]));
}

/** Overlay the exact venue onto a post row (`location` only unless the row already carries the other fields). */
export function withExactTeamPostLocation<T extends { id: string; location?: string | null }>(
  post: T,
  exact: Map<string, ExactTeamPostLocation>,
): T {
  const e = exact.get(post.id);
  if (!e || e.location == null) return post;
  return { ...post, location: e.location };
}
