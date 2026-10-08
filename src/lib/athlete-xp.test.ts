import { describe, expect, it } from "vitest";
import { computeAthleteProgress, toPublicXp } from "@/lib/athlete-xp";

describe("toPublicXp", () => {
  const progress = computeAthleteProgress({
    attendedRuns: 12,
    hostedGames: 1,
    attendedTryouts: 1,
    noShows: 0,
    lateCancels: 0,
    attendanceHistory: Array(12).fill(true),
  });

  it("keeps level and the XP bar", () => {
    const pub = toPublicXp(progress);
    expect(pub.xp).toBe(progress.xp);
    expect(pub.level).toBe(progress.level);
    expect(pub.levelXp).toBe(progress.levelXp);
    expect(pub.nextLevelXp).toBe(progress.nextLevelXp);
  });

  it("exposes nothing about routine, reliability or counts", () => {
    const pub = toPublicXp(progress) as Record<string, unknown>;
    expect(Object.keys(pub).sort()).toEqual(["badges", "level", "levelXp", "nextLevelXp", "xp"]);
    // Twelve straight runs would earn Iron Streak and 12 runs reliability; neither is public.
    expect(progress.badges.map((b) => b.id)).toContain("streak-5");
    const ids = toPublicXp(progress).badges.map((b) => b.id);
    expect(ids).not.toContain("streak-5");
    expect(ids).not.toContain("reliable");
    expect(ids).toEqual(expect.arrayContaining(["first-run", "runs-10", "host", "tryout"]));
  });
});
