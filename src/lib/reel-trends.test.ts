import { describe, expect, it } from "vitest";
import { buildReelTrends, ratingChange, type TrendReel } from "@/lib/reel-trends";
import { normalizeAdvancedAnalytics } from "@/lib/reel-analytics";

function reel(i: number, overall: number, extra: Record<string, unknown> = {}): TrendReel {
  return {
    id: `r${i}`,
    title: `Reel ${i}`,
    created_at: new Date(Date.UTC(2026, 8, i + 1)).toISOString(),
    analytics: normalizeAdvancedAnalytics(
      { sport: "Basketball", ratings: { overall, mechanics: overall, explosiveness: overall, iq: overall, execution: overall }, ...extra },
      { cohort: "adult" },
    ),
  };
}

describe("ratingChange", () => {
  it("compares the latest few with the earliest few", () => {
    expect(ratingChange([60])).toBeNull();
    expect(ratingChange([60, 70])).toBe(10);
    expect(ratingChange([50, 52, 54, 60, 62, 64])).toBe(10);
  });
});

describe("buildReelTrends", () => {
  it("needs at least two reels with analytics", () => {
    expect(buildReelTrends([reel(1, 60)])).toBeNull();
    expect(buildReelTrends([reel(1, 60), { ...reel(2, 70), analytics: null }])).toBeNull();
  });

  it("orders oldest to newest regardless of input order and reports the change", () => {
    const t = buildReelTrends([reel(3, 75), reel(1, 60), reel(2, 66)])!;
    const overall = t.ratings.find((r) => r.key === "overall")!;
    expect(overall.points.map((p) => p.value)).toEqual([60, 66, 75]);
    expect(overall.latest).toBe(75);
    expect(overall.change).toBe(15);
    expect(t.sport).toBe("basketball");
  });

  it("never mixes sports: the most frequent sport is shown", () => {
    const soccer = { ...reel(9, 99), analytics: { ...reel(9, 99).analytics!, sport: "Soccer" } };
    const t = buildReelTrends([reel(1, 60), reel(2, 70), soccer])!;
    expect(t.reelCount).toBe(2);
    expect(t.ratings[0].points.every((p) => p.value < 99)).toBe(true);
  });

  it("surfaces a cue that recurs across reels, once per reel", () => {
    const fix = (area: string) => ({
      biomechanics: [
        { t: 1, area, cue: "Elbow flares", kind: "fix" },
        { t: 2, area, cue: "Again", kind: "fix" },
      ],
    });
    const t = buildReelTrends([reel(1, 60, fix("Release")), reel(2, 62, fix("release")), reel(3, 64, fix("Base"))])!;
    expect(t.recurringFixes).toEqual([{ area: "Release", reels: 2, kind: "fix" }]);
    expect(t.recurringStrengths).toEqual([]);
  });
});
