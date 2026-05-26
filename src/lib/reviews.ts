import { useSyncExternalStore } from "react";

export type ReviewerKind = "player" | "trainer" | "team" | "host";
export type RevieweeKind = "player" | "trainer" | "team" | "host";

export type Review = {
  id: string;
  kind: ReviewerKind;          // who is leaving the review
  revieweeKind: RevieweeKind;  // who the review is about
  revieweeId: string;          // "me" for the demo player, org id for trainer/team, host id for host
  reviewerName: string;
  reviewerHandle: string;
  reviewerAvatar: string;
  reviewerSubtitle?: string;
  rating: number;
  scores?: Partial<{
    skill: number;
    sportsmanship: number;
    reliability: number;
    communication: number;
    coachability: number;
    impact: number;
    teamwork: number;
    punctuality: number;
  }>;
  title?: string;
  body: string;
  context?: string;
  date: string;
};

type ScoreKey = keyof NonNullable<Review["scores"]>;

export const REVIEWER_META: Record<
  ReviewerKind,
  { label: string; emoji: string; color: string; subFields: ScoreKey[] }
> = {
  player:  { label: "Player",  emoji: "🏀", color: "lime",
             subFields: ["skill", "sportsmanship", "teamwork"] },
  trainer: { label: "Trainer", emoji: "🧠", color: "coral",
             subFields: ["coachability", "skill", "punctuality"] },
  team:    { label: "Team",    emoji: "🛡️", color: "lime",
             subFields: ["impact", "teamwork", "reliability"] },
  host:    { label: "Host",    emoji: "🎯", color: "coral",
             subFields: ["reliability", "sportsmanship", "communication"] },
};

// Sub-fields rendered when a *player* writes a review ABOUT this reviewee kind.
export const REVIEWEE_META: Record<
  RevieweeKind,
  { label: string; emoji: string; subFields: ScoreKey[]; promptLabels: Record<string, string> }
> = {
  player:  { label: "Player",  emoji: "🏀",
             subFields: ["skill", "sportsmanship", "teamwork"],
             promptLabels: { skill: "Skill", sportsmanship: "Sportsmanship", teamwork: "Teamwork" } },
  trainer: { label: "Trainer", emoji: "🧠",
             subFields: ["skill", "communication", "punctuality"],
             promptLabels: { skill: "Knowledge", communication: "Communication", punctuality: "Punctuality" } },
  team:    { label: "Team",    emoji: "🛡️",
             subFields: ["reliability", "teamwork", "impact"],
             promptLabels: { reliability: "Organization", teamwork: "Vibe", impact: "Competition" } },
  host:    { label: "Host",    emoji: "🎯",
             subFields: ["reliability", "communication", "sportsmanship"],
             promptLabels: { reliability: "Organization", communication: "Communication", sportsmanship: "Fairness" } },
};

// Sample reviews about the "me" player (id: "me")
const initial: Review[] = [
  {
    id: "rv1", kind: "player", revieweeKind: "player", revieweeId: "me",
    reviewerName: "Riley Chen", reviewerHandle: "@riley", reviewerAvatar: "RC",
    reviewerSubtitle: "Player · Basketball",
    rating: 5,
    scores: { skill: 4, sportsmanship: 5, teamwork: 5 },
    title: "Glue guy on any team",
    body: "Locked up their best wing in the 4th and still found me on three back-cuts. Bring this guy back.",
    context: "Friday Night Run · 5v5",
    date: new Date(Date.now() - 2 * 86400_000).toISOString(),
  },
  {
    id: "rv2", kind: "host", revieweeKind: "player", revieweeId: "me",
    reviewerName: "Marcus Lee", reviewerHandle: "@marcus", reviewerAvatar: "ML",
    reviewerSubtitle: "Hosted · Tompkins Square Courts",
    rating: 5,
    scores: { reliability: 5, sportsmanship: 5, communication: 4 },
    title: "First in, last out",
    body: "Showed up 15 min early to help set cones and stayed to break down. Auto-invite from now on.",
    context: "Sunday Sunset 7v7",
    date: new Date(Date.now() - 6 * 86400_000).toISOString(),
  },
  {
    id: "rv3", kind: "trainer", revieweeKind: "player", revieweeId: "me",
    reviewerName: "Coach Jordan Kim", reviewerHandle: "@coachjordan", reviewerAvatar: "JK",
    reviewerSubtitle: "Trainer · USATF L2",
    rating: 4,
    scores: { coachability: 5, skill: 4, punctuality: 5 },
    title: "Big jump in 6 weeks",
    body: "Came in unable to hold tempo for 3 miles, finished the block running 7:00s for 5K. Listens, adjusts.",
    context: "Spring 5K Block · Week 6",
    date: new Date(Date.now() - 12 * 86400_000).toISOString(),
  },
  {
    id: "rv4", kind: "team", revieweeKind: "player", revieweeId: "me",
    reviewerName: "Eastside Elite", reviewerHandle: "@eastsideelite", reviewerAvatar: "EE",
    reviewerSubtitle: "Team · Dyckman Div 1",
    rating: 5,
    scores: { impact: 5, teamwork: 5, reliability: 4 },
    title: "Earned a roster spot",
    body: "Two-day evaluation. Played within the offense, switched on D, didn't force shots. Offering a spot for summer.",
    context: "Open Tryouts · Day 2",
    date: new Date(Date.now() - 20 * 86400_000).toISOString(),
  },

  // ---- Player → Trainer ----
  {
    id: "rv5", kind: "player", revieweeKind: "trainer", revieweeId: "c-jordan-kim",
    reviewerName: "Alex Rivera", reviewerHandle: "@alex", reviewerAvatar: "AR",
    reviewerSubtitle: "Player · Running",
    rating: 5,
    scores: { skill: 5, communication: 5, punctuality: 5 },
    title: "Knows exactly when to push",
    body: "Programs are dialed and feedback is specific. Dropped my 5K by 90s in one block.",
    context: "Spring 5K Block",
    date: new Date(Date.now() - 3 * 86400_000).toISOString(),
  },
  {
    id: "rv6", kind: "player", revieweeKind: "trainer", revieweeId: "c-priya-n",
    reviewerName: "Sam Park", reviewerHandle: "@spark", reviewerAvatar: "SP",
    reviewerSubtitle: "Player · Volleyball",
    rating: 5,
    scores: { skill: 5, communication: 4, punctuality: 5 },
    title: "Setter mechanics, completely rebuilt",
    body: "First clinic in years where every cue clicked. My hands are quieter and my second touch is faster.",
    context: "Setter Mechanics · Small Group",
    date: new Date(Date.now() - 8 * 86400_000).toISOString(),
  },

  // ---- Player → Team ----
  {
    id: "rv7", kind: "player", revieweeKind: "team", revieweeId: "t-eastside-elite",
    reviewerName: "Devon Wright", reviewerHandle: "@dwright", reviewerAvatar: "DW",
    reviewerSubtitle: "Player · Basketball",
    rating: 5,
    scores: { reliability: 5, teamwork: 5, impact: 5 },
    title: "Run like pros",
    body: "Practices start on time, film sessions are tight, captains actually lead. Best run I've had in NYC.",
    context: "Open Tryouts · Day 1",
    date: new Date(Date.now() - 5 * 86400_000).toISOString(),
  },
  {
    id: "rv8", kind: "player", revieweeKind: "team", revieweeId: "t-fc-mosaic",
    reviewerName: "Nico Alvarez", reviewerHandle: "@nico", reviewerAvatar: "NA",
    reviewerSubtitle: "Player · Soccer",
    rating: 4,
    scores: { reliability: 4, teamwork: 5, impact: 4 },
    title: "Welcoming, competitive",
    body: "Subbed in for a tryout, kept me in the squad. Group chat is active and respectful.",
    context: "Roster Trial",
    date: new Date(Date.now() - 14 * 86400_000).toISOString(),
  },
  {
    id: "rv9", kind: "player", revieweeKind: "team", revieweeId: "t-westside-paddles",
    reviewerName: "Jamie O.", reviewerHandle: "@jamieo", reviewerAvatar: "JO",
    reviewerSubtitle: "Player · Pickleball",
    rating: 5,
    scores: { reliability: 5, teamwork: 5, impact: 4 },
    title: "Round robin done right",
    body: "Brackets posted ahead, courts ready, refs fair. Came as a 3.5 single, left with three new doubles partners.",
    context: "Open Play Round Robin",
    date: new Date(Date.now() - 9 * 86400_000).toISOString(),
  },

  // ---- Player → Host ----
  {
    id: "rv10", kind: "player", revieweeKind: "host", revieweeId: "host-marcus",
    reviewerName: "Taylor Brooks", reviewerHandle: "@tbrooks", reviewerAvatar: "TB",
    reviewerSubtitle: "Player · Soccer",
    rating: 5,
    scores: { reliability: 5, communication: 5, sportsmanship: 5 },
    title: "Best Sunday run in the city",
    body: "Cones up before kickoff, balanced teams, called fouls fairly. Always the first game I sign up for.",
    context: "Sunday Sunset 7v7",
    date: new Date(Date.now() - 4 * 86400_000).toISOString(),
  },
  {
    id: "rv11", kind: "player", revieweeKind: "host", revieweeId: "host-marcus",
    reviewerName: "Priya N.", reviewerHandle: "@priyan", reviewerAvatar: "PN",
    reviewerSubtitle: "Player · Soccer",
    rating: 4,
    scores: { reliability: 5, communication: 4, sportsmanship: 5 },
    title: "Smooth check-in, fair teams",
    body: "Roster was set 30 min before kick. Sub rotation was fair even with extra players.",
    context: "Sunday Sunset 7v7",
    date: new Date(Date.now() - 11 * 86400_000).toISOString(),
  },
];

let reviews: Review[] = [...initial];
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export function addReview(r: Omit<Review, "id" | "date"> & { id?: string; date?: string }) {
  const full: Review = {
    id: r.id ?? `rv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    date: r.date ?? new Date().toISOString(),
    ...r,
  };
  reviews = [full, ...reviews];
  emit();
  return full;
}

export function getReviewsFor(revieweeId: string): Review[] {
  return reviews.filter((r) => r.revieweeId === revieweeId);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useReviewsFor(revieweeId: string): Review[] {
  useSyncExternalStore(subscribe, () => version, () => version);
  return getReviewsFor(revieweeId);
}

export function summarizeReviews(list: Review[]) {
  if (!list.length) return { avg: 0, count: 0, byKind: {} as Record<ReviewerKind, number> };
  const sum = list.reduce((a, r) => a + r.rating, 0);
  const byKind = list.reduce((acc, r) => {
    acc[r.kind] = (acc[r.kind] ?? 0) + 1;
    return acc;
  }, {} as Record<ReviewerKind, number>);
  return { avg: sum / list.length, count: list.length, byKind };
}
