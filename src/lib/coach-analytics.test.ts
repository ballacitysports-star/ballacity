import { describe, expect, it } from "vitest";
import {
  MIN_TEAM_SUMMARY_ATHLETES,
  buildTeamAnalytics,
  shareErrorMessage,
  shareModeForCohort,
  type AthleteReels,
} from "@/lib/coach-analytics";
import { normalizeAdvancedAnalytics } from "@/lib/reel-analytics";

function athlete(n: number, overalls: number[], fixAreas: string[] = []): AthleteReels {
  return {
    userId: `u${n}`,
    name: `Athlete ${n}`,
    avatarUrl: null,
    reels: overalls.map((o, i) => ({
      id: `u${n}-r${i}`,
      title: `Reel ${i}`,
      created_at: new Date(Date.UTC(2026, 8, i + 1)).toISOString(),
      analytics: normalizeAdvancedAnalytics(
        {
          sport: "Basketball",
          ratings: { overall: o, mechanics: o, explosiveness: o, iq: o, execution: o },
          biomechanics: fixAreas.map((area, k) => ({ t: k + 1, area, cue: `${area} needs work`, kind: "fix" })),
        },
        { cohort: "adult" },
      ),
    })),
  };
}

describe("shareModeForCohort", () => {
  it("lets adults and 16-17 choose, makes a guardian choose for 13-15, and blocks the rest", () => {
    expect(shareModeForCohort("adult")).toBe("self");
    expect(shareModeForCohort("teen_16_17")).toBe("self");
    expect(shareModeForCohort("teen_13_15")).toBe("guardian");
    for (const c of ["child_under_13", "unknown", null, undefined, ""]) {
      expect(shareModeForCohort(c)).toBe("unavailable");
    }
  });
});

describe("shareErrorMessage", () => {
  it("maps database codes and ignores everything else", () => {
    expect(shareErrorMessage(new Error("COACH_ANALYTICS_GUARDIAN_REQUIRED"))).toContain("guardian");
    expect(shareErrorMessage(new Error("boom"))).toBeNull();
  });
});

describe("buildTeamAnalytics", () => {
  it("hides team-wide figures until enough athletes share", () => {
    const two = buildTeamAnalytics([athlete(1, [60, 70]), athlete(2, [50])]);
    expect(two.sharing).toBe(2);
    expect(two.rows).toHaveLength(2);
    expect(two.summary).toBeNull();
    expect(MIN_TEAM_SUMMARY_ATHLETES).toBe(3);
  });

  it("averages the latest reel per athlete once there are enough, and finds common fixes", () => {
    const t = buildTeamAnalytics([
      athlete(1, [60, 70], ["Release", "Base"]),
      athlete(2, [50], ["Release"]),
      athlete(3, [90], ["Footwork"]),
    ]);
    expect(t.summary?.athletes).toBe(3);
    expect(t.summary?.average.overall).toBe(70); // (70 + 50 + 90) / 3, latest reel each
    expect(t.summary?.commonFixes).toEqual([{ area: "Release", athletes: 2 }]);
    const a1 = t.rows.find((r) => r.userId === "u1")!;
    expect(a1.overallChange).toBe(10);
    expect(a1.reelCount).toBe(2);
  });

  it("counts athletes with no analysed reel as sharing but not in the average", () => {
    const t = buildTeamAnalytics([
      athlete(1, [60]),
      athlete(2, [70]),
      athlete(3, [80]),
      { userId: "u4", name: "Athlete 4", avatarUrl: null, reels: [] },
    ]);
    expect(t.sharing).toBe(4);
    expect(t.summary?.athletes).toBe(3);
    expect(t.rows.find((r) => r.userId === "u4")!.latest).toBeNull();
  });
});
