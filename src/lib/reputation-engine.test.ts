import { describe, expect, it } from "vitest";
import { ENGINE, recencyWeight, reviewWeights, weightedStats } from "@/lib/reputation-engine";
import { computeReputation, type Review } from "@/lib/reviews";

const NOW = Date.parse("2026-10-12T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const r = (rating: number, who: string, d = 1, verified = true) => ({
  rating,
  reviewerKey: who,
  date: daysAgo(d),
  verified,
});

describe("reputation engine", () => {
  it("halves a review's weight after the half-life and floors it", () => {
    expect(recencyWeight(daysAgo(0), NOW)).toBeCloseTo(1);
    expect(recencyWeight(daysAgo(ENGINE.halfLifeDays), NOW)).toBeCloseTo(0.5);
    expect(recencyWeight(daysAgo(5000), NOW)).toBe(ENGINE.recencyFloor);
  });

  it("discounts unverified reviews", () => {
    const [v, u] = reviewWeights([r(5, "a", 1, true), r(5, "b", 1, false)], NOW);
    expect(u / v).toBeCloseTo(ENGINE.unverifiedWeight);
  });

  it("applies diminishing weight to repeat reviews from one reviewer", () => {
    const w = reviewWeights([r(5, "a", 1), r(5, "a", 2), r(5, "a", 3)], NOW);
    // newest counts fully, then 1/√2, then 1/√3 (modulo recency)
    expect(w[0]).toBeGreaterThan(w[1] * 1.3);
    expect(w[1]).toBeGreaterThan(w[2]);
  });

  it("ranks 40 solid reviews above one perfect review", () => {
    const one = weightedStats([r(5, "a")], NOW);
    const many = weightedStats(
      Array.from({ length: 40 }, (_, i) => r(4.8, `u${i}`, 10 + i)),
      NOW,
    );
    expect(many.adjustedAvg).toBeGreaterThan(one.adjustedAvg);
    expect(one.provisional).toBe(true);
    expect(many.provisional).toBe(false);
  });

  it("returns an empty, provisional result with no reviews", () => {
    const s = weightedStats([], NOW);
    expect(s.adjustedAvg).toBe(0);
    expect(s.provisional).toBe(true);
  });

  it("computeReputation exposes the adjusted values and keeps the raw mean", () => {
    const mk = (id: string, rating: number, who: string): Review => ({
      id,
      kind: "player",
      revieweeKind: "player",
      revieweeId: "x",
      revieweeName: "X",
      reviewerName: who,
      reviewerHandle: "",
      reviewerAvatar: "AA",
      reviewerId: who,
      rating,
      body: "good teammate overall",
      date: new Date().toISOString(),
      verified: true,
    });
    const rep = computeReputation([mk("1", 5, "a")], "player");
    expect(rep.avg).toBe(5);
    expect(rep.adjustedAvg).toBeLessThan(5);
    expect(rep.provisional).toBe(true);
    expect(rep.trustScore).toBeLessThan(70);
  });
});
