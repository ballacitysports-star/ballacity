/**
 * Pure helpers behind the curated dashboard on `/feed`: "Happening Soon",
 * "Tryouts & Camps" and "Nearby Courts & Facilities". Everything here is
 * deterministic given `now`, so the sections stay thin and the rules (what
 * counts as soon, how a tryout is labelled, which gyms are nearby) are tested
 * in one place.
 *
 * Day grouping reuses the shared date-key utilities in `@/lib/datetime`, and
 * join eligibility reuses `resolveJoinGate`, so a card here never offers a
 * spot the game page would refuse.
 */
import {
  dateKeyInZone,
  formatTimeOfDay,
  friendlyDayLabelKey,
  todayKeyInZone,
} from "@/lib/datetime";
import { gameDistanceMi } from "@/lib/game-distance";
import { isGameFinished } from "@/lib/game-time";
import { haversineKm, MI_PER_KM, type LatLng } from "@/lib/geo";
import { resolveJoinGate } from "@/lib/live-status";
import type { Game } from "@/lib/sample-data";

const HOUR_MS = 3_600_000;

// ---------------------------------------------------------------------------
// Section 1 — Happening Soon
// ---------------------------------------------------------------------------

/** How far ahead a run still counts as "happening soon". */
export const HAPPENING_SOON_WINDOW_MS = 48 * HOUR_MS;
export const HAPPENING_SOON_LIMIT = 10;

export type HappeningSoon = {
  /** Soonest first, capped at `limit`. */
  games: Game[];
  /** Open runs in the window before the cap. */
  total: number;
  /** Of those, how many start on today's date. */
  today: number;
};

/**
 * Open pickup runs starting in the next 48 hours that someone could still
 * join: public, not cancelled or finished, with a spot left and signups open.
 * Runs the viewer already joined or hosts are left out, since there is nothing
 * to fill for them.
 */
export function buildHappeningSoon(
  games: readonly Game[],
  opts: {
    now?: number;
    limit?: number;
    excludeIds?: ReadonlySet<string>;
    viewer?: LatLng | null;
  } = {},
): HappeningSoon {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? HAPPENING_SOON_LIMIT;
  const horizon = now + HAPPENING_SOON_WINDOW_MS;
  const viewer = opts.viewer ?? null;

  const open = games
    .filter((g) => !g.isPrivate && !opts.excludeIds?.has(g.id))
    .filter((g) => {
      const start = Date.parse(g.date);
      return Number.isFinite(start) && start >= now && start <= horizon;
    })
    .filter((g) => !isGameFinished(g, now))
    .filter((g) => !resolveJoinGate(g, now, { spotsLeft: g.maxPlayers - g.joined }).locked)
    .sort((a, b) => {
      const byStart = Date.parse(a.date) - Date.parse(b.date);
      if (byStart !== 0) return byStart;
      return (gameDistanceMi(a, viewer) ?? Infinity) - (gameDistanceMi(b, viewer) ?? Infinity);
    });

  const today = open.filter(
    (g) => dateKeyInZone(g.date, g.timezone) === todayKeyInZone(g.timezone, new Date(now)),
  ).length;

  return { games: open.slice(0, limit), total: open.length, today };
}

/** The urgency badge beside the section title, or null when there is nothing to say. */
export function happeningSoonBadge(s: Pick<HappeningSoon, "today" | "total">): string | null {
  if (s.today > 0) return `${s.today} ${s.today === 1 ? "run" : "runs"} today`;
  if (s.total > 0) return `${s.total} in the next 48h`;
  return null;
}

/** "Today at 6:30 PM", "Tomorrow at 9:00 AM", "Thu, Oct 8 at 7:00 PM". */
export function soonWhenLabel(game: Pick<Game, "date" | "timezone">, now: number): string {
  const key = dateKeyInZone(game.date, game.timezone);
  const today = todayKeyInZone(game.timezone, new Date(now));
  const day = friendlyDayLabelKey(key, today);
  return `${day} at ${formatTimeOfDay(game.date, game.timezone)}`;
}

/** "Free" or "$10 direct pay" (players pay the host directly). */
export function soonPriceLabel(price: number): string {
  if (!price || price <= 0) return "Free";
  const amount = Number.isInteger(price) ? String(price) : price.toFixed(2);
  return `$${amount} direct pay`;
}

/** "2 spots open", "1 spot open" or "Almost full" once it is down to the last few. */
export function soonSpotsLabel(spotsLeft: number, maxPlayers: number): string {
  if (spotsLeft <= 0) return "Full";
  if (spotsLeft === 1) return "1 spot open";
  const almostFull = maxPlayers > 0 && spotsLeft / maxPlayers <= 0.15;
  return almostFull ? "Almost full" : `${spotsLeft} spots open`;
}

// ---------------------------------------------------------------------------
// Section 2 — Tryouts & Camps
// ---------------------------------------------------------------------------

export type TryoutLike = {
  kind: "tryout" | "clinic";
  title: string;
  eventDate: string | null;
  location: string | null;
  price: number | null;
  spotsMax: number | null;
  spotsTaken: number;
  /** Age groups the hosting team works with (`teams.age_groups`). */
  teamAgeGroups?: readonly string[];
};

export const TRYOUT_KIND_LABEL = { tryout: "Tryout", clinic: "Camp / Clinic" } as const;

const UNDER_RE = /\b(?:u|under)[\s-]?(\d{1,2})\b/i;
const SUFFIX_U_RE = /\b(\d{1,2})-?u\b/i;
const AND_UNDER_RE = /\b(\d{1,2})\s?(?:&|and)\s?under\b/i;
const HIGH_SCHOOL_RE = /\b(?:high[\s-]?school|hs|varsity|jv|junior\s+varsity)\b/i;
const ADULT_RE = /\b(?:adults?|college|18\+|21\+|over[\s-]?(?:18|21|30))\b/i;
const OPEN_RE = /\bopen\b/i;
const TEAM_GROUP_LABEL: Record<string, string> = { youth: "Youth", teen: "Teen", adult: "Adult" };

function ageCap(title: string): number | null {
  const m = title.match(UNDER_RE) ?? title.match(SUFFIX_U_RE) ?? title.match(AND_UNDER_RE);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n >= 5 && n <= 19 ? n : null;
}

/**
 * Age division shown on a tryout card: `14U`, `High School`, `Adult` or `Open`.
 * Posts have no age column, so it is read from the title ("U14 fall tryouts",
 * "12 & under camp", "HS varsity"), then from the hosting team's own age
 * groups when it lists exactly one, and otherwise the event is `Open`.
 */
export function tryoutAgeDivision(t: Pick<TryoutLike, "title" | "teamAgeGroups">): string {
  const cap = ageCap(t.title);
  if (cap != null) return `${cap}U`;
  if (HIGH_SCHOOL_RE.test(t.title)) return "High School";
  if (ADULT_RE.test(t.title)) return "Adult";
  if (OPEN_RE.test(t.title)) return "Open";
  const groups = [...new Set((t.teamAgeGroups ?? []).filter((g) => g in TEAM_GROUP_LABEL))];
  return groups.length === 1 ? TEAM_GROUP_LABEL[groups[0]] : "Open";
}

/** Spots remaining, or null when the host set no cap. */
export function tryoutSpotsLeft(t: Pick<TryoutLike, "spotsMax" | "spotsTaken">): number | null {
  return t.spotsMax == null ? null : Math.max(t.spotsMax - t.spotsTaken, 0);
}

/**
 * "27 spots left · Waiver required" — the status line under the venue.
 * `waiverRequired` is null when unknown, in which case only the spots show.
 */
export function tryoutStatusLine(
  t: Pick<TryoutLike, "spotsMax" | "spotsTaken">,
  waiverRequired: boolean | null,
): string {
  const left = tryoutSpotsLeft(t);
  const spots =
    left == null
      ? "Open registration"
      : left === 0
        ? "Full"
        : `${left} ${left === 1 ? "spot" : "spots"} left`;
  if (waiverRequired == null) return spots;
  return `${spots} · ${waiverRequired ? "Waiver required" : "No waiver"}`;
}

export function tryoutPriceLabel(price: number | null): string {
  return price ? `$${price}` : "Free";
}

/** "Sat Oct 17 · 10:00 AM · Bogan Park" (date and time in the viewer's zone). */
export function tryoutWhenLine(t: Pick<TryoutLike, "eventDate" | "location">): string {
  const parts: string[] = [];
  const d = t.eventDate ? new Date(t.eventDate) : null;
  if (d && Number.isFinite(d.getTime())) {
    parts.push(
      d
        .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
        .replace(",", ""),
      d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
    );
  } else {
    parts.push("Date TBA");
  }
  if (t.location?.trim()) parts.push(t.location.trim());
  return parts.join(" · ");
}

/** Soonest first; undated events last. Does not mutate the input. */
export function sortTryoutsByDate<T extends Pick<TryoutLike, "eventDate">>(
  rows: readonly T[],
): T[] {
  const at = (r: T) => (r.eventDate ? Date.parse(r.eventDate) : Infinity);
  return [...rows].sort((a, b) => at(a) - at(b));
}

// ---------------------------------------------------------------------------
// Section 3 — Nearby Courts & Facilities
// ---------------------------------------------------------------------------

/** "Hosted here this week" looks this far ahead. */
export const FACILITY_ACTIVITY_WINDOW_MS = 7 * 24 * HOUR_MS;
export const NEARBY_FACILITY_LIMIT = 8;

/**
 * Upcoming public runs per facility over the next 7 days, keyed by org id.
 * Counts every game tied to a facility (official events and community runs).
 */
export function facilityRunCounts(
  games: readonly Pick<
    Game,
    | "orgId"
    | "date"
    | "duration"
    | "isPrivate"
    | "status"
    | "cancelledAt"
    | "completedAt"
    | "endsAt"
  >[],
  now: number = Date.now(),
): Map<string, number> {
  const horizon = now + FACILITY_ACTIVITY_WINDOW_MS;
  const counts = new Map<string, number>();
  for (const g of games) {
    if (!g.orgId || g.isPrivate) continue;
    const start = Date.parse(g.date);
    if (!Number.isFinite(start) || start > horizon) continue;
    if (isGameFinished(g, now)) continue;
    counts.set(g.orgId, (counts.get(g.orgId) ?? 0) + 1);
  }
  return counts;
}

/** "4 pickup runs hosted here this week". */
export function facilityActivityLabel(runs: number): string {
  if (runs <= 0) return "No runs posted this week — be the first";
  return `${runs} pickup ${runs === 1 ? "run" : "runs"} hosted here this week`;
}

/** Reads `trainer_orgs.geo` (`{ lat, lng }` JSON); null for anything unusable. */
export function parseOrgGeo(geo: unknown): LatLng | null {
  if (!geo || typeof geo !== "object" || Array.isArray(geo)) return null;
  const { lat, lng } = geo as { lat?: unknown; lng?: unknown };
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/** Miles from the viewer to a facility, or null when either side has no location. */
export function facilityDistanceMi(geo: unknown, viewer: LatLng | null): number | null {
  const at = parseOrgGeo(geo);
  if (!at || !viewer) return null;
  return haversineKm(viewer, at) * MI_PER_KM;
}

type RankableFacility = { id: string; geo?: unknown; featured_at?: string | null };

/**
 * Which facilities to show and in what order. With the viewer's location they
 * are nearest first (gyms with no coordinates last); without it, featured
 * listings lead, then the busiest, keeping the server's order otherwise.
 */
export function rankNearbyFacilities<T extends RankableFacility>(
  rows: readonly T[],
  viewer: LatLng | null,
  runCounts: ReadonlyMap<string, number>,
  limit: number = NEARBY_FACILITY_LIMIT,
): (T & { distanceMi: number | null })[] {
  const withDistance = rows.map((r, i) => ({
    row: { ...r, distanceMi: facilityDistanceMi(r.geo, viewer) },
    i,
  }));
  withDistance.sort((a, b) => {
    if (viewer) {
      const da = a.row.distanceMi ?? Infinity;
      const db = b.row.distanceMi ?? Infinity;
      if (da !== db) return da - db;
    } else {
      const fa = a.row.featured_at ? 0 : 1;
      const fb = b.row.featured_at ? 0 : 1;
      if (fa !== fb) return fa - fb;
      const ra = runCounts.get(a.row.id) ?? 0;
      const rb = runCounts.get(b.row.id) ?? 0;
      if (ra !== rb) return rb - ra;
    }
    return a.i - b.i;
  });
  return withDistance.slice(0, limit).map((x) => x.row);
}
