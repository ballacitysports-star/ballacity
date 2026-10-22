import { describe, it, expect } from "vitest";
import {
  kmToMi,
  miToKm,
  DISTANCE_SLIDER_STOPS,
  MAX_DISTANCE_MI,
  distanceFromSliderIndex,
  distanceSliderIndex,
} from "./distance";

describe("distance helpers", () => {
  describe("kmToMi", () => {
    it("returns 0 for null/undefined", () => {
      expect(kmToMi(null)).toBe(0);
      expect(kmToMi(undefined)).toBe(0);
    });
    it("returns 0 for 0 km", () => {
      expect(kmToMi(0)).toBe(0);
    });
    it("converts known values (rounded)", () => {
      expect(kmToMi(1.609344)).toBe(1);
      expect(kmToMi(16.09344)).toBe(10);
      expect(kmToMi(40)).toBe(25); // 24.85 → 25
      expect(kmToMi(80)).toBe(50); // 49.71 → 50
      expect(kmToMi(161)).toBe(100);
    });
    it("rounds to the nearest mile", () => {
      expect(kmToMi(1)).toBe(1); // 0.621 → 1
      expect(kmToMi(2)).toBe(1); // 1.243 → 1
      expect(kmToMi(3)).toBe(2); // 1.864 → 2
    });
  });

  describe("miToKm", () => {
    it("returns 0 for 0 mi", () => {
      expect(miToKm(0)).toBe(0);
    });
    it("converts known values (rounded)", () => {
      expect(miToKm(1)).toBe(2); // 1.609 → 2
      expect(miToKm(10)).toBe(16); // 16.09 → 16
      expect(miToKm(25)).toBe(40); // 40.23 → 40
      expect(miToKm(50)).toBe(80); // 80.47 → 80
      expect(miToKm(100)).toBe(161); // 160.93 → 161
    });
  });

  describe("round-trip stability", () => {
    it("mi → km → mi preserves the original mile value for filter chip values", () => {
      for (const mi of [5, 10, 25, 50, 100]) {
        expect(kmToMi(miToKm(mi))).toBe(mi);
      }
    });
  });
});

describe("distance slider stops", () => {
  it("round-trips every stop in miles and kilometres", () => {
    for (const unit of ["mi", "km"] as const) {
      for (let i = 0; i < DISTANCE_SLIDER_STOPS.length; i++) {
        const mi = distanceFromSliderIndex(i, unit);
        expect(mi).not.toBeNull();
        expect(distanceSliderIndex(mi, unit)).toBe(i);
      }
    }
  });

  it("puts any distance at the far end", () => {
    const last = DISTANCE_SLIDER_STOPS.length;
    expect(distanceFromSliderIndex(last, "mi")).toBeNull();
    expect(distanceSliderIndex(null, "mi")).toBe(last);
    expect(distanceSliderIndex(0, "mi")).toBe(last);
    expect(distanceSliderIndex(MAX_DISTANCE_MI, "km")).toBe(last);
  });

  it("snaps a saved in-between value to the nearest stop", () => {
    expect(DISTANCE_SLIDER_STOPS[distanceSliderIndex(12, "mi")]).toBe(10);
    expect(DISTANCE_SLIDER_STOPS[distanceSliderIndex(10, "km")]).toBe(15);
  });
});
