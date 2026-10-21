/**
 * Team view of Pro Analytics for coaching staff, from athletes who chose to share.
 *
 * Pure: the server fetches the shared athletes' analysed reels and this builds what a
 * coach sees. Individual rows exist only for athletes who opted in. A team summary
 * appears only when enough athletes shared that no average can point at one person.
 */

import type { AgeCohort } from "@/lib/child-policy";
import {
  ANALYTICS_RATING_KEYS,
  type AdvancedAnalytics,
  type AnalyticsRatingKey,
} from "@/lib/reel-analytics";
import { buildReelTrends, type RecurringCue, type TrendReel } from "@/lib/reel-trends";

/** Fewest sharing athletes before any team-wide figure is shown. */
export const MIN_TEAM_SUMMARY_ATHLETES = 3;

/** Who can turn sharing on for an athlete of this age band. */
export type ShareMode = "self" | "guardian" | "unavailable";

export function shareModeForCohort(cohort: AgeCohort | string | null | undefined): ShareMode {
  if (cohort === "adult" || cohort === "teen_16_17") return "self";
  if (cohort === "teen_13_15") return "guardian";
  return "unavailable";
}

const SHARE_ERRORS: Record<string, string> = {
  COACH_ANALYTICS_OFF: "Sharing analytics with coaches isn't available yet.",
  COACH_ANALYTICS_NOT_AVAILABLE: "Sharing analytics with coaches isn't available for this account.",
  COACH_ANALYTICS_NOT_ON_TEAM: "They need to be on this team first.",
  COACH_ANALYTICS_GUARDIAN_REQUIRED: "A parent or guardian has to turn this on.",
  COACH_ANALYTICS_SELF_ONLY: "Only the athlete can turn this on.",
};

export function shareErrorMessage(err: unknown): string | null {
  const text = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  for (const [code, msg] of Object.entries(SHARE_ERRORS)) if (text.includes(code)) return msg;
  return null;
}

export type AthleteReels = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  reels: TrendReel[];
};

export type AthleteRow = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  reelCount: number;
  latest: Record<AnalyticsRatingKey, number> | null;
  /** Overall change across the athlete's reels; null with fewer than two. */
  overallChange: number | null;
  recurringFixes: RecurringCue[];
  lastAt: string | null;
};

export type TeamSummary = {
  athletes: number;
  average: Record<AnalyticsRatingKey, number>;
  /** Areas flagged as a fix for more than one athlete in their latest reel. */
  commonFixes: { area: string; athletes: number }[];
};

export type TeamAnalytics = {
  sharing: number;
  rows: AthleteRow[];
  summary: TeamSummary | null;
};

function latestOf(reels: TrendReel[]): TrendReel | null {
  let best: TrendReel | null = null;
  for (const r of reels) {
    if (!r.analytics) continue;
    if (!best || Date.parse(r.created_at) > Date.parse(best.created_at)) best = r;
  }
  return best;
}

export function buildTeamAnalytics(athletes: AthleteReels[]): TeamAnalytics {
  const rows: AthleteRow[] = athletes.map((a) => {
    const latest = latestOf(a.reels);
    const trends = buildReelTrends(a.reels);
    return {
      userId: a.userId,
      name: a.name,
      avatarUrl: a.avatarUrl,
      reelCount: a.reels.filter((r) => r.analytics).length,
      latest: latest?.analytics ? { ...latest.analytics.ratings } : null,
      overallChange: trends?.ratings.find((r) => r.key === "overall")?.change ?? null,
      recurringFixes: trends?.recurringFixes ?? [],
      lastAt: latest?.created_at ?? null,
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));

  const withData = athletes
    .map((a) => ({ a, latest: latestOf(a.reels) }))
    .filter((x): x is { a: AthleteReels; latest: TrendReel & { analytics: AdvancedAnalytics } } =>
      !!x.latest?.analytics,
    );

  let summary: TeamSummary | null = null;
  if (withData.length >= MIN_TEAM_SUMMARY_ATHLETES) {
    const average = {} as Record<AnalyticsRatingKey, number>;
    for (const key of ANALYTICS_RATING_KEYS) {
      average[key] = Math.round(
        withData.reduce((s, x) => s + x.latest.analytics.ratings[key], 0) / withData.length,
      );
    }
    const counts = new Map<string, { label: string; athletes: number }>();
    for (const x of withData) {
      const seen = new Set<string>();
      for (const c of x.latest.analytics.biomechanics) {
        const k = c.area.trim().toLowerCase();
        if (c.kind !== "fix" || !k || seen.has(k)) continue;
        seen.add(k);
        const cur = counts.get(k);
        if (cur) cur.athletes += 1;
        else counts.set(k, { label: c.area.trim(), athletes: 1 });
      }
    }
    summary = {
      athletes: withData.length,
      average,
      commonFixes: [...counts.values()]
        .filter((c) => c.athletes >= 2)
        .sort((a, b) => b.athletes - a.athletes || a.label.localeCompare(b.label))
        .slice(0, 4)
        .map((c) => ({ area: c.label, athletes: c.athletes })),
    };
  }
  return { sharing: athletes.length, rows, summary };
}
