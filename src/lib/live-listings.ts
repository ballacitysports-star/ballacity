/**
 * Pure helpers behind the superadmin Live Listings tab: which tables back each
 * section, how a listing's status is read, where its public page lives, and
 * which fields a superadmin may edit (validated the same on client and server).
 *
 * Camps are stored as team_posts.kind = 'clinic' (the table's CHECK allows
 * tryout, pickup, clinic, announcement, recap); they are only *labelled* camps.
 */

import { z } from "zod";
import { SPORTS } from "@/lib/sample-data";

export const LISTING_SECTIONS = ["games", "tryouts", "availability"] as const;
export type ListingSection = (typeof LISTING_SECTIONS)[number];

export const LISTING_VISIBILITY = ["all", "visible", "hidden", "past"] as const;
export type ListingVisibility = (typeof LISTING_VISIBILITY)[number];

/** team_posts kinds shown under Tryouts & Camps. */
export const TRYOUT_KINDS = ["tryout", "clinic"] as const;
export type TryoutKind = (typeof TRYOUT_KINDS)[number];

export const TRYOUT_KIND_LABELS: Record<TryoutKind, string> = { tryout: "Tryout", clinic: "Camp" };

/** Moderation kinds (superadminModerate) that back each section's hide/unhide. */
export const SECTION_MODERATION_KIND: Record<ListingSection, string> = {
  games: "games",
  tryouts: "posts",
  availability: "availability",
};

export type ListingStatus =
  "hidden" | "cancelled" | "completed" | "full" | "joins_closed" | "closed" | "active";

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  hidden: "Hidden",
  cancelled: "Cancelled",
  completed: "Completed",
  full: "Full",
  joins_closed: "Joins closed",
  closed: "Closed",
  active: "Active",
};

/** A listing row as the admin client returns it (untyped across three tables). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ListingRow = Record<string, any>;
type Row = ListingRow;

function isPast(iso: string | null | undefined, now: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t < now;
}

/**
 * One status per listing, most decisive first: hidden beats everything, then
 * the listing's own lifecycle, then capacity.
 */
export function listingStatus(section: ListingSection, row: Row, now = Date.now()): ListingStatus {
  if (row.hidden_at) return "hidden";
  if (section === "games") {
    if (row.status === "cancelled" || row.cancelled_at) return "cancelled";
    if (row.completed_at || isPast(row.ends_at ?? row.date, now)) return "completed";
    if (row.max_players > 0 && row.joined >= row.max_players) return "full";
    if (row.joins_closed) return "joins_closed";
    return "active";
  }
  if (section === "tryouts") {
    if (isPast(row.event_date, now)) return "completed";
    if (row.spots_max != null && row.spots_max > 0 && row.spots_taken >= row.spots_max) {
      return "full";
    }
    return "active";
  }
  if (row.status === "closed") return "closed";
  // ends_on is a date; it stays live through the whole of that day.
  if (row.ends_on && isPast(`${row.ends_on}T23:59:59`, now)) return "completed";
  return "active";
}

/** The page players see for this listing. */
export function liveLink(section: ListingSection, row: Row): string {
  if (section === "games") return `/games/${row.id}`;
  if (section === "tryouts") return `/tryouts/${row.id}`;
  return `/players/${row.user_id}`;
}

/** Matches a search term to a sport name, for array columns ilike cannot search. */
export function sportFromSearch(search: string): string | null {
  const q = search.trim().toLowerCase();
  if (!q) return null;
  return SPORTS.find((s) => s.name.toLowerCase() === q)?.name ?? null;
}

/* ------------------------------- edits ---------------------------------- */

const isoDate = z
  .string()
  .refine((v) => Number.isFinite(Date.parse(v)), "Enter a valid date and time");

export const GAME_EDIT_SCHEMA = z
  .object({
    title: z.string().trim().min(3, "Title needs at least 3 characters").max(120),
    sport: z.string().trim().min(1).max(40),
    date: isoDate,
    location: z.string().trim().min(2, "Enter a venue or address").max(200),
    neighborhood: z.string().trim().max(120),
    max_players: z.number().int().min(1, "At least 1 player").max(500),
    joins_closed: z.boolean(),
  })
  .partial();

export const TRYOUT_EDIT_SCHEMA = z
  .object({
    title: z.string().trim().min(3, "Title needs at least 3 characters").max(160),
    body: z.string().max(5000),
    event_date: isoDate.nullable(),
    kind: z.enum(TRYOUT_KINDS),
  })
  .partial();

export const AVAILABILITY_EDIT_SCHEMA = z
  .object({
    sports: z.array(z.string().trim().min(1).max(40)).min(1, "Pick at least one sport").max(12),
    skill_level: z.string().trim().min(1).max(80),
    city: z.string().trim().max(120).nullable(),
    status: z.enum(["open", "closed"]),
    note: z.string().max(1000).nullable(),
  })
  .partial();

export const EDIT_SCHEMAS = {
  games: GAME_EDIT_SCHEMA,
  tryouts: TRYOUT_EDIT_SCHEMA,
  availability: AVAILABILITY_EDIT_SCHEMA,
} as const;

const TIME_FIELDS = new Set(["date", "event_date"]);

/**
 * Only the fields whose value actually changes; nothing to write means no-op.
 * Times compare as instants, so "18:00:00+00:00" and "18:00:00.000Z" are equal.
 */
export function changedFields(before: Row, patch: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(patch)) {
    if (TIME_FIELDS.has(k) && before[k] && v) {
      if (Date.parse(before[k]) !== Date.parse(v as string)) out[k] = v;
      continue;
    }
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(v ?? null)) out[k] = v;
  }
  return out;
}

/**
 * Extra columns a game edit must also write so the listing stays coherent:
 * a moved start shifts a fixed end by the same amount, and a changed address
 * drops the map pin rather than leaving it on the old venue.
 */
export function gameSideEffects(before: Row, changes: Row): Row {
  const extra: Row = {};
  if (changes.date && before.ends_at && before.date) {
    const shift = Date.parse(changes.date) - Date.parse(before.date);
    const end = Date.parse(before.ends_at);
    if (Number.isFinite(shift) && Number.isFinite(end)) {
      extra.ends_at = new Date(end + shift).toISOString();
    }
  }
  if (changes.location !== undefined) {
    extra.lat = null;
    extra.lng = null;
  }
  return extra;
}
