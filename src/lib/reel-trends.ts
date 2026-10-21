/**
 * Progress over time from the Pro Analytics already stored on each reel.
 *
 * Pure: no new data and no new model call. Ratings are only compared within one
 * sport, because a basketball 70 and a soccer 70 are not the same thing. The most
 * frequent sport in the athlete's reels is the one shown.
 */

import {
  ANALYTICS_RATING_KEYS,
  type AdvancedAnalytics,
  type AnalyticsRatingKey,
} from "@/lib/reel-analytics";

export type TrendReel = {
  id: string;
  title: string;
  created_at: string;
  analytics: AdvancedAnalytics | null | undefined;
};

export type TrendPoint = { reelId: string; title: string; at: string; value: number };

export type RatingTrend = {
  key: AnalyticsRatingKey;
  points: TrendPoint[];
  latest: number;
  /** Mean of the latest few minus mean of the earliest few; null with fewer than 2 reels. */
  change: number | null;
};

export type RecurringCue = { area: string; reels: number; kind: "fix" | "strength" };

export type ReelTrends = {
  sport: string | null;
  reelCount: number;
  ratings: RatingTrend[];
  recurringFixes: RecurringCue[];
  recurringStrengths: RecurringCue[];
};

/** Fewer than this and a "trend" is just two dots; the card stays hidden. */
export const MIN_TREND_REELS = 2;

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function ratingChange(values: number[]): number | null {
  if (values.length < 2) return null;
  const w = Math.max(1, Math.min(3, Math.floor(values.length / 2)));
  return Math.round(mean(values.slice(-w)) - mean(values.slice(0, w)));
}

function recurring(
  reels: { analytics: AdvancedAnalytics }[],
  kind: "fix" | "strength",
): RecurringCue[] {
  const byArea = new Map<string, { label: string; reels: number }>();
  for (const r of reels) {
    const seen = new Set<string>();
    for (const c of r.analytics.biomechanics) {
      if (c.kind !== kind) continue;
      const k = c.area.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const cur = byArea.get(k);
      if (cur) cur.reels += 1;
      else byArea.set(k, { label: c.area.trim(), reels: 1 });
    }
  }
  return [...byArea.values()]
    .filter((a) => a.reels >= 2)
    .sort((a, b) => b.reels - a.reels || a.label.localeCompare(b.label))
    .slice(0, 3)
    .map((a) => ({ area: a.label, reels: a.reels, kind }));
}

/** Returns null when there is not enough to show a trend. */
export function buildReelTrends(reels: TrendReel[]): ReelTrends | null {
  const withData = reels
    .filter((r): r is TrendReel & { analytics: AdvancedAnalytics } => !!r.analytics)
    .filter((r) => Number.isFinite(Date.parse(r.created_at)));

  const bySport = new Map<string, typeof withData>();
  for (const r of withData) {
    const k = (r.analytics.sport ?? "").trim().toLowerCase() || "other";
    bySport.set(k, [...(bySport.get(k) ?? []), r]);
  }
  const best = [...bySport.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  )[0];
  if (!best || best[1].length < MIN_TREND_REELS) return null;

  const ordered = [...best[1]].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const ratings: RatingTrend[] = ANALYTICS_RATING_KEYS.map((key) => {
    const points = ordered.map((r) => ({
      reelId: r.id,
      title: r.title,
      at: r.created_at,
      value: r.analytics.ratings[key],
    }));
    const values = points.map((p) => p.value);
    return { key, points, latest: values[values.length - 1], change: ratingChange(values) };
  });

  return {
    sport: best[0] === "other" ? null : best[0],
    reelCount: ordered.length,
    ratings,
    recurringFixes: recurring(ordered, "fix"),
    recurringStrengths: recurring(ordered, "strength"),
  };
}

/* ------------------------------------------------------------------ */
/* Since your last clip                                                */
/* ------------------------------------------------------------------ */

export type FocusStatus = "improved" | "still" | "new" | "holding" | "not_seen";

export type FocusItem = {
  area: string;
  status: FocusStatus;
  /** The cue from this clip when there is one, else from the earlier clip. */
  cue: string;
};

export type FollowUp = {
  priorTitle: string;
  priorAt: string;
  ratingChanges: { key: AnalyticsRatingKey; change: number }[];
  items: FocusItem[];
};

/**
 * The reel to compare `current` against: the most recent earlier one in the same
 * sport that has analytics. Never crosses sports, never looks at later reels.
 */
export function findPriorReel(current: TrendReel, all: TrendReel[]): TrendReel | null {
  if (!current.analytics) return null;
  const sport = (current.analytics.sport ?? "").trim().toLowerCase();
  const at = Date.parse(current.created_at);
  let best: TrendReel | null = null;
  for (const r of all) {
    if (r.id === current.id || !r.analytics) continue;
    if ((r.analytics.sport ?? "").trim().toLowerCase() !== sport) continue;
    const t = Date.parse(r.created_at);
    if (!Number.isFinite(t) || !Number.isFinite(at) || t >= at) continue;
    if (!best || t > Date.parse(best.created_at)) best = r;
  }
  return best;
}

type AreaKinds = Map<string, { label: string; fix?: string; strength?: string }>;

function kindsByArea(a: AdvancedAnalytics): AreaKinds {
  const m: AreaKinds = new Map();
  for (const c of a.biomechanics) {
    const k = c.area.trim().toLowerCase();
    if (!k) continue;
    const cur = m.get(k) ?? { label: c.area.trim() };
    if (c.kind === "fix") cur.fix ??= c.cue;
    else cur.strength ??= c.cue;
    m.set(k, cur);
  }
  return m;
}

/**
 * Did the things flagged last time get better? A fix that is no longer mentioned is
 * "not_seen", never "improved": absence from a different clip is not evidence.
 */
export function compareToPrior(current: AdvancedAnalytics, prior: TrendReel): FollowUp | null {
  if (!prior.analytics) return null;
  const now = kindsByArea(current);
  const before = kindsByArea(prior.analytics);
  const items: FocusItem[] = [];

  for (const [k, p] of before) {
    if (!p.fix) continue;
    const c = now.get(k);
    if (c?.strength && !c.fix) items.push({ area: c.label, status: "improved", cue: c.strength });
    else if (c?.fix) items.push({ area: c.label, status: "still", cue: c.fix });
    else items.push({ area: p.label, status: "not_seen", cue: p.fix });
  }
  for (const [k, c] of now) {
    const p = before.get(k);
    if (c.fix && !p?.fix) items.push({ area: c.label, status: "new", cue: c.fix });
    else if (c.strength && !c.fix && p?.strength && !p.fix) {
      items.push({ area: c.label, status: "holding", cue: c.strength });
    }
  }

  const order: Record<FocusStatus, number> = { still: 0, new: 1, improved: 2, holding: 3, not_seen: 4 };
  items.sort((a, b) => order[a.status] - order[b.status] || a.area.localeCompare(b.area));

  return {
    priorTitle: prior.title,
    priorAt: prior.created_at,
    ratingChanges: ANALYTICS_RATING_KEYS.map((key) => ({
      key,
      change: current.ratings[key] - prior.analytics!.ratings[key],
    })),
    items: items.slice(0, 6),
  };
}
