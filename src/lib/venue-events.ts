/**
 * Venue events (P2-1 stage 5, Home feed slice E, decision F3): clinics, camps, tournaments and
 * open gym run by a venue (trainer_orgs), stored in `events` with host kind 'facility'.
 *
 * The database decides everything that matters: who may create one (venue staff, adults, a venue
 * that is not hidden), that it starts pending until moderation approves it, who may read it
 * (listed events; youth events only for signed-in members; staff see their pending ones), the
 * venue address (D0, get_event_locations) and sign-ups (register_for_event: age range, capacity).
 * This file only shapes the form's values and reads what the database allows.
 */

export type VenueEventKind = "clinic" | "camp" | "tournament" | "open_gym";

export const VENUE_EVENT_KINDS: { id: VenueEventKind; label: string }[] = [
  { id: "clinic", label: "Clinic" },
  { id: "camp", label: "Camp" },
  { id: "tournament", label: "Tournament" },
  { id: "open_gym", label: "Open gym" },
];

export function venueEventKindLabel(kind: string): string {
  return VENUE_EVENT_KINDS.find((k) => k.id === kind)?.label ?? "Event";
}

export type VenueEventDraft = {
  kind: VenueEventKind;
  title: string;
  body: string;
  /** A `datetime-local` value (local time), e.g. "2026-12-01T18:00". */
  startsAt: string;
  endsAt: string;
  minAge: string;
  maxAge: string;
  /** Dollars; empty means free. */
  price: string;
  /** Empty means no limit. */
  capacity: string;
  address: string;
};

export const EMPTY_VENUE_EVENT_DRAFT: VenueEventDraft = {
  kind: "clinic",
  title: "",
  body: "",
  startsAt: "",
  endsAt: "",
  minAge: "",
  maxAge: "",
  price: "",
  capacity: "",
  address: "",
};

export type VenueEventPayload = {
  kind: VenueEventKind;
  title: string;
  body?: string;
  starts_at: string;
  ends_at?: string;
  min_age: number;
  max_age: number;
  price_cents?: number;
  capacity?: number;
  location?: { formatted_address: string };
};

function wholeNumber(v: string): number | null {
  const t = v.trim();
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
}

/** Checks the form and builds create_facility_event's payload. The database checks again. */
export function buildVenueEventPayload(
  d: VenueEventDraft,
  now: Date = new Date(),
): { ok: true; payload: VenueEventPayload } | { ok: false; error: string } {
  if (!VENUE_EVENT_KINDS.some((k) => k.id === d.kind)) return { ok: false, error: "Pick a type." };
  const title = d.title.trim();
  if (title.length < 1 || title.length > 200)
    return { ok: false, error: "Add a title (up to 200 characters)." };
  const body = d.body.trim();
  if (body.length > 5000) return { ok: false, error: "The description is too long." };

  const min = wholeNumber(d.minAge);
  const max = wholeNumber(d.maxAge);
  // D1: every event names its age range.
  if (min == null || max == null) return { ok: false, error: "Add the age range." };
  if (min < 4 || max > 99 || min > max)
    return { ok: false, error: "Ages run from 4 to 99, youngest first." };

  const start = d.startsAt ? new Date(d.startsAt) : null;
  if (!start || Number.isNaN(start.getTime())) return { ok: false, error: "Add a start time." };
  if (start.getTime() < now.getTime()) return { ok: false, error: "The start time has passed." };
  let end: Date | null = null;
  if (d.endsAt) {
    end = new Date(d.endsAt);
    if (Number.isNaN(end.getTime()) || end.getTime() < start.getTime())
      return { ok: false, error: "It has to end after it starts." };
  }

  let priceCents: number | undefined;
  if (d.price.trim()) {
    const p = Number(d.price.trim());
    if (!Number.isFinite(p) || p < 0 || p > 100000)
      return { ok: false, error: "Enter a price in dollars." };
    priceCents = Math.round(p * 100);
  }
  let capacity: number | undefined;
  if (d.capacity.trim()) {
    const c = wholeNumber(d.capacity);
    if (c == null || c < 1 || c > 10000) return { ok: false, error: "Spots run from 1 to 10,000." };
    capacity = c;
  }
  const address = d.address.trim();
  if (address.length > 300) return { ok: false, error: "The address is too long." };

  const payload: VenueEventPayload = {
    kind: d.kind,
    title,
    starts_at: start.toISOString(),
    min_age: min,
    max_age: max,
  };
  if (body) payload.body = body;
  if (end) payload.ends_at = end.toISOString();
  if (priceCents != null) payload.price_cents = priceCents;
  if (capacity != null) payload.capacity = capacity;
  if (address) payload.location = { formatted_address: address };
  return { ok: true, payload };
}

/** Plain words for the database's refusals. */
export function venueEventErrorMessage(message: string): string {
  if (/NOT_FACILITY_STAFF/.test(message)) return "Only this venue's owner and admins can do that.";
  if (/ADULT_HOST_REQUIRED/.test(message)) return "Events can only be hosted by adults.";
  if (/FACILITY_NOT_FOUND/.test(message)) return "This venue isn't available right now.";
  if (/KIND_NOT_ALLOWED/.test(message))
    return "Venues can list clinics, camps, tournaments and open gym.";
  if (/AGE_RANGE_REQUIRED/.test(message)) return "Add the age range.";
  if (/OUTSIDE_AGE_RANGE/.test(message)) return "This event is for a different age group.";
  if (/AGE_UNKNOWN/.test(message)) return "Add your birthday in Settings to sign up.";
  if (/EVENT_FULL/.test(message)) return "This event is full.";
  if (/EVENT_STARTED/.test(message)) return "This event has already started.";
  if (/ALREADY_REGISTERED/.test(message)) return "You're already signed up.";
  if (/EVENT_NOT_FOUND/.test(message)) return "This event isn't available.";
  if (/AUTH_REQUIRED/.test(message)) return "Sign in first.";
  return message;
}

export type VenueEvent = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  startsAt: string | null;
  endsAt: string | null;
  minAge: number;
  maxAge: number;
  price: number | null;
  spotsMax: number | null;
  spotsTaken: number;
  location: string | null;
  venueHidden: boolean;
  /** 'pending' or 'held' are shown to staff only (the database hides them from everyone else). */
  status: string;
  registered: boolean;
};

type Result = { data: unknown; error: { message: string } | null };
type Query = PromiseLike<Result> & {
  select: (cols: string) => Query;
  eq: (col: string, v: unknown) => Query;
  in: (col: string, v: readonly unknown[]) => Query;
  or: (filter: string) => Query;
  order: (col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) => Query;
  limit: (n: number) => Query;
};
export type VenueEventsClient = {
  from: (table: string) => Query;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<Result>;
};

type Row = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  starts_at: string | null;
  ends_at: string | null;
  min_age: number;
  max_age: number;
  price_cents: number | null;
  capacity: number | null;
  moderation_status: string;
};

/** A venue's upcoming events the viewer may read, soonest first. Throws on a read error. */
export async function listVenueEvents(
  client: VenueEventsClient,
  orgId: string,
  opts: { userId?: string | null; now?: Date } = {},
): Promise<VenueEvent[]> {
  const now = (opts.now ?? new Date()).toISOString();
  const res = await client
    .from("events")
    .select(
      "id,kind,title,body,starts_at,ends_at,min_age,max_age,price_cents,capacity,moderation_status",
    )
    .eq("host_kind", "facility")
    .eq("host_ref", orgId)
    .or(`starts_at.gte.${now},starts_at.is.null`)
    .order("starts_at", { ascending: true, nullsFirst: false })
    .limit(50);
  if (res.error) throw new Error(res.error.message);
  const rows = (res.data ?? []) as Row[];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [counts, locs, mine] = await Promise.all([
    client.rpc("get_event_registration_counts", { _ids: ids }),
    client.rpc("get_event_locations", { _ids: ids }),
    opts.userId
      ? client
          .from("event_registrations")
          .select("event_id,status")
          .eq("user_id", opts.userId)
          .in("event_id", ids)
      : Promise.resolve({ data: [], error: null } as Result),
  ]);
  const seats = new Map<string, number>();
  if (!counts.error && Array.isArray(counts.data)) {
    for (const c of counts.data as { event_id: string; registered: number | null }[]) {
      seats.set(String(c.event_id), Number(c.registered ?? 0));
    }
  }
  // Venues fail closed (D0).
  const venues = new Map<string, string | null>();
  if (!locs.error && Array.isArray(locs.data)) {
    for (const l of locs.data as { event_id: string; formatted_address: string | null }[]) {
      venues.set(String(l.event_id), l.formatted_address ?? null);
    }
  }
  const registered = new Set<string>();
  if (!mine.error && Array.isArray(mine.data)) {
    for (const r of mine.data as { event_id: string; status: string }[]) {
      if (r.status === "registered") registered.add(String(r.event_id));
    }
  }

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    minAge: r.min_age,
    maxAge: r.max_age,
    price: r.price_cents == null ? null : r.price_cents / 100,
    spotsMax: r.capacity,
    spotsTaken: seats.get(r.id) ?? 0,
    location: venues.get(r.id) ?? null,
    venueHidden: !venues.has(r.id),
    status: r.moderation_status,
    registered: registered.has(r.id),
  }));
}
