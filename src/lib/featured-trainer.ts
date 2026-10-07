/**
 * Picks the real trainer spotlighted in the landing page's "For gyms &
 * facilities" section. Only trainers who can actually be booked qualify, and
 * every number shown (rating, review count, rate) comes from their profile —
 * nothing is invented. When nobody qualifies the page shows a labeled example.
 */

export type TrainerFacility = { id: string; name: string; city: string | null };

export type TrainerCandidate = {
  id: string;
  kind: string | null;
  ownerId: string | null;
  name: string;
  avatar: string | null;
  city: string | null;
  sports: string[];
  verified: boolean;
  ratePerHour: number | null;
  sessionTypes: string[];
  tagline: string | null;
  bio: string | null;
  availabilitySlots: unknown;
  availabilityRules: unknown;
  facility: TrainerFacility | null;
};

export type FeaturedTrainer = {
  id: string;
  name: string;
  avatar: string | null;
  city: string | null;
  verified: boolean;
  ratePerHour: number;
  specialties: string[];
  blurb: string | null;
  /** Average of public reviews, or null when there are none yet. */
  rating: number | null;
  reviewCount: number;
  facility: TrainerFacility;
};

export type RatingRow = { reviewee_id: string; rating: number };

const nonEmptyArray = (v: unknown) => Array.isArray(v) && v.length > 0;

/** A trainer can be booked once they've published availability. */
export function isBookable(c: Pick<TrainerCandidate, "availabilitySlots" | "availabilityRules">) {
  return nonEmptyArray(c.availabilitySlots) || nonEmptyArray(c.availabilityRules);
}

export function summarizeRatings(
  rows: readonly RatingRow[],
): Map<string, { avg: number; count: number }> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const r of rows) {
    if (!Number.isFinite(r.rating) || r.rating < 1 || r.rating > 5) continue;
    const cur = sums.get(r.reviewee_id) ?? { total: 0, count: 0 };
    cur.total += r.rating;
    cur.count += 1;
    sums.set(r.reviewee_id, cur);
  }
  const out = new Map<string, { avg: number; count: number }>();
  for (const [id, s] of sums) out.set(id, { avg: s.total / s.count, count: s.count });
  return out;
}

/** Up to four focus tags: what they offer (1-on-1, clinics…), then their sports. */
export function trainerSpecialties(c: Pick<TrainerCandidate, "sessionTypes" | "sports">): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...c.sessionTypes, ...c.sports]) {
    const tag = raw?.trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length === 4) break;
  }
  return out;
}

/** Tagline, else the first sentence of the bio, capped for a card. */
export function trainerBlurb(c: Pick<TrainerCandidate, "tagline" | "bio">): string | null {
  const text =
    c.tagline?.trim() ||
    c.bio
      ?.trim()
      .split(/(?<=[.!?])\s/)[0]
      ?.trim() ||
    "";
  if (!text) return null;
  return text.length > 140 ? `${text.slice(0, 137).trimEnd()}…` : text;
}

function score(c: TrainerCandidate, r: { avg: number; count: number } | undefined): number {
  let s = 0;
  const sports = c.sports.map((x) => x.toLowerCase());
  if (sports.includes("basketball")) s += 3;
  if (sports.length >= 2) s += 1; // multi-sport
  if (c.verified) s += 2;
  if (r) s += Math.min(r.count, 20) / 10 + (r.avg - 3) / 2;
  return s;
}

export function pickFeaturedTrainer(
  candidates: readonly TrainerCandidate[],
  ratings: ReadonlyMap<string, { avg: number; count: number }> = new Map(),
): FeaturedTrainer | null {
  const eligible = candidates.filter(
    (c): c is TrainerCandidate & { facility: TrainerFacility; ratePerHour: number } =>
      c.kind === "coach" &&
      !!c.ownerId &&
      !!c.facility &&
      typeof c.ratePerHour === "number" &&
      c.ratePerHour > 0 &&
      isBookable(c),
  );
  if (eligible.length === 0) return null;
  const best = [...eligible].sort(
    (a, b) => score(b, ratings.get(b.id)) - score(a, ratings.get(a.id)) || a.id.localeCompare(b.id),
  )[0];
  const r = ratings.get(best.id);
  return {
    id: best.id,
    name: best.name,
    avatar: best.avatar,
    city: best.city,
    verified: best.verified,
    ratePerHour: best.ratePerHour,
    specialties: trainerSpecialties(best),
    blurb: trainerBlurb(best),
    rating: r ? Math.round(r.avg * 10) / 10 : null,
    reviewCount: r?.count ?? 0,
    facility: best.facility,
  };
}
