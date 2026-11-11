/**
 * D0: where a team post's event happens is not always public.
 *
 * Clients cannot select team_posts.location, formatted_address, place_id, lat or lng
 * (migration 20261106210000_youth_post_venue_privacy). The venue comes from
 * public.team_post_venues(ids), which returns it for each post the caller can see and
 * is allowed to locate: every post of a non-youth team, and a youth team's posts only
 * for its members, their guardians, registrants and their guardians, and admins.
 *
 * Read the post with TEAM_POST_PUBLIC_COLUMNS, then merge the venues in. Ask with the
 * signed-in person's client whenever there is one, or members lose their own venue.
 */
export const TEAM_POST_PUBLIC_COLUMNS =
  "id,team_id,author_id,kind,title,body,event_date,price,spots_max,spots_taken,pinned," +
  "created_at,updated_at,hidden_at,share_scores,share_notes,cancel_cutoff_min,refund_rule," +
  "late_refund_pct,moderation_status,image_url,owner_hidden_at,moderator_hidden_at";

export const POST_VENUE_FIELDS = [
  "location",
  "formatted_address",
  "place_id",
  "lat",
  "lng",
] as const;

/** Shown where a youth team's venue would be, to people who may not see it. */
export const VENUE_HIDDEN_LABEL = "Venue shared with registered players and families";

export type PostVenue = {
  location: string | null;
  formatted_address: string | null;
  place_id: string | null;
  lat: number | null;
  lng: number | null;
};

type VenueRow = PostVenue & { id: string };
type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const MAX_IDS = 200;

/** Venues the caller may see, by post id. A post missing from the map is hidden. */
export async function fetchPostVenues(
  client: unknown,
  ids: readonly string[],
): Promise<Map<string, PostVenue>> {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, MAX_IDS);
  const out = new Map<string, PostVenue>();
  if (unique.length === 0) return out;
  const { data, error } = await (client as RpcClient).rpc("team_post_venues", { _ids: unique });
  // Fail closed: if the lookup fails, show no venue rather than guess.
  if (error || !Array.isArray(data)) return out;
  for (const r of data as VenueRow[]) {
    out.set(String(r.id), {
      location: r.location ?? null,
      formatted_address: r.formatted_address ?? null,
      place_id: r.place_id ?? null,
      lat: r.lat == null ? null : Number(r.lat),
      lng: r.lng == null ? null : Number(r.lng),
    });
  }
  return out;
}

const EMPTY: PostVenue = {
  location: null,
  formatted_address: null,
  place_id: null,
  lat: null,
  lng: null,
};

/** Each row with its venue fields, and venue_hidden when the caller may not see them. */
export function mergeVenues<T extends { id: string }>(
  rows: readonly T[],
  venues: Map<string, PostVenue>,
): (T & PostVenue & { venue_hidden: boolean })[] {
  return rows.map((r) => {
    const v = venues.get(String(r.id));
    return { ...r, ...(v ?? EMPTY), venue_hidden: !v };
  });
}

export async function withVenues<T extends { id: string }>(
  client: unknown,
  rows: readonly T[],
): Promise<(T & PostVenue & { venue_hidden: boolean })[]> {
  return mergeVenues(
    rows,
    await fetchPostVenues(
      client,
      rows.map((r) => String(r.id)),
    ),
  );
}
