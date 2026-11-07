/**
 * Home feed slice D (docs/design/home-feed.md): upcoming tryouts and clinics for the feed's type
 * chips, read from `events` behind the `events_v2` switch.
 *
 * Rules (F5), all enforced by the database and kept here:
 *   * only events the viewer may read (events RLS: listed, or the viewer's own team's);
 *   * the venue only where the D0 rule allows (get_event_locations); a failed lookup hides it;
 *   * seats taken are true counts (get_event_registration_counts), never a row count of what
 *     the viewer happens to be allowed to read.
 */

export type FeedEventKind = "tryout" | "clinic";
export type FeedType = "all" | "pickup" | "tryouts" | "clinics";

export const FEED_TYPES: { id: FeedType; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pickup", label: "Pickup" },
  { id: "tryouts", label: "Tryouts" },
  { id: "clinics", label: "Clinics" },
];

export function parseFeedType(v: unknown): FeedType {
  return v === "pickup" || v === "tryouts" || v === "clinics" ? v : "all";
}

/** Which event kinds a feed type shows. Pickup shows none; All shows both. */
export function kindsForFeedType(t: FeedType): FeedEventKind[] {
  if (t === "tryouts") return ["tryout"];
  if (t === "clinics") return ["clinic"];
  if (t === "all") return ["tryout", "clinic"];
  return [];
}

export type FeedEvent = {
  id: string;
  /** The team post it was copied from; the tryout page is keyed by it. */
  postId: string | null;
  kind: FeedEventKind;
  title: string;
  startsAt: string | null;
  teamId: string | null;
  teamName: string;
  sports: string[];
  location: string | null;
  venueHidden: boolean;
  price: number | null;
  spotsMax: number | null;
  spotsTaken: number;
};

type Result = { data: unknown; error: { message: string } | null };
type Query = PromiseLike<Result> & {
  select: (cols: string) => Query;
  in: (col: string, v: readonly unknown[]) => Query;
  or: (filter: string) => Query;
  order: (col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) => Query;
  limit: (n: number) => Query;
};
export type FeedEventsClient = {
  from: (table: string) => Query;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<Result>;
};

type EventRow = {
  id: string;
  legacy_post_id: string | null;
  kind: string;
  title: string;
  starts_at: string | null;
  price_cents: number | null;
  capacity: number | null;
  team_id: string | null;
  teams: { name: string | null; sports: string[] | null } | null;
};

/** Upcoming (or date-TBA) events of these kinds, soonest first, dated before undated. Throws on a read error. */
export async function listFeedEvents(
  client: FeedEventsClient,
  kinds: FeedEventKind[],
  opts: { sports?: string[]; now?: Date; limit?: number } = {},
): Promise<FeedEvent[]> {
  if (kinds.length === 0) return [];
  const now = (opts.now ?? new Date()).toISOString();
  const res = await client
    .from("events")
    .select(
      "id,legacy_post_id,kind,title,starts_at,price_cents,capacity,team_id,teams(name,sports)",
    )
    .in("kind", kinds)
    .or(`starts_at.gte.${now},starts_at.is.null`)
    .order("starts_at", { ascending: true, nullsFirst: false })
    .limit(opts.limit ?? 50);
  if (res.error) throw new Error(res.error.message);
  let rows = (res.data ?? []) as EventRow[];
  const sports = (opts.sports ?? []).filter(Boolean);
  if (sports.length > 0) {
    rows = rows.filter((r) => (r.teams?.sports ?? []).some((s) => sports.includes(s)));
  }
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id).slice(0, 200);

  const [counts, locs] = await Promise.all([
    client.rpc("get_event_registration_counts", { _ids: ids }),
    client.rpc("get_event_locations", { _ids: ids }),
  ]);
  const seats = new Map<string, number>();
  if (!counts.error && Array.isArray(counts.data)) {
    for (const c of counts.data as { event_id: string; registered: number | null }[]) {
      seats.set(String(c.event_id), Number(c.registered ?? 0));
    }
  }
  // Venues fail closed.
  const venues = new Map<string, string | null>();
  if (!locs.error && Array.isArray(locs.data)) {
    for (const l of locs.data as { event_id: string; formatted_address: string | null }[]) {
      venues.set(String(l.event_id), l.formatted_address ?? null);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    postId: r.legacy_post_id,
    kind: r.kind as FeedEventKind,
    title: r.title,
    startsAt: r.starts_at,
    teamId: r.team_id,
    teamName: r.teams?.name ?? "Team",
    sports: r.teams?.sports ?? [],
    location: venues.get(r.id) ?? null,
    venueHidden: !venues.has(r.id),
    price: r.price_cents == null ? null : r.price_cents / 100,
    spotsMax: r.capacity,
    spotsTaken: seats.get(r.id) ?? 0,
  }));
}
