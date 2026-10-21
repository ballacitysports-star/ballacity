import { describe, expect, it } from "vitest";
import { AI_TIERS, DEFAULT_AI_LIMITS, parseAiLimits } from "./config";
import { RECOMMENDED_TIER_PRESET, applyRecommendedPreset, limitsProblems } from "./admin-controls";

describe("applyRecommendedPreset", () => {
  it("sets the named knobs and leaves every other quota alone", () => {
    const out = applyRecommendedPreset(DEFAULT_AI_LIMITS);
    for (const tier of AI_TIERS) {
      const p = RECOMMENDED_TIER_PRESET[tier];
      expect(out[tier].maxConcurrentJobs).toBe(p.maxConcurrentJobs);
      expect(out[tier].maxVideoSeconds).toBe(p.maxVideoSeconds);
      expect(out[tier].maxUploadMb).toBe(p.maxUploadMb);
      expect(out[tier].perFeature.reel_pipeline).toEqual({
        daily: p.reelsDaily,
        monthly: p.reelsMonthly,
      });
      expect(out[tier].perFeature.reel_coach).toEqual(
        DEFAULT_AI_LIMITS[tier].perFeature.reel_coach,
      );
      expect(out[tier].perFeature.text_moderation).toEqual(
        DEFAULT_AI_LIMITS[tier].perFeature.text_moderation,
      );
    }
  });

  it("produces a row the server parser keeps verbatim", () => {
    const out = applyRecommendedPreset(DEFAULT_AI_LIMITS);
    expect(limitsProblems(out)).toEqual([]);
    expect(parseAiLimits(JSON.parse(JSON.stringify(out)))).toEqual(out);
  });
});

describe("limitsProblems", () => {
  it("accepts the defaults", () => {
    expect(limitsProblems(DEFAULT_AI_LIMITS)).toEqual([]);
  });

  it("flags values the parser would silently replace, and daily above monthly", () => {
    const bad = structuredClone(DEFAULT_AI_LIMITS);
    bad.free.maxConcurrentJobs = 0;
    bad.premium.maxVideoSeconds = NaN;
    bad.team.perFeature.reel_coach = { daily: 50, monthly: 10 };
    bad.gym.perFeature.reel_pipeline = { daily: -1, monthly: 10 };
    const problems = limitsProblems(bad);
    expect(problems).toHaveLength(4);
    expect(problems.join(" ")).toMatch(/Free: Concurrent jobs/);
    expect(problems.join(" ")).toMatch(/Team: Reel Coach daily cap is above/);
  });
});
