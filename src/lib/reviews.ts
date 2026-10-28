import { weightedCriterion, weightedStats } from "@/lib/reputation-engine";

export type ReviewerKind = "player" | "trainer" | "team" | "host";
export type RevieweeKind = "player" | "trainer" | "team" | "host";

export type Review = {
  id: string;
  reviewerId?: string; // auth user id of the author (database reviews)
  kind: ReviewerKind; // who is leaving the review
  revieweeKind: RevieweeKind; // who the review is about
  revieweeId: string;
  revieweeName: string; // name of the reviewee
  reviewerName: string;
  reviewerHandle: string;
  reviewerAvatar: string;
  reviewerSubtitle?: string;
  rating: number; // 1..5 overall
  scores?: Record<string, number>; // criterion key -> 1..5
  title?: string;
  body: string;
  context?: string; // e.g. event name (also acts as verified participation)
  date: string;
  verified?: boolean; // verified participation badge
  isPrivate?: boolean; // private feedback (only visible to reviewee)
  helpfulCount?: number;
  flagged?: boolean; // hidden after moderation
  aiMismatch?: boolean; // rating contradicts the text (AI check); counts for less
  gameId?: string; // game this review is about, when game-based
  sport?: string;
};

export const REVIEWER_META: Record<
  ReviewerKind,
  { label: string; emoji: string; color: "lime" | "coral" }
> = {
  player: { label: "Player", emoji: "🏀", color: "lime" },
  trainer: { label: "Trainer", emoji: "🧠", color: "coral" },
  team: { label: "Team", emoji: "🛡️", color: "lime" },
  host: { label: "Host", emoji: "🎯", color: "coral" },
};

// 10 criteria for each relationship type (player → X).
// Order is intentional — first 3 surface as the "top strengths".
export const CRITERIA: Record<RevieweeKind, { key: string; label: string }[]> = {
  player: [
    { key: "sportsmanship", label: "Sportsmanship" },
    { key: "communication", label: "Communication" },
    { key: "teamwork", label: "Teamwork" },
    { key: "reliability", label: "Reliability" },
    { key: "effort", label: "Effort & Hustle" },
    { key: "leadership", label: "Leadership" },
    { key: "respect", label: "Respectfulness" },
    { key: "competitive", label: "Competitive Attitude" },
    { key: "punctuality", label: "Punctuality" },
    { key: "energy", label: "Positive Energy" },
  ],
  trainer: [
    { key: "knowledge", label: "Coaching Knowledge" },
    { key: "communication", label: "Communication Skills" },
    { key: "motivation", label: "Motivation & Encouragement" },
    { key: "professionalism", label: "Professionalism" },
    { key: "effectiveness", label: "Training Effectiveness" },
    { key: "development", label: "Player Development" },
    { key: "punctuality", label: "Punctuality" },
    { key: "fairness", label: "Fairness" },
    { key: "safety", label: "Safety Awareness" },
    { key: "experience", label: "Overall Experience" },
  ],
  team: [
    { key: "culture", label: "Team Culture" },
    { key: "organization", label: "Organization" },
    { key: "competitiveness", label: "Competitiveness" },
    { key: "coaching", label: "Coaching Quality" },
    { key: "communication", label: "Communication" },
    { key: "facilities", label: "Facilities" },
    { key: "opportunities", label: "Player Opportunities" },
    { key: "inclusiveness", label: "Inclusiveness" },
    { key: "scheduling", label: "Scheduling Reliability" },
    { key: "satisfaction", label: "Overall Satisfaction" },
  ],
  host: [
    { key: "organization", label: "Event Organization" },
    { key: "facility", label: "Facility Quality" },
    { key: "scheduling", label: "Scheduling" },
    { key: "communication", label: "Communication" },
    { key: "fairness", label: "Fair Competition" },
    { key: "safety", label: "Safety & Security" },
    { key: "staff", label: "Staff Professionalism" },
    { key: "checkin", label: "Check-in Experience" },
    { key: "atmosphere", label: "Entertainment / Atmosphere" },
    { key: "experience", label: "Overall Event Experience" },
  ],
};

export const REVIEWEE_META: Record<RevieweeKind, { label: string; emoji: string }> = {
  player: { label: "Player", emoji: "🏀" },
  trainer: { label: "Trainer", emoji: "🧠" },
  team: { label: "Team", emoji: "🛡️" },
  host: { label: "Host", emoji: "🎯" },
};

// Reputation tier ladder (gamified levels)
export const REPUTATION_LEVELS = [
  { min: 0, name: "Rookie", emoji: "🌱", color: "text-muted-foreground" },
  { min: 40, name: "Rising", emoji: "⚡", color: "text-sky-400" },
  { min: 60, name: "Pro", emoji: "🔥", color: "text-lime" },
  { min: 75, name: "Elite", emoji: "💎", color: "text-coral" },
  { min: 90, name: "Legend", emoji: "👑", color: "text-amber-400" },
] as const;

// -------------------------- reputation --------------------------

export type Reputation = {
  avg: number;
  count: number;
  trustScore: number; // 0..100
  level: (typeof REPUTATION_LEVELS)[number];
  byKind: Record<ReviewerKind, number>;
  criteriaAverages: { key: string; label: string; avg: number }[];
  topStrengths: { key: string; label: string; avg: number }[];
  aiSummary: string;
  verifiedShare: number; // 0..1
  /** Platform-prior-shrunk, recency/verification-weighted average. Use for ranking. */
  adjustedAvg: number;
  /** Reviews counted at full strength after weighting. */
  effectiveCount: number;
  /** 0..1 — how settled the rating is. */
  confidence: number;
  /** Too little evidence to treat the score as established. */
  provisional: boolean;
  recentTrend: "up" | "down" | "flat";
};

const reviewerKey = (r: Review) => r.reviewerId ?? (r.reviewerHandle || r.reviewerName);

export function computeReputation(list: Review[], kind: RevieweeKind): Reputation {
  const visible = list.filter((r) => !r.flagged && !r.isPrivate);
  const count = visible.length;
  const avg = count ? visible.reduce((a, r) => a + r.rating, 0) / count : 0;

  const byKind = visible.reduce(
    (acc, r) => {
      acc[r.kind] = (acc[r.kind] ?? 0) + 1;
      return acc;
    },
    {} as Record<ReviewerKind, number>,
  );

  const criteria = CRITERIA[kind];
  const weightable = visible.map((r) => ({
    ...r,
    reviewerKey: reviewerKey(r),
    mismatch: r.aiMismatch,
  }));
  const stats = weightedStats(weightable);
  const criteriaAverages = criteria.map((c) => ({
    key: c.key,
    label: c.label,
    avg: weightedCriterion(weightable, c.key),
  }));
  const topStrengths = [...criteriaAverages]
    .filter((c) => c.avg > 0)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 3);

  const verifiedShare = count ? visible.filter((r) => r.verified).length / count : 0;

  // Trust score: shrunk weighted quality (60%) + effective volume (20%) +
  // verified share (15%) + reviewer diversity (5%). See reputation-engine.ts.
  const quality = count ? (stats.adjustedAvg / 5) * 60 : 0;
  const volume = Math.min(1, stats.effectiveCount / 12) * 20;
  const verified = verifiedShare * 15;
  const diversity = (Math.min(4, Object.keys(byKind).length) / 4) * 5;
  const trustScore = Math.round(quality + volume + verified + diversity);

  const level = [...REPUTATION_LEVELS].reverse().find((l) => trustScore >= l.min)!;

  // Recent trend: last 3 vs prior 3
  const sorted = [...visible].sort((a, b) => +new Date(b.date) - +new Date(a.date));
  const recent = sorted.slice(0, 3).map((r) => r.rating);
  const prior = sorted.slice(3, 6).map((r) => r.rating);
  const m = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const dr = m(recent) - m(prior);
  const recentTrend: Reputation["recentTrend"] = dr > 0.25 ? "up" : dr < -0.25 ? "down" : "flat";

  // AI-style summary (templated, deterministic)
  const aiSummary = buildSummary({ count, avg, topStrengths, kind, trend: recentTrend });

  return {
    avg,
    count,
    trustScore,
    level,
    byKind,
    criteriaAverages,
    topStrengths,
    aiSummary,
    verifiedShare,
    adjustedAvg: stats.adjustedAvg,
    effectiveCount: stats.effectiveCount,
    confidence: stats.confidence,
    provisional: stats.provisional,
    recentTrend,
  };
}

function buildSummary(args: {
  count: number;
  avg: number;
  topStrengths: { label: string }[];
  kind: RevieweeKind;
  trend: Reputation["recentTrend"];
}): string {
  if (!args.count) return "No reviews yet — play a few games and feedback will start rolling in.";
  const strengths = args.topStrengths
    .map((s) => s.label.toLowerCase())
    .slice(0, 3)
    .join(", ");
  const subject =
    args.kind === "player"
      ? "This player"
      : args.kind === "trainer"
        ? "This coach"
        : args.kind === "team"
          ? "This team"
          : "This host";
  const trend =
    args.trend === "up"
      ? "Momentum is rising fast over the last few outings."
      : args.trend === "down"
        ? "Recent feedback has cooled slightly — watch for the next runs."
        : "Feedback has been remarkably consistent.";
  return `${subject} is most known for ${strengths}. ${trend}`;
}
