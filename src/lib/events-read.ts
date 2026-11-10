/**
 * P2-1 stage 3: read team events from the `events` model, behind the `events_v2` switch.
 *
 * While the switch is off (or missing, or unreadable), callers keep reading `team_posts`
 * exactly as before. When it is on, the team events page reads `events` rows copied from
 * team posts (stage 2 keeps them in step) and maps them back to the row shape the page
 * already uses, keyed by the original post id, so editing and deleting still act on the post.
 */
import type { PostVenue } from "@/lib/post-venues";

export const EVENTS_V2_SETTING_KEY = "events_v2";

type QueryResult = { data: unknown; error: { message: string } | null };
type Builder = PromiseLike<QueryResult> & {
  select: (cols: string) => Builder;
  eq: (col: string, v: unknown) => Builder;
  in: (col: string, v: readonly unknown[]) => Builder;
  not: (col: string, op: string, v: unknown) => Builder;
  order: (col: string, opts?: { ascending?: boolean }) => Builder;
  maybeSingle: () => PromiseLike<QueryResult>;
};
export type EventsClient = {
  from: (table: string) => Builder;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<QueryResult>;
};

/** The switch reads as on only for {"enabled": true}. Anything else, including errors, is off. */
export function parseEventsV2Setting(value: unknown): boolean {
  return (
    typeof value === "object" && value !== null && (value as { enabled?: unknown }).enabled === true
  );
}

export async function isEventsV2Enabled(client: EventsClient): Promise<boolean> {
  return isAppSwitchOn(client, EVENTS_V2_SETTING_KEY);
}

/** An app_settings switch: on only for {"enabled": true}; missing, unreadable or failing reads as off. */
export async function isAppSwitchOn(client: EventsClient, key: string): Promise<boolean> {
  try {
    const { data, error } = await client
      .from("app_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) return false;
    return parseEventsV2Setting((data as { value?: unknown } | null)?.value);
  } catch {
    return false;
  }
}

export type CopiedEvent = {
  id: string;
  legacy_post_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  starts_at: string | null;
  price_cents: number | null;
  capacity: number | null;
};

export type EventLocation = {
  event_id: string;
  place_id: string | null;
  formatted_address: string | null;
  lat: number | null;
  lng: number | null;
};

/** The row shape the team events page renders (same fields as its team_posts read). */
export type TeamEventRow = {
  id: string;
  kind: "tryout" | "clinic";
  title: string;
  body: string | null;
  event_date: string | null;
  price: number | null;
  spots_max: number | null;
  spots_taken: number | null;
} & PostVenue & { venue_hidden: boolean };

/**
 * One copied event as the page's row. The id is the original post id. Price goes back to
 * whole dollars. Seats taken are counted from registrations. A copied post's free-text
 * location is stored as the address, so it fills both venue fields. No location row means
 * the caller may not see the venue.
 */
export function toTeamEventRow(
  ev: CopiedEvent,
  registered: number,
  loc: EventLocation | undefined,
): TeamEventRow | null {
  if (!ev.legacy_post_id || (ev.kind !== "tryout" && ev.kind !== "clinic")) return null;
  return {
    id: ev.legacy_post_id,
    kind: ev.kind,
    title: ev.title,
    body: ev.body,
    event_date: ev.starts_at,
    price: ev.price_cents == null ? null : ev.price_cents / 100,
    spots_max: ev.capacity,
    spots_taken: registered,
    location: loc?.formatted_address ?? null,
    formatted_address: loc?.formatted_address ?? null,
    place_id: loc?.place_id ?? null,
    lat: loc?.lat == null ? null : Number(loc.lat),
    lng: loc?.lng == null ? null : Number(loc.lng),
    venue_hidden: !loc,
  };
}

/** Registered seats per event, for the events the caller may see. Throws on error. */
export async function fetchRegistrationCounts(
  client: EventsClient,
  ids: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;
  const res = await client.rpc("get_event_registration_counts", { _ids: ids.slice(0, 200) });
  if (res.error) throw new Error(res.error.message);
  for (const r of (res.data ?? []) as { event_id: string; registered: number | null }[]) {
    counts.set(String(r.event_id), Number(r.registered ?? 0));
  }
  return counts;
}

/** A team's tryouts and clinics from `events`. Throws on a read error so the caller can fall back. */
export async function listTeamEventsFromEvents(
  client: EventsClient,
  teamId: string,
): Promise<TeamEventRow[]> {
  const evs = await client
    .from("events")
    .select("id,legacy_post_id,kind,title,body,starts_at,price_cents,capacity")
    .eq("team_id", teamId)
    .in("kind", ["tryout", "clinic"])
    .not("legacy_post_id", "is", null)
    .order("starts_at", { ascending: true });
  if (evs.error) throw new Error(evs.error.message);
  const events = (evs.data ?? []) as CopiedEvent[];
  if (events.length === 0) return [];
  const ids = events.map((e) => e.id);

  // Seats come from get_event_registration_counts: a member may read only their own
  // registrations, so counting rows here would undercount for everyone but staff.
  const counts = await fetchRegistrationCounts(client, ids);

  // Venues fail closed: if the lookup fails, every venue shows as hidden.
  const locs = new Map<string, EventLocation>();
  const loc = await client.rpc("get_event_locations", { _ids: ids.slice(0, 200) });
  if (!loc.error && Array.isArray(loc.data)) {
    for (const l of loc.data as EventLocation[]) locs.set(String(l.event_id), l);
  }

  const rows: TeamEventRow[] = [];
  for (const ev of events) {
    const row = toTeamEventRow(ev, counts.get(ev.id) ?? 0, locs.get(ev.id));
    if (row) rows.push(row);
  }
  return rows;
}

/** The tryout page's listing, in the shape getTryout returns (see lib/tryouts.functions). */
export type EventTryoutListing = {
  id: string;
  kind: "tryout" | "clinic";
  title: string;
  body: string;
  eventDate: string | null;
  location: string | null;
  venueHidden: boolean;
  price: number | null;
  spotsMax: number | null;
  spotsTaken: number;
  cancelCutoffMin: number | null;
  refundRule: string;
  lateRefundPct: number;
  teamId: string;
  teamName: string;
  teamAvatar: string | null;
  sports: string[];
};

/**
 * One tryout or clinic from `events`, found by its original post id, read as the public
 * would read it (`publicClient`). Returns null when there is no visible copy (for example a
 * youth event, which anonymous visitors cannot read from `events`): the caller then reads
 * team_posts as before. The venue and seats are asked with the viewer's own client, so a
 * registrant or staff member sees what they may. Throws on a read error.
 */
export async function getTryoutFromEvents(
  publicClient: EventsClient,
  viewerClient: EventsClient,
  postId: string,
): Promise<EventTryoutListing | null> {
  const res = await publicClient
    .from("events")
    .select(
      "id,legacy_post_id,kind,title,body,starts_at,price_cents,capacity,cancel_cutoff_min,refund_rule,late_refund_pct,team_id,teams!inner(name,avatar,sports)",
    )
    .eq("legacy_post_id", postId)
    .in("kind", ["tryout", "clinic"])
    .maybeSingle();
  if (res.error) throw new Error(res.error.message);
  const ev = res.data as
    | (CopiedEvent & {
        cancel_cutoff_min: number | null;
        refund_rule: string | null;
        late_refund_pct: number | null;
        team_id: string;
        teams: { name: string | null; avatar: string | null; sports: string[] | null } | null;
      })
    | null;
  if (!ev || !ev.legacy_post_id || (ev.kind !== "tryout" && ev.kind !== "clinic")) return null;

  const counts = await fetchRegistrationCounts(viewerClient, [ev.id]);
  // Venues fail closed: an error or no row means the venue is hidden.
  const loc = await viewerClient.rpc("get_event_location", { _event: ev.id });
  const venue =
    !loc.error && Array.isArray(loc.data) && loc.data.length > 0
      ? (loc.data[0] as { formatted_address: string | null })
      : null;

  return {
    id: ev.legacy_post_id,
    kind: ev.kind,
    title: ev.title,
    body: ev.body ?? "",
    eventDate: ev.starts_at,
    location: venue?.formatted_address ?? null,
    venueHidden: !venue,
    price: ev.price_cents == null ? null : ev.price_cents / 100,
    spotsMax: ev.capacity,
    spotsTaken: counts.get(ev.id) ?? 0,
    cancelCutoffMin: ev.cancel_cutoff_min,
    refundRule: ev.refund_rule ?? "until_cutoff",
    lateRefundPct: Number(ev.late_refund_pct ?? 0) || 0,
    teamId: ev.team_id,
    teamName: ev.teams?.name ?? "Team",
    teamAvatar: ev.teams?.avatar ?? null,
    sports: ev.teams?.sports ?? [],
  };
}
