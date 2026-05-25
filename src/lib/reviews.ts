import { useSyncExternalStore } from "react";

export type ReviewerKind = "player" | "trainer" | "team" | "host";

export type Review = {
  id: string;
  kind: ReviewerKind;
  // about whom
  revieweeId: string;       // "me" for demo (Alex)
  // who left it
  reviewerName: string;
  reviewerHandle: string;
  reviewerAvatar: string;   // initials
  reviewerSubtitle?: string; // e.g. "Coach · Running" or "Eastside Elite · Captain"
  rating: number;           // 1-5
  // optional sub-scores per kind
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
  context?: string;         // game/clinic/session name
  date: string;             // ISO
};

export const REVIEWER_META: Record<
  ReviewerKind,
  { label: string; emoji: string; color: string; subFields: (keyof NonNullable<Review["scores"]>)[] }
> = {
  player:  { label: "Player",        emoji: "🏀", color: "lime",
             subFields: ["skill", "sportsmanship", "teamwork"] },
  trainer: { label: "Trainer",       emoji: "🧠", color: "coral",
             subFields: ["coachability", "skill", "punctuality"] },
  team:    { label: "Team",          emoji: "🛡️", color: "lime",
             subFields: ["impact", "teamwork", "reliability"] },
  host:    { label: "Host",          emoji: "🎯", color: "coral",
             subFields: ["reliability", "sportsmanship", "communication"] },
};

// Sample reviews about the "me" player (id: "me")
const initial: Review[] = [
  {
    id: "rv1", kind: "player", revieweeId: "me",
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
    id: "rv2", kind: "host", revieweeId: "me",
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
    id: "rv3", kind: "trainer", revieweeId: "me",
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
    id: "rv4", kind: "team", revieweeId: "me",
    reviewerName: "Eastside Elite", reviewerHandle: "@eastsideelite", reviewerAvatar: "EE",
    reviewerSubtitle: "Team · Dyckman Div 1",
    rating: 5,
    scores: { impact: 5, teamwork: 5, reliability: 4 },
    title: "Earned a roster spot",
    body: "Two-day evaluation. Played within the offense, switched on D, didn't force shots. Offering a spot for summer.",
    context: "Open Tryouts · Day 2",
    date: new Date(Date.now() - 20 * 86400_000).toISOString(),
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
