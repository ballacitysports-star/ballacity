/**
 * Rate and rating rules for the /trainers directory: filter presets, the
 * max-rate test, and the two comparators used by the "Lowest rate" and "Top
 * rated" sorts. Kept pure so the page only wires them up.
 */

export const TRAINER_RATE_OPTIONS = [
  { value: "0", label: "Any rate" },
  { value: "50", label: "Up to $50/hr" },
  { value: "75", label: "Up to $75/hr" },
  { value: "100", label: "Up to $100/hr" },
  { value: "150", label: "Up to $150/hr" },
] as const;

/** Parse the URL value into a max hourly rate; 0 (or junk) means no limit. */
export function parseMaxRate(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * With a max rate set, only trainers who list a rate at or under it match; one
 * with no rate listed can't be promised to fit, so it is left out.
 */
export function matchesMaxRate(ratePerHour: number | null | undefined, max: number): boolean {
  if (max <= 0) return true;
  return typeof ratePerHour === "number" && ratePerHour > 0 && ratePerHour <= max;
}

type Rated = { ratePerHour?: number | null; rating?: number | null; reviews?: number | null };

const rateOf = (t: Rated) =>
  typeof t.ratePerHour === "number" && t.ratePerHour > 0 ? t.ratePerHour : Infinity;

/** Cheapest first; trainers with no listed rate go last. */
export function compareByRateAsc(a: Rated, b: Rated): number {
  const ar = rateOf(a);
  const br = rateOf(b);
  if (ar === br) return 0;
  return ar < br ? -1 : 1;
}

/** Best rating first, more reviews break ties; unrated trainers go last. */
export function compareByRatingDesc(a: Rated, b: Rated): number {
  const ar = a.rating ?? -1;
  const br = b.rating ?? -1;
  if (ar !== br) return br - ar;
  return (b.reviews ?? 0) - (a.reviews ?? 0);
}

/** Overlay real review stats on a trainer; keep what it already has when there are none. */
export function withReviewStats<T extends object>(
  trainer: T,
  stats: { avg: number; count: number } | undefined,
): T {
  if (!stats || stats.count <= 0) return trainer;
  return { ...trainer, rating: Math.round(stats.avg * 10) / 10, reviews: stats.count };
}
