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

import { compareToPrior, findPriorReel } from "@/lib/reel-trends";

describe("follow-up against the previous clip", () => {
  const cues = (list: [string, "fix" | "strength"][]) => ({
    biomechanics: list.map(([area, kind], i) => ({ t: i + 1, area, cue: `${area} ${kind}`, kind })),
  });

  it("picks the closest earlier reel in the same sport", () => {
    const a = reel(1, 60);
    const b = reel(2, 64);
    const c = reel(3, 70);
    const soccer = { ...reel(2, 50), id: "s", analytics: { ...reel(2, 50).analytics!, sport: "Soccer" } };
    expect(findPriorReel(c, [a, b, c, soccer])?.id).toBe("r2");
    expect(findPriorReel(a, [a, b, c])).toBeNull();
    expect(findPriorReel({ ...c, analytics: null }, [a, b])).toBeNull();
  });

  it("reports improved, still, new and holding, and never claims an absent fix improved", () => {
    const prior = reel(1, 60, cues([["Release", "fix"], ["Base", "fix"], ["Footwork", "fix"], ["Balance", "strength"]]));
    const now = reel(2, 68, cues([["Release", "strength"], ["Base", "fix"], ["Hips", "fix"], ["Balance", "strength"]]));
    const f = compareToPrior(now.analytics!, prior)!;
    const status = Object.fromEntries(f.items.map((i) => [i.area, i.status]));
    expect(status).toEqual({
      Release: "improved",
      Base: "still",
      Footwork: "not_seen",
      Hips: "new",
      Balance: "holding",
    });
    expect(f.ratingChanges.find((r) => r.key === "overall")!.change).toBe(8);
    expect(f.items[0].status).toBe("still");
  });
});
