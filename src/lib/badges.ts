/**
 * Badge / achievement engine.
 *
 * Badges are derived from two things only: attendance reliability (did the
 * player show up, on time, without bailing) and sportsmanship (how teammates,
 * hosts and trainers rate their conduct). Skill ratings are deliberately NOT an
 * input — nothing in this module may reference a skill score or tier.
 */

export type BadgeCategory = "reliability" | "sportsmanship" | "community";
export type BadgeTier = "bronze" | "silver" | "gold";

/** Trait mention counts pulled from sportsmanship reviews. */
export type SportsmanshipTraitCounts = {
  respectful: number;
  communicative: number;
  fairPlay: number;
  positive: number;
  onTime: number;
};

/** Everything the engine is allowed to look at. */
export type BadgeStats = {
  /** Games actually attended. */
  gamesPlayed: number;
  /** Games hosted. */
  hosted: number;
  /** 0–1 share of RSVPs where the player showed. */
  showUpRate: number;
  /** 0–1 share of shows that arrived on time. */
  onTimeRate: number;
  /** Last-minute cancels in the trailing 30 days. */
  lastMinuteCancels: number;
  /** Consecutive games shown on time. */
  currentStreak: number;
  longestStreak: number;
  /** Days since the last last-minute cancel (large number = never). */
  daysSinceLastCancel: number;
  /** Average sportsmanship rating, 0–5. */
  sportsmanshipRating: number;
  /** Number of reviews backing that rating. */
  reviewCount: number;
  traits: SportsmanshipTraitCounts;
  /** Identity verified. */
  verified: boolean;
};

export const EMPTY_BADGE_STATS: BadgeStats = {
  gamesPlayed: 0,
  hosted: 0,
  showUpRate: 0,
  onTimeRate: 0,
  lastMinuteCancels: 0,
  currentStreak: 0,
  longestStreak: 0,
  daysSinceLastCancel: 0,
  sportsmanshipRating: 0,
  reviewCount: 0,
  traits: { respectful: 0, communicative: 0, fairPlay: 0, positive: 0, onTime: 0 },
  verified: false,
};

export function makeBadgeStats(partial: Partial<BadgeStats> = {}): BadgeStats {
  return {
    ...EMPTY_BADGE_STATS,
    ...partial,
    traits: { ...EMPTY_BADGE_STATS.traits, ...(partial.traits ?? {}) },
  };
}

export type BadgeProgress = { current: number; target: number; unit: string };

export type BadgeDef = {
  id: string;
  label: string;
  emoji: string;
  description: string;
  category: BadgeCategory;
  tier: BadgeTier;
  earned: (s: BadgeStats) => boolean;
  /** Headline progress toward the badge (used for the "in progress" row). */
  progress?: (s: BadgeStats) => BadgeProgress;
};

const pct = (v: number) => Math.round(v * 100);

export const BADGES: BadgeDef[] = [
  // ---------------- Attendance reliability ----------------
  {
    id: "showed-up",
    label: "Showed Up",
    emoji: "✅",
    description: "Attend 5 games.",
    category: "reliability",
    tier: "bronze",
    earned: (s) => s.gamesPlayed >= 5,
    progress: (s) => ({ current: Math.min(s.gamesPlayed, 5), target: 5, unit: "games" }),
  },
  {
    id: "reliable-player",
    label: "Reliable Player",
    emoji: "🛡️",
    description: "15+ games attended with a 90% or better show-up rate.",
    category: "reliability",
    tier: "silver",
    earned: (s) => s.gamesPlayed >= 15 && s.showUpRate >= 0.9,
    progress: (s) => ({ current: Math.min(s.gamesPlayed, 15), target: 15, unit: "games" }),
  },
  {
    id: "ironclad",
    label: "Ironclad",
    emoji: "⛓️",
    description: "30+ games, 97% show-up rate, and no last-minute cancels in the past 30 days.",
    category: "reliability",
    tier: "gold",
    earned: (s) => s.gamesPlayed >= 30 && s.showUpRate >= 0.97 && s.lastMinuteCancels === 0,
    progress: (s) => ({ current: Math.min(s.gamesPlayed, 30), target: 30, unit: "games" }),
  },
  {
    id: "on-time-every-time",
    label: "On Time, Every Time",
    emoji: "⏱️",
    description: "20+ games with a 95% or better on-time rate.",
    category: "reliability",
    tier: "gold",
    earned: (s) => s.gamesPlayed >= 20 && s.onTimeRate >= 0.95,
    progress: (s) => ({ current: Math.min(pct(s.onTimeRate), 95), target: 95, unit: "% on time" }),
  },
  {
    id: "streak-keeper",
    label: "Streak Keeper",
    emoji: "🔥",
    description: "Show up on time 5 games in a row.",
    category: "reliability",
    tier: "bronze",
    earned: (s) => s.currentStreak >= 5,
    progress: (s) => ({ current: Math.min(s.currentStreak, 5), target: 5, unit: "in a row" }),
  },
  {
    id: "streak-legend",
    label: "Streak Legend",
    emoji: "🏆",
    description: "Reach a 15-game on-time streak.",
    category: "reliability",
    tier: "gold",
    earned: (s) => s.longestStreak >= 15,
    progress: (s) => ({ current: Math.min(s.longestStreak, 15), target: 15, unit: "in a row" }),
  },
  {
    id: "no-show-free",
    label: "No-Show Free",
    emoji: "📅",
    description: "60 days without a last-minute cancel.",
    category: "reliability",
    tier: "silver",
    earned: (s) => s.daysSinceLastCancel >= 60,
    progress: (s) => ({ current: Math.min(s.daysSinceLastCancel, 60), target: 60, unit: "days" }),
  },

  // ---------------- Sportsmanship ----------------
  {
    id: "good-sport",
    label: "Good Sport",
    emoji: "🤝",
    description: "5+ reviews with a sportsmanship rating of 4.5 or better.",
    category: "sportsmanship",
    tier: "bronze",
    earned: (s) => s.reviewCount >= 5 && s.sportsmanshipRating >= 4.5,
    progress: (s) => ({ current: Math.min(s.reviewCount, 5), target: 5, unit: "reviews" }),
  },
  {
    id: "respected",
    label: "Respected",
    emoji: "🙌",
    description: "Called out as respectful in 10+ reviews.",
    category: "sportsmanship",
    tier: "silver",
    earned: (s) => s.traits.respectful >= 10,
    progress: (s) => ({ current: Math.min(s.traits.respectful, 10), target: 10, unit: "mentions" }),
  },
  {
    id: "great-communicator",
    label: "Great Communicator",
    emoji: "💬",
    description: "Called out for communication in 10+ reviews.",
    category: "sportsmanship",
    tier: "silver",
    earned: (s) => s.traits.communicative >= 10,
    progress: (s) => ({
      current: Math.min(s.traits.communicative, 10),
      target: 10,
      unit: "mentions",
    }),
  },
  {
    id: "fair-play",
    label: "Fair Play",
    emoji: "⚖️",
    description: "Called out for fair play in 10+ reviews.",
    category: "sportsmanship",
    tier: "silver",
    earned: (s) => s.traits.fairPlay >= 10,
    progress: (s) => ({ current: Math.min(s.traits.fairPlay, 10), target: 10, unit: "mentions" }),
  },
  {
    id: "positive-presence",
    label: "Positive Presence",
    emoji: "🌟",
    description: "Called out for positive energy in 10+ reviews.",
    category: "sportsmanship",
    tier: "silver",
    earned: (s) => s.traits.positive >= 10,
    progress: (s) => ({ current: Math.min(s.traits.positive, 10), target: 10, unit: "mentions" }),
  },
  {
    id: "community-mvp",
    label: "Community MVP",
    emoji: "👑",
    description: "25+ reviews averaging 4.8 or better on sportsmanship.",
    category: "sportsmanship",
    tier: "gold",
    earned: (s) => s.reviewCount >= 25 && s.sportsmanshipRating >= 4.8,
    progress: (s) => ({ current: Math.min(s.reviewCount, 25), target: 25, unit: "reviews" }),
  },

  // ---------------- Community ----------------
  {
    id: "verified",
    label: "Verified",
    emoji: "🔷",
    description: "Identity verified on BallaCity.",
    category: "community",
    tier: "bronze",
    earned: (s) => s.verified,
  },
  {
    id: "host-5",
    label: "Host · 5 games",
    emoji: "🎯",
    description: "Host 5 games.",
    category: "community",
    tier: "bronze",
    earned: (s) => s.hosted >= 5,
    progress: (s) => ({ current: Math.min(s.hosted, 5), target: 5, unit: "hosted" }),
  },
  {
    id: "host-25",
    label: "Host · 25 games",
    emoji: "🏟️",
    description: "Host 25 games.",
    category: "community",
    tier: "gold",
    earned: (s) => s.hosted >= 25,
    progress: (s) => ({ current: Math.min(s.hosted, 25), target: 25, unit: "hosted" }),
  },
];

export const BADGES_BY_ID: Record<string, BadgeDef> = Object.fromEntries(
  BADGES.map((b) => [b.id, b]),
);

export function getBadge(id: string): BadgeDef | undefined {
  return BADGES_BY_ID[id];
}

/** Badge definitions the player has earned, in catalog order. */
export function earnedBadges(stats: BadgeStats): BadgeDef[] {
  return BADGES.filter((b) => b.earned(stats));
}

export function earnedBadgeIds(stats: BadgeStats): string[] {
  return earnedBadges(stats).map((b) => b.id);
}

export type BadgeInProgress = { badge: BadgeDef; progress: BadgeProgress; ratio: number };

/** Unearned badges sorted by how close they are, closest first. */
export function badgesInProgress(stats: BadgeStats, limit = 3): BadgeInProgress[] {
  return BADGES.filter((b) => !b.earned(stats) && b.progress)
    .map((b) => {
      const progress = b.progress!(stats);
      const ratio = progress.target > 0 ? progress.current / progress.target : 0;
      return { badge: b, progress, ratio };
    })
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, limit);
}
