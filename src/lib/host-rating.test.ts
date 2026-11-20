import { describe, expect, it } from "vitest";
import { computeReputation } from "./reviews";
import { liveHostRating } from "./host-rating";

describe("liveHostRating", () => {
  it("is hidden when the host has no reviews (no snapshot ★ 5)", () => {
    expect(liveHostRating(computeReputation([], "host"))).toBeNull();
    expect(liveHostRating({ avg: 0, count: 0 })).toBeNull();
  });

  it("shows the live average to one decimal with the review count", () => {
    expect(liveHostRating({ avg: 4.666, count: 3 })).toEqual({
      stars: "4.7",
      reviews: "3 reviews",
    });
    expect(liveHostRating({ avg: 5, count: 1 })).toEqual({ stars: "5.0", reviews: "1 review" });
  });

  it("ignores a non-finite average", () => {
    expect(liveHostRating({ avg: Number.NaN, count: 2 })).toBeNull();
  });
});
