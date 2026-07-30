import { describe, it, expect } from "vitest";
import {
  BADGES,
  badgesInProgress,
  earnedBadgeIds,
  makeBadgeStats,
  EMPTY_BADGE_STATS,
} from "./badges";

describe("badge engine", () => {
  it("earns nothing for a brand-new profile", () => {
    expect(earnedBadgeIds(EMPTY_BADGE_STATS)).toEqual([]);
  });

  it("never references skill ratings", () => {
    for (const b of BADGES) {
      expect(`${b.id} ${b.label} ${b.description}`.toLowerCase()).not.toContain("skill");
    }
  });

  it("respects reliability thresholds exactly", () => {
    expect(earnedBadgeIds(makeBadgeStats({ gamesPlayed: 4 }))).not.toContain("showed-up");
    expect(earnedBadgeIds(makeBadgeStats({ gamesPlayed: 5 }))).toContain("showed-up");

    const nearlyReliable = makeBadgeStats({ gamesPlayed: 15, showUpRate: 0.89 });
    expect(earnedBadgeIds(nearlyReliable)).not.toContain("reliable-player");
    expect(earnedBadgeIds(makeBadgeStats({ gamesPlayed: 15, showUpRate: 0.9 }))).toContain(
      "reliable-player",
    );
  });

  it("requires zero recent cancels for Ironclad", () => {
    const base = { gamesPlayed: 30, showUpRate: 0.98 };
    expect(earnedBadgeIds(makeBadgeStats({ ...base, lastMinuteCancels: 1 }))).not.toContain(
      "ironclad",
    );
    expect(earnedBadgeIds(makeBadgeStats({ ...base, lastMinuteCancels: 0 }))).toContain("ironclad");
  });

  it("earns sportsmanship badges from reviews and trait mentions", () => {
    const ids = earnedBadgeIds(
      makeBadgeStats({
        reviewCount: 25,
        sportsmanshipRating: 4.9,
        traits: { respectful: 12, communicative: 10, fairPlay: 9, positive: 11, onTime: 20 },
      }),
    );
    expect(ids).toEqual(
      expect.arrayContaining([
        "good-sport",
        "respected",
        "great-communicator",
        "positive-presence",
        "community-mvp",
      ]),
    );
    expect(ids).not.toContain("fair-play");
  });

  it("reports progress toward the closest unearned badges", () => {
    const stats = makeBadgeStats({ gamesPlayed: 4, currentStreak: 4 });
    const upcoming = badgesInProgress(stats, 3);
    expect(upcoming.length).toBe(3);
    const showedUp = upcoming.find((u) => u.badge.id === "showed-up");
    expect(showedUp?.progress).toEqual({ current: 4, target: 5, unit: "games" });
    // sorted closest-first
    expect(upcoming[0].ratio).toBeGreaterThanOrEqual(upcoming[1].ratio);
  });
});
