import { describe, expect, it } from "vitest";
import { DENSE_MAX_FRAMES, frameCountFor } from "@/lib/reel-frames";

describe("frameCountFor", () => {
  it("is unchanged for the standard capture", () => {
    expect(frameCountFor(0)).toBe(6);
    expect(frameCountFor(6)).toBe(8);
    expect(frameCountFor(15)).toBe(12);
    expect(frameCountFor(30)).toBe(16);
    expect(frameCountFor(60)).toBe(20);
    expect(frameCountFor(300)).toBe(24);
  });

  it("takes about twice the frames for Pro, capped at the analytics maximum", () => {
    expect(frameCountFor(6, true)).toBe(16);
    expect(frameCountFor(15, true)).toBe(24);
    expect(frameCountFor(40, true)).toBe(DENSE_MAX_FRAMES);
    expect(frameCountFor(600, true)).toBe(DENSE_MAX_FRAMES);
    for (const d of [0, 3, 10, 30, 90, 300]) {
      expect(frameCountFor(d, true)).toBeGreaterThanOrEqual(frameCountFor(d));
      expect(frameCountFor(d, true)).toBeLessThanOrEqual(DENSE_MAX_FRAMES);
    }
  });
});
