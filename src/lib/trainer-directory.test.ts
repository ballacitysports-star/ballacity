import { describe, expect, it } from "vitest";
import {
  TRAINER_RATE_OPTIONS,
  compareByRateAsc,
  compareByRatingDesc,
  matchesMaxRate,
  parseMaxRate,
  withReviewStats,
} from "@/lib/trainer-directory";

describe("max rate filter", () => {
  it("offers Any plus four caps", () => {
    expect(TRAINER_RATE_OPTIONS.map((o) => o.value)).toEqual(["0", "50", "75", "100", "150"]);
  });

  it("parses the URL value defensively", () => {
    expect(parseMaxRate("75")).toBe(75);
    expect(parseMaxRate(100)).toBe(100);
    expect(parseMaxRate("0")).toBe(0);
    expect(parseMaxRate("-5")).toBe(0);
    expect(parseMaxRate("abc")).toBe(0);
    expect(parseMaxRate(undefined)).toBe(0);
  });

  it("matches at or under the cap, and drops trainers with no listed rate", () => {
    expect(matchesMaxRate(75, 75)).toBe(true);
    expect(matchesMaxRate(60, 75)).toBe(true);
    expect(matchesMaxRate(76, 75)).toBe(false);
    expect(matchesMaxRate(undefined, 75)).toBe(false);
    expect(matchesMaxRate(0, 75)).toBe(false);
    expect(matchesMaxRate(undefined, 0)).toBe(true); // no cap: everyone
  });
});

describe("sorting", () => {
  it("lowest rate first, unlisted last", () => {
    const list = [
      { n: "none" },
      { n: "hi", ratePerHour: 120 },
      { n: "lo", ratePerHour: 40 },
      { n: "mid", ratePerHour: 75 },
    ];
    expect([...list].sort(compareByRateAsc).map((t) => t.n)).toEqual(["lo", "mid", "hi", "none"]);
  });

  it("best rating first, review count breaks ties, unrated last", () => {
    const list = [
      { n: "unrated" },
      { n: "a", rating: 4.5, reviews: 3 },
      { n: "b", rating: 4.9, reviews: 2 },
      { n: "c", rating: 4.5, reviews: 30 },
    ];
    expect([...list].sort(compareByRatingDesc).map((t) => t.n)).toEqual(["b", "c", "a", "unrated"]);
  });
});

describe("withReviewStats", () => {
  it("overlays real stats, rounded to one decimal", () => {
    expect(withReviewStats({ name: "t" }, { avg: 4.66, count: 12 })).toEqual({
      name: "t",
      rating: 4.7,
      reviews: 12,
    });
  });

  it("leaves a trainer unchanged when there are no reviews", () => {
    const t = { name: "t", rating: 4.9, reviews: 86 };
    expect(withReviewStats(t, undefined)).toBe(t);
    expect(withReviewStats(t, { avg: 0, count: 0 })).toBe(t);
  });
});
