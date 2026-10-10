import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANDING_LISTINGS,
  parseLandingListings,
  resolveLandingVisibility,
} from "./landing-listings";

describe("landing listings config", () => {
  it("shows everything when the row is missing or malformed", () => {
    expect(parseLandingListings(undefined)).toEqual(DEFAULT_LANDING_LISTINGS);
    expect(parseLandingListings("nope")).toEqual(DEFAULT_LANDING_LISTINGS);
    expect(parseLandingListings({ showTryouts: "no" })).toEqual(DEFAULT_LANDING_LISTINGS);
  });

  it("applies individual toggles", () => {
    const v = resolveLandingVisibility(parseLandingListings({ showTryouts: false }));
    expect(v).toEqual({
      pickupGames: true,
      tryouts: false,
      availability: true,
      trainerSpotlight: true,
    });
  });

  it("master switch hides everything", () => {
    const v = resolveLandingVisibility(parseLandingListings({ showLiveListings: false }));
    expect(Object.values(v).every((x) => x === false)).toBe(true);
  });
});
