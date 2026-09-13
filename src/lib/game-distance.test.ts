import { describe, expect, it } from "vitest";
import { gameDistanceMi, gameDistanceState, hasRealGeo } from "./game-distance";

const etown = { lat: 37.6868784, lng: -85.9011007 };
const louisville = { lat: 38.2527, lng: -85.7585 };

describe("hasRealGeo", () => {
  it("accepts real coordinates", () => {
    expect(hasRealGeo({ lat: etown.lat, lng: etown.lng, pseudoGeo: false })).toBe(true);
  });
  it("rejects missing, null-island, out-of-range and demo coordinates", () => {
    expect(hasRealGeo({ lat: null, lng: null })).toBe(false);
    expect(hasRealGeo({ lat: 0, lng: 0 })).toBe(false);
    expect(hasRealGeo({ lat: 200, lng: 10 })).toBe(false);
    expect(hasRealGeo({ lat: 62, lng: 40, pseudoGeo: true })).toBe(false);
  });
});

describe("gameDistanceMi", () => {
  it("computes real viewer→venue miles", () => {
    const mi = gameDistanceMi({ lat: etown.lat, lng: etown.lng, distanceMi: null }, louisville);
    // ~39 miles between Elizabethtown and Louisville.
    expect(mi).toBeGreaterThan(35);
    expect(mi).toBeLessThan(45);
  });

  it("returns 0-ish for the same point", () => {
    const mi = gameDistanceMi({ lat: etown.lat, lng: etown.lng, distanceMi: null }, etown);
    expect(mi).toBeLessThan(0.01);
  });

  it("ignores the stale stored distance when real geo exists", () => {
    const mi = gameDistanceMi({ lat: etown.lat, lng: etown.lng, distanceMi: 999 }, louisville);
    expect(mi).toBeLessThan(45);
  });

  it("returns null without a viewer location", () => {
    expect(gameDistanceMi({ lat: etown.lat, lng: etown.lng, distanceMi: null }, null)).toBeNull();
  });

  it("returns null when the venue was never geocoded", () => {
    expect(gameDistanceMi({ lat: null, lng: null, distanceMi: null }, louisville)).toBeNull();
  });

  it("falls back to the seeded distance for demo games", () => {
    expect(gameDistanceMi({ lat: 62, lng: 40, pseudoGeo: true, distanceMi: 1.6 }, louisville)).toBe(
      1.6,
    );
  });
});

describe("gameDistanceState", () => {
  it("flags a missing viewer location", () => {
    expect(gameDistanceState({ lat: etown.lat, lng: etown.lng, distanceMi: null }, null)).toEqual({
      mi: null,
      reason: "no-viewer-location",
    });
  });

  it("flags a missing venue location", () => {
    expect(gameDistanceState({ lat: null, lng: null, distanceMi: null }, louisville)).toEqual({
      mi: null,
      reason: "no-venue-location",
    });
  });
});
