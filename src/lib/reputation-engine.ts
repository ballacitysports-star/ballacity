/**
 * Reputation math (rating system, phase 2). Pure and deterministic.
 *
 * A plain average lets one 5-star review outrank forty 4.8s and counts a
 * two-year-old review the same as last week's. The engine fixes that with:
 *  - per-review weights: verified participation, recency decay, and
 *    diminishing returns for repeat reviews from the same person;
 *  - Bayesian shrinkage toward the platform mean, so thin profiles start
 *    near-average and move only as evidence accumulates;
 *  - a confidence value the UI uses to label ratings "Provisional".
 */

export type WeightableReview = {
  rating: number;
  /** ISO timestamp. */
  date: string;
  verified?: boolean;
  /** AI found the stars contradict the written text. */
  mismatch?: boolean;
  /** Stable id of the reviewer (or any string unique to them). */
  reviewerKey: string;
};

export const ENGINE = {
  /** Mean rating new profiles regress toward. */
  priorMean: 4.0,
  /** How many "virtual" reviews the prior is worth. */
  priorStrength: 3,
  /** Days for a review's weight to halve. */
  halfLifeDays: 180,
  /** Recency never discounts a review below this fraction. */
  recencyFloor: 0.15,
  /** Weight multiplier when the rating contradicts the review text. */
  mismatchWeight: 0.5,
  /** Weight of an unverified review relative to a verified one. */
  unverifiedWeight: 0.3,
  /** Effective-review count at which confidence reaches 50%. */
  confidenceHalfPoint: 5,
} as const;

/** Reviews with fewer effective reviews than this are shown as provisional. */
export const PROVISIONAL_CONFIDENCE = 0.4;

const DAY = 86_400_000;

export function recencyWeight(date: string, now: number): number {
  const t = Date.parse(date);
  if (Number.isNaN(t)) return 1;
  const ageDays = Math.max(0, (now - t) / DAY);
  return Math.max(ENGINE.recencyFloor, Math.pow(0.5, ageDays / ENGINE.halfLifeDays));
}

/**
 * Weight for each review, index-aligned with the input. Repeat reviews from the
 * same reviewer count 1, 1/√2, 1/√3… (newest first), so farming one reviewee
 * with many reviews has sharply diminishing effect.
 */
export function reviewWeights(reviews: WeightableReview[], now = Date.now()): number[] {
  const order = reviews
    .map((r, i) => ({ i, t: Date.parse(r.date) || 0, key: r.reviewerKey }))
    .sort((a, b) => b.t - a.t);
  const seen = new Map<string, number>();
  const repeat = new Array<number>(reviews.length).fill(1);
  for (const o of order) {
    const n = (seen.get(o.key) ?? 0) + 1;
    seen.set(o.key, n);
    repeat[o.i] = 1 / Math.sqrt(n);
  }
  return reviews.map((r, i) => {
    const base = r.verified ? 1 : ENGINE.unverifiedWeight;
    return base * (r.mismatch ? ENGINE.mismatchWeight : 1) * recencyWeight(r.date, now) * repeat[i];
  });
}

export type WeightedStats = {
  /** Weighted mean without shrinkage (what reviewers actually said). */
  weightedAvg: number;
  /** Weighted mean shrunk toward the platform prior. */
  adjustedAvg: number;
  /** Sum of weights — "how many full-strength reviews" this equals. */
  effectiveCount: number;
  /** 0..1, how settled the rating is. */
  confidence: number;
  provisional: boolean;
};

export function weightedStats(reviews: WeightableReview[], now = Date.now()): WeightedStats {
  if (reviews.length === 0) {
    return {
      weightedAvg: 0,
      adjustedAvg: 0,
      effectiveCount: 0,
      confidence: 0,
      provisional: true,
    };
  }
  const w = reviewWeights(reviews, now);
  let sw = 0;
  let sum = 0;
  reviews.forEach((r, i) => {
    sw += w[i];
    sum += w[i] * r.rating;
  });
  const weightedAvg = sw > 0 ? sum / sw : 0;
  const adjustedAvg = (sum + ENGINE.priorMean * ENGINE.priorStrength) / (sw + ENGINE.priorStrength);
  const confidence = sw / (sw + ENGINE.confidenceHalfPoint);
  return {
    weightedAvg,
    adjustedAvg,
    effectiveCount: sw,
    confidence,
    provisional: confidence < PROVISIONAL_CONFIDENCE,
  };
}

/** Weighted mean of per-criterion scores; reviews without that criterion are skipped. */
export function weightedCriterion(
  reviews: Array<WeightableReview & { scores?: Record<string, number> }>,
  key: string,
  now = Date.now(),
): number {
  const w = reviewWeights(reviews, now);
  let sw = 0;
  let sum = 0;
  reviews.forEach((r, i) => {
    const v = r.scores?.[key];
    if (typeof v === "number") {
      sw += w[i];
      sum += w[i] * v;
    }
  });
  return sw > 0 ? sum / sw : 0;
}
