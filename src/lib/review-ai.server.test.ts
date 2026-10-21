import { describe, expect, it } from "vitest";
import {
  isRatingMismatch,
  normalizeAnalysis,
  normalizeInsight,
  shouldRefreshInsight,
} from "@/lib/review-ai.server";

describe("review AI normalization", () => {
  it("keeps only known traits, clamps sentiment and flags mismatches", () => {
    const a = normalizeAnalysis(
      { traits: ["respectful", "respectful", "toxic", "onTime"], sentiment: -3 },
      5,
    );
    expect(a.traits).toEqual(["respectful", "onTime"]);
    expect(a.sentiment).toBe(-1);
    expect(a.mismatch).toBe(true);
  });

  it("survives junk model output", () => {
    expect(normalizeAnalysis("nope", 3)).toEqual({ traits: [], sentiment: 0, mismatch: false });
    expect(normalizeInsight({ summary: "" })).toBeNull();
    expect(normalizeInsight(null)).toBeNull();
  });

  it("only calls glowing-text/low-stars (or the reverse) a mismatch", () => {
    expect(isRatingMismatch(1, 0.8)).toBe(true);
    expect(isRatingMismatch(5, 0.8)).toBe(false);
    expect(isRatingMismatch(3, -0.9)).toBe(false);
  });

  it("caps insight lists and field lengths", () => {
    const d = normalizeInsight({
      summary: "x".repeat(900),
      strengths: ["a", "b", "c", "d", "e"],
      growth: ["g1", "g2", "g3"],
    });
    expect(d!.summary.length).toBe(400);
    expect(d!.strengths).toHaveLength(4);
    expect(d!.growth).toHaveLength(3);
  });

  it("refreshes the summary on first review and every 3 new ones", () => {
    expect(shouldRefreshInsight(null, 1)).toBe(true);
    expect(shouldRefreshInsight({ review_count: 4 }, 6)).toBe(false);
    expect(shouldRefreshInsight({ review_count: 4 }, 7)).toBe(true);
    expect(shouldRefreshInsight(null, 0)).toBe(false);
  });
});
