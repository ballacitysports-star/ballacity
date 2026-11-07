/**
 * Home feed slices D and E (docs/design/home-feed.md): upcoming events for the feed's type chips,
 * read from `events` behind the `events_v2` switch. Slice E adds venue (facility) events and the
 * Camps, Tournaments and Open gym chips, behind the `venue_events` switch. Slice F adds trainer
 * group sessions (host kind 'trainer': clinics and camps), shown with the trainer's name.
 *
 * Rules (F5), all enforced by the database and kept here:
 *   * only events the viewer may read (events RLS: listed, or the viewer's own team's or venue's);
 *   * the venue only where the D0 rule allows (get_event_locations); a failed lookup hides it;
 *   * seats taken are true counts (get_event_registration_counts), never a row count of what
 *     the viewer happens to be allowed to read.
 */

export type FeedEventKind = "tryout" | "clinic" | "camp" | "tournament" | "open_gym";
export type FeedType =
  "all" | "pickup" | "tryouts" | "clinics" | "camps" | "tournaments" | "open_gym";

export const VENUE_EVENTS_SETTING_KEY = "venue_events";

const BASE_TYPES: { id: FeedType; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pickup", label: "Pickup" },
  { id: "tryouts", label: "Tryouts" },
  { id: "clinics", label: "Clinics" },
];
const VENUE_TYPES: { id: FeedType; label: string }[] = [
  { id: "camps", label: "Camps" },
  { id: "tournaments", label: "Tournaments" },
  { id: "open_gym", label: "Open gym" },
];

/** The chips: Camps, Tournaments and Open gym only once venue events are on. */
export function feedTypes(venueEventsOn: boolean): { id: FeedType; label: string }[] {
  return venueEventsOn ? [...BASE_TYPES, ...VENUE_TYPES] : BASE_TYPES;
}
export const FEED_TYPES = BASE_TYPES;

const ALL_FEED_TYPES: FeedType[] = [...BASE_TYPES, ...VENUE_TYPES].map((t) => t.id);

export function parseFeedType(v: unknown): FeedType {
  return typeof v === "string" && (ALL_FEED_TYPES as string[]).includes(v)
    ? (v as FeedType)
    : "all";
}

/** Which event kinds a feed type shows. Pickup shows none; All shows every kind that is on. */
export function kindsForFeedType(t: FeedType, venueEventsOn = false): FeedEventKind[] {
  if (t === "tryouts") return ["tryout"];
  if (t === "clinics") return ["clinic"];
  if (t === "camps") return venueEventsOn ? ["camp"] : [];
  if (t === "tournaments") return venueEventsOn ? ["tournament"] : [];
  if (t === "open_gym") return venueEventsOn ? ["open_gym"] : [];
  if (t === "all")
    return venueEventsOn
      ? ["tryout", "clinic", "camp", "tournament", "open_gym"]
      : ["tryout", "clinic"];
  return [];
}

export const FEED_EVENT_KIND_LABEL: Record<FeedEventKind, string> = {
  tryout: "Tryout",
  clinic: "Clinic",
  camp: "Camp",
  tournament: "Tournament",
  open_gym: "Open gym",
};

export type FeedEvent = {
  id: string;
  /** The team post it was copied from; the tryout page is keyed by it. */
  postId: string | null;
  kind: FeedEventKind;
  title: string;
  startsAt: string | null;
  teamId: string | null;
  /** The hosting venue (trainer_orgs id) of a venue event. */
  orgId: string | null;
  /** The hosting trainer (teams id, kind 'coach') of a trainer group session. */
  trainerId: string | null;
  /** The team's or the venue's name. */
  hostName: string;
  /** A verified venue (its badge on the card). */
  hostVerified: boolean;
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
  host_kind?: string | null;
  host_ref?: string | null;
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
      "id,legacy_post_id,kind,title,starts_at,price_cents,capacity,host_kind,host_ref,team_id,teams(name,sports)",
    )
    .in("kind", kinds)
    .or(`starts_at.gte.${now},starts_at.is.null`)
    .order("starts_at", { ascending: true, nullsFirst: false })
    .limit(opts.limit ?? 50);
  if (res.error) throw new Error(res.error.message);
  let rows = (res.data ?? []) as EventRow[];
  const sports = (opts.sports ?? []).filter(Boolean);
  // A trainer event carries no team, so its trainer (a teams row) is read separately.
  const trainerIds = [
    ...new Set(
      rows.filter((r) => r.host_kind === "trainer" && r.host_ref).map((r) => String(r.host_ref)),
    ),
  ];
  const trainers = new Map<string, { name: string; sports: string[] }>();
  if (trainerIds.length > 0) {
    const t = await client.from("teams").select("id,name,sports").in("id", trainerIds);
    if (!t.error && Array.isArray(t.data)) {
      for (const r of t.data as { id: string; name: string | null; sports: string[] | null }[]) {
        trainers.set(String(r.id), { name: r.name ?? "Trainer", sports: r.sports ?? [] });
      }
    }
  }
  const sportsOf = (r: EventRow): string[] =>
    r.host_kind === "trainer"
      ? (trainers.get(String(r.host_ref))?.sports ?? [])
      : (r.teams?.sports ?? []);
  // Venues list no sports, so a sport filter keeps venue events (it narrows team and trainer events).
  if (sports.length > 0) {
    rows = rows.filter(
      (r) => r.host_kind === "facility" || sportsOf(r).some((s) => sports.includes(s)),
    );
  }
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id).slice(0, 200);

  const orgIds = [
    ...new Set(
      rows.filter((r) => r.host_kind === "facility" && r.host_ref).map((r) => String(r.host_ref)),
    ),
  ];
  const [counts, locs, orgs] = await Promise.all([
    client.rpc("get_event_registration_counts", { _ids: ids }),
    client.rpc("get_event_locations", { _ids: ids }),
    orgIds.length > 0
      ? client.from("trainer_orgs").select("id,name,verified").in("id", orgIds)
      : Promise.resolve({ data: [], error: null } as Result),
  ]);
  const venueNames = new Map<string, { name: string; verified: boolean }>();
  if (!orgs.error && Array.isArray(orgs.data)) {
    for (const o of orgs.data as { id: string; name: string | null; verified: boolean | null }[]) {
      venueNames.set(String(o.id), { name: o.name ?? "Venue", verified: o.verified === true });
    }
  }
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

  return rows.map((r) => {
    const isVenue = r.host_kind === "facility";
    const isTrainer = r.host_kind === "trainer";
    const org = isVenue && r.host_ref ? venueNames.get(String(r.host_ref)) : undefined;
    const trainer = isTrainer && r.host_ref ? trainers.get(String(r.host_ref)) : undefined;
    return {
      id: r.id,
      postId: r.legacy_post_id,
      kind: r.kind as FeedEventKind,
      title: r.title,
      startsAt: r.starts_at,
      teamId: r.team_id,
      orgId: isVenue ? (r.host_ref ?? null) : null,
      trainerId: isTrainer ? (r.host_ref ?? null) : null,
      hostName: isVenue
        ? (org?.name ?? "Venue")
        : isTrainer
          ? (trainer?.name ?? "Trainer")
          : (r.teams?.name ?? "Team"),
      hostVerified: org?.verified ?? false,
      sports: sportsOf(r),
      location: venues.get(r.id) ?? null,
      venueHidden: !venues.has(r.id),
      price: r.price_cents == null ? null : r.price_cents / 100,
      spotsMax: r.capacity,
      spotsTaken: seats.get(r.id) ?? 0,
    };
  });
}
