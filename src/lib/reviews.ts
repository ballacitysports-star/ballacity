import { weightedCriterion, weightedStats } from "@/lib/reputation-engine";
import {
  RECOMMEND_COPY,
  REVIEW_QUESTIONS,
  tagLabel,
  type Answer,
  type Recommend,
} from "@/lib/review-questions";

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
  recommend?: Recommend; // "would you do this with them again?"
  answers?: Record<string, Answer>; // yes/mostly/no per behaviour question
  tags?: string[]; // praise tags
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

// Reputation tier ladder (gamified levels). A level needs both a trust score
// (`min`) and enough evidence (`minEvidence`, in effective reviews: recent,
// verified, distinct reviewers count fully), so a handful of glowing reviews
// can't make someone Elite overnight.
export const REPUTATION_LEVELS = [
  { min: 0, minEvidence: 0, name: "Rookie", emoji: "🌱", color: "text-muted-foreground" },
  { min: 55, minEvidence: 3, name: "Rising", emoji: "⚡", color: "text-sky-400" },
  { min: 70, minEvidence: 5, name: "Pro", emoji: "🔥", color: "text-lime" },
  { min: 80, minEvidence: 15, name: "Elite", emoji: "💎", color: "text-coral" },
  { min: 88, minEvidence: 40, name: "Legend", emoji: "👑", color: "text-amber-400" },
] as const;

// -------------------------- seed data --------------------------

function ago(days: number) {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

const initial: Review[] = [
  // ---- About "me" (player) ----
  {
    id: "rv1",
    kind: "player",
    revieweeKind: "player",
    revieweeId: "me",
    revieweeName: "Alex Rivera",
    reviewerName: "Riley Chen",
    reviewerHandle: "@riley",
    reviewerAvatar: "RC",
    reviewerSubtitle: "Player · Basketball",
    rating: 5,
    verified: true,
    helpfulCount: 14,
    scores: {
      sportsmanship: 5,
      communication: 5,
      teamwork: 5,
      reliability: 5,
      effort: 5,
      leadership: 4,
      respect: 5,
      competitive: 5,
      punctuality: 4,
      energy: 5,
    },
    title: "Glue guy on any team",
    body: "Locked up their best wing in the 4th and still found me on three back-cuts. Bring this guy back.",
    context: "Friday Night Run · 5v5",
    date: ago(2),
  },
  {
    id: "rv2",
    kind: "host",
    revieweeKind: "player",
    revieweeId: "me",
    revieweeName: "Alex Rivera",
    reviewerName: "Marcus Lee",
    reviewerHandle: "@marcus",
    reviewerAvatar: "ML",
    reviewerSubtitle: "Hosted · Tompkins Square Courts",
    rating: 5,
    verified: true,
    helpfulCount: 8,
    scores: {
      reliability: 5,
      sportsmanship: 5,
      communication: 4,
      respect: 5,
      effort: 5,
      energy: 5,
      teamwork: 4,
      leadership: 4,
      competitive: 4,
      punctuality: 4,
    },
    title: "First in, last out",
    body: "Showed up 15 min early to help set cones and stayed to break down. Auto-invite from now on.",
    context: "Sunday Sunset 7v7",
    date: ago(6),
  },
  {
    id: "rv3",
    kind: "trainer",
    revieweeKind: "player",
    revieweeId: "me",
    revieweeName: "Alex Rivera",
    reviewerName: "Trainer Jordan Kim",
    reviewerHandle: "@coachjordan",
    reviewerAvatar: "JK",
    reviewerSubtitle: "Trainer · USATF L2",
    rating: 4,
    verified: true,
    helpfulCount: 5,
    scores: {
      sportsmanship: 5,
      communication: 4,
      teamwork: 4,
      reliability: 5,
      effort: 5,
      leadership: 4,
      respect: 5,
      competitive: 5,
      punctuality: 4,
      energy: 5,
    },
    title: "Big jump in 6 weeks",
    body: "Came in unable to hold tempo for 3 miles, finished the block running 7:00s for 5K. Listens, adjusts.",
    context: "Spring 5K Block · Week 6",
    date: ago(12),
  },
  {
    id: "rv4",
    kind: "team",
    revieweeKind: "player",
    revieweeId: "me",
    revieweeName: "Alex Rivera",
    reviewerName: "Eastside Elite",
    reviewerHandle: "@eastsideelite",
    reviewerAvatar: "EE",
    reviewerSubtitle: "Team · Dyckman Div 1",
    rating: 5,
    verified: true,
    helpfulCount: 11,
    scores: {
      sportsmanship: 5,
      communication: 5,
      teamwork: 5,
      reliability: 4,
      effort: 5,
      leadership: 4,
      respect: 5,
      competitive: 5,
      punctuality: 5,
      energy: 4,
    },
    title: "Earned a roster spot",
    body: "Two-day evaluation. Played within the offense, switched on D, didn't force shots. Offering a spot for summer.",
    context: "Open Tryouts · Day 2",
    date: ago(20),
  },
  // ---- Player → Trainer ----
  {
    id: "rv5",
    kind: "player",
    revieweeKind: "trainer",
    revieweeId: "c-jordan-kim",
    revieweeName: "Trainer Jordan Kim",
    reviewerName: "Alex Rivera",
    reviewerHandle: "@alex",
    reviewerAvatar: "AR",
    reviewerSubtitle: "Player · Running",
    rating: 5,
    verified: true,
    helpfulCount: 9,
    scores: {
      knowledge: 5,
      communication: 5,
      motivation: 5,
      professionalism: 5,
      effectiveness: 5,
      development: 5,
      punctuality: 5,
      fairness: 5,
      safety: 5,
      experience: 5,
    },
    title: "Knows exactly when to push",
    body: "Programs are dialed and feedback is specific. Dropped my 5K by 90s in one block.",
    context: "Spring 5K Block",
    date: ago(3),
  },
  // ---- Player → Team ----
  {
    id: "rv7",
    kind: "player",
    revieweeKind: "team",
    revieweeId: "t-eastside-elite",
    revieweeName: "Eastside Elite",
    reviewerName: "Devon Wright",
    reviewerHandle: "@dwright",
    reviewerAvatar: "DW",
    reviewerSubtitle: "Player · Basketball",
    rating: 5,
    verified: true,
    helpfulCount: 12,
    scores: {
      culture: 5,
      organization: 5,
      competitiveness: 5,
      coaching: 5,
      communication: 5,
      facilities: 4,
      opportunities: 5,
      inclusiveness: 4,
      scheduling: 5,
      satisfaction: 5,
    },
    title: "Run like pros",
    body: "Practices start on time, film sessions are tight, captains actually lead. Best run I've had in NYC.",
    context: "Open Tryouts · Day 1",
    date: ago(5),
  },
  // ---- Player → Host ----
  {
    id: "rv10",
    kind: "player",
    revieweeKind: "host",
    revieweeId: "host-marcus",
    revieweeName: "Marcus Lee",
    reviewerName: "Taylor Brooks",
    reviewerHandle: "@tbrooks",
    reviewerAvatar: "TB",
    reviewerSubtitle: "Player · Soccer",
    rating: 5,
    verified: true,
    helpfulCount: 7,
    scores: {
      organization: 5,
      facility: 5,
      scheduling: 5,
      communication: 5,
      fairness: 5,
      safety: 5,
      staff: 5,
      checkin: 5,
      atmosphere: 5,
      experience: 5,
    },
    title: "Best Sunday run in the city",
    body: "Cones up before kickoff, balanced teams, called fouls fairly. Always the first game I sign up for.",
    context: "Sunday Sunset 7v7",
    date: ago(4),
  },
];

// -------------------------- demo data --------------------------
// The seed above only backs demo entities (sample-data ids that are not real
// accounts) and the signed-out "me" preview. Real reviews live in the database
// and are read through `@/lib/reviews-db`.

export function demoReviewsFor(revieweeId: string): Review[] {
  return initial.filter((r) => r.revieweeId === revieweeId);
}

export function demoReviewees(): {
  revieweeId: string;
  revieweeKind: RevieweeKind;
  revieweeName: string;
}[] {
  const map = new Map<
    string,
    { revieweeId: string; revieweeKind: RevieweeKind; revieweeName: string }
  >();
  for (const r of initial) {
    if (!map.has(r.revieweeId)) {
      map.set(r.revieweeId, {
        revieweeId: r.revieweeId,
        revieweeKind: r.revieweeKind,
        revieweeName: r.revieweeName,
      });
    }
  }
  return Array.from(map.values());
}

// -------------------------- reputation --------------------------

export type Reputation = {
  kind: RevieweeKind;
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
  /** "Would you do this with them again?" tallies (reviews that answered it). */
  recommend: { answered: number; yes: number; notSure: number; no: number };
  /** Most-given praise tags, most common first. */
  topTags: { key: string; label: string; count: number }[];
  /** Yes/mostly/no tallies for each behaviour question that has answers. */
  questionStats: {
    key: string;
    label: string;
    answered: number;
    yes: number;
    mostly: number;
    no: number;
  }[];
  recentTrend: "up" | "down" | "flat";
};

const reviewerKey = (r: Review) => r.reviewerId ?? (r.reviewerHandle || r.reviewerName);

/**
 * Highest level whose score and evidence bars are both met. Evidence is counted
 * to the nearest whole review: recency weighting makes even today's reviews
 * worth a hair under 1, and three reviews from this week should read as three.
 */
export function levelFor(
  trustScore: number,
  effectiveCount: number,
): (typeof REPUTATION_LEVELS)[number] {
  const evidence = Math.round(effectiveCount);
  return (
    [...REPUTATION_LEVELS]
      .reverse()
      .find((l) => trustScore >= l.min && evidence >= l.minEvidence) ?? REPUTATION_LEVELS[0]
  );
}

/**
 * The headline line for "would you do this again?": a percentage once there
 * are enough answers to mean something, otherwise the plain counts ("3 of 4").
 */
export function recommendLine(rep: Pick<Reputation, "kind" | "recommend">): string | null {
  const { answered, yes } = rep.recommend;
  if (answered === 0) return null;
  const stat = RECOMMEND_COPY[rep.kind].stat;
  return answered >= 5
    ? `${Math.round((yes / answered) * 100)}% ${stat}`
    : `${yes} of ${answered} ${stat}`;
}

/** What to print where a trust score goes: the number, or "New" before any reviews. */
export function trustLabel(rep: Pick<Reputation, "count" | "trustScore">): string {
  return rep.count > 0 ? String(rep.trustScore) : "New";
}

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

  const recommend = { answered: 0, yes: 0, notSure: 0, no: 0 };
  for (const r of visible) {
    if (!r.recommend) continue;
    recommend.answered += 1;
    if (r.recommend === "yes") recommend.yes += 1;
    else if (r.recommend === "no") recommend.no += 1;
    else recommend.notSure += 1;
  }

  const tagCounts = new Map<string, number>();
  for (const r of visible)
    for (const t of r.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const topTags = [...tagCounts]
    .map(([key, n]) => ({ key, label: tagLabel(kind, key), count: n }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 4);

  const questionStats = REVIEW_QUESTIONS[kind]
    .map((q) => {
      const st = { key: q.key, label: q.label, answered: 0, yes: 0, mostly: 0, no: 0 };
      for (const r of visible) {
        const a = r.answers?.[q.key];
        if (!a) continue;
        st.answered += 1;
        st[a] += 1;
      }
      return st;
    })
    .filter((q) => q.answered > 0);

  // Trust score: the cautious estimate of the true average (low end of its
  // likely range) on 0–100. It rises only as recent, consistent reviews pile
  // up, and a poor review always lowers it. With no reviews there is no score
  // (0, shown as "New"). See reputation-engine.ts.
  const trustScore = count ? stats.cautiousScore : 0;

  const level = levelFor(trustScore, count ? stats.effectiveCount : 0);

  // Recent trend: last 3 vs prior 3
  const sorted = [...visible].sort((a, b) => +new Date(b.date) - +new Date(a.date));
  const recent = sorted.slice(0, 3).map((r) => r.rating);
  const prior = sorted.slice(3, 6).map((r) => r.rating);
  const m = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const dr = m(recent) - m(prior);
  const recentTrend: Reputation["recentTrend"] = dr > 0.25 ? "up" : dr < -0.25 ? "down" : "flat";

  // AI-style summary (templated, deterministic)
  const aiSummary = buildSummary({
    count,
    avg,
    topStrengths: topStrengths.length ? topStrengths : topTags,
    kind,
    trend: recentTrend,
  });

  return {
    kind,
    avg,
    count,
    trustScore,
    level,
    byKind,
    criteriaAverages,
    topStrengths,
    aiSummary,
    verifiedShare,
    recommend,
    topTags,
    questionStats,
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
  return strengths ? `${subject} is most known for ${strengths}. ${trend}` : trend;
}
