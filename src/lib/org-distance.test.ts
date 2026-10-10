import { describe, expect, it } from "vitest";
import { orgDistance, orgDistanceMi } from "./org-distance";

const louisville = { lat: 38.2527, lng: -85.7585 };
const etownGeo = { address: "x", placeId: "p", lat: 37.6939, lng: -85.8591 };

describe("orgDistance", () => {
  it("measures to the nearest verified venue", () => {
    const far = { address: "y", placeId: "q", lat: 40.7128, lng: -74.006 };
    const d = orgDistance({ venueGeo: [far, etownGeo], city: "" }, louisville);
    expect(d?.approx).toBe(false);
    expect(d!.mi).toBeGreaterThan(35);
    expect(d!.mi).toBeLessThan(45);
  });

  it("falls back to the city centre, flagged approximate", () => {
    const d = orgDistance({ venueGeo: [], city: "Austin, TX" }, louisville);
    expect(d?.approx).toBe(true);
    expect(d!.mi).toBeGreaterThan(700);
    expect(d!.mi).toBeLessThan(900);
  });

  it("returns null without a viewer location", () => {
    expect(orgDistance({ venueGeo: [etownGeo], city: "" }, null)).toBeNull();
  });

  it("returns null instead of inventing a number when nothing is mappable", () => {
    expect(orgDistanceMi({ venueGeo: [], city: "Nowhereville" }, louisville)).toBeNull();
    expect(orgDistanceMi({ venueGeo: undefined, city: "" }, louisville)).toBeNull();
  });

  it("ignores placeholder 0,0 coordinates", () => {
    const zero = { address: "z", placeId: "", lat: 0, lng: 0 };
    expect(orgDistanceMi({ venueGeo: [zero], city: "" }, louisville)).toBeNull();
  });
});

describe("orgDistance with geocoded cities", () => {
  it("uses geocoded city coordinates for cities outside the launch list", () => {
    const cityCoords = new Map([["brooklyn, ny", { lat: 40.6782, lng: -73.9442 }]]);
    const d = orgDistance({ venueGeo: [], city: "Brooklyn, NY" }, louisville, cityCoords);
    expect(d?.approx).toBe(true);
    expect(d!.mi).toBeGreaterThan(550);
    expect(d!.mi).toBeLessThan(700);
  });

  it("is still null when the city was never geocoded", () => {
    expect(orgDistance({ venueGeo: [], city: "Brooklyn, NY" }, louisville, new Map())).toBeNull();
  });
});
