import { describe, expect, it } from "vitest";
import { ENGINE, recencyWeight, reviewWeights, weightedStats } from "@/lib/reputation-engine";
import {
  REPUTATION_LEVELS,
  computeReputation,
  levelFor,
  trustLabel,
  type Review,
} from "@/lib/reviews";

const NOW = Date.parse("2026-10-12T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const r = (rating: number, who: string, d = 1, verified = true) => ({
  rating,
  reviewerKey: who,
  date: daysAgo(d),
  verified,
});

describe("reputation engine", () => {
  it("counts recent reviews fully, then halves weight per half-life, with a floor", () => {
    expect(recencyWeight(daysAgo(0), NOW)).toBe(1);
    expect(recencyWeight(daysAgo(ENGINE.recencyGraceDays), NOW)).toBe(1);
    expect(recencyWeight(daysAgo(ENGINE.recencyGraceDays + ENGINE.halfLifeDays), NOW)).toBeCloseTo(
      0.5,
    );
    expect(recencyWeight(daysAgo(5000), NOW)).toBe(ENGINE.recencyFloor);
  });

  it("discounts unverified reviews", () => {
    const [v, u] = reviewWeights([r(5, "a", 1, true), r(5, "b", 1, false)], NOW);
    expect(u / v).toBeCloseTo(ENGINE.unverifiedWeight);
  });

  it("halves the weight of a review whose stars contradict its text", () => {
    const [ok, bad] = reviewWeights([r(5, "a"), { ...r(5, "b"), mismatch: true }], NOW);
    expect(bad / ok).toBeCloseTo(ENGINE.mismatchWeight);
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

describe("trust score and levels", () => {
  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  let seq = 0;
  const review = (rating: number, daysAgo = 0): Review => {
    seq += 1;
    return {
      id: `t${seq}`,
      kind: "player",
      revieweeKind: "player",
      revieweeId: "x",
      revieweeName: "X",
      reviewerName: `R${seq}`,
      reviewerHandle: "",
      reviewerAvatar: "RR",
      reviewerId: `r${seq}`,
      rating,
      body: "played a fair game",
      date: at(daysAgo),
      verified: true,
    };
  };
  const many = (n: number, rating: number, daysAgo = 0) =>
    Array.from({ length: n }, () => review(rating, daysAgo));
  const rep = (list: Review[]) => computeReputation(list, "player");

  it("shows no score before the first review", () => {
    const r = rep([]);
    expect(r.trustScore).toBe(0);
    expect(trustLabel(r)).toBe("New");
    expect(r.level.name).toBe("Rookie");
  });

  it("never lets one review, good or bad, lift someone past Rookie", () => {
    const bad = rep([review(1)]);
    const good = rep([review(5)]);
    expect(bad.level.name).toBe("Rookie");
    expect(good.level.name).toBe("Rookie");
    expect(bad.trustScore).toBeLessThan(good.trustScore);
    expect(trustLabel(good)).toBe(String(good.trustScore));
  });

  it("lowers the score when a poor review arrives, at any history size", () => {
    for (const n of [1, 3, 10, 30]) {
      const base = many(n, 5);
      for (const poor of [1, 2]) {
        expect(rep([...base, review(poor)]).trustScore).toBeLessThan(rep(base).trustScore);
      }
    }
  });

  it("raises the score as consistent good reviews accumulate", () => {
    const scores = [1, 3, 10, 30].map((n) => rep(many(n, 5)).trustScore);
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
    expect(new Set(scores).size).toBe(scores.length);
  });

  it("gates each level on evidence as well as score", () => {
    // Reviews from this week: recency makes each worth a hair under 1.
    expect(rep(many(3, 5, 4)).level.name).toBe("Rising");
    expect(rep(many(5, 5, 4)).level.name).toBe("Pro");
    expect(rep(many(10, 5, 4)).level.name).toBe("Pro"); // high score, too little evidence for Elite
    expect(rep(many(15, 5, 4)).level.name).toBe("Elite");
    expect(rep(many(39, 5, 4)).level.name).toBe("Elite"); // Legend needs 40
    expect(rep(many(40, 5, 4)).level.name).toBe("Legend");
  });

  it("does not round a thin record up a level", () => {
    // Three reviews from ~5 months ago are worth about 2.4 today: not yet Rising.
    expect(rep(many(3, 5, 150)).level.name).toBe("Rookie");
  });

  it("counts old reviews as less evidence", () => {
    // 40 glowing reviews from a year ago are not 40 reviews' worth of evidence today.
    expect(rep(many(40, 5, 365)).level.name).not.toBe("Legend");
  });

  it("gives no free points: the score is exactly the cautious estimate", () => {
    const list = [review(5), review(4), review(5), review(3)];
    const stats = weightedStats(list.map((r) => ({ ...r, reviewerKey: r.reviewerId! })));
    expect(rep(list).trustScore).toBe(stats.cautiousScore);
    expect(stats.lowerBound).toBeLessThan(stats.adjustedAvg);
  });

  it("requires both bars in levelFor", () => {
    expect(levelFor(95, 2).name).toBe("Rookie");
    expect(levelFor(60, 100).name).toBe("Rising");
    expect(levelFor(0, 0)).toBe(REPUTATION_LEVELS[0]);
  });
});
