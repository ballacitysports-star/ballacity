import { describe, expect, it } from "vitest";
import { poseSampleCount, poseSampleTimes } from "@/lib/pose-capture";

describe("poseSampleTimes", () => {
  it("spreads samples evenly inside the clip", () => {
    const t = poseSampleTimes(10, 4);
    expect(t).toEqual([1.25, 3.75, 6.25, 8.75]);
  });
  it("stays within the clip and increases", () => {
    const t = poseSampleTimes(3, 32);
    expect(t).toHaveLength(32);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
    expect(t[t.length - 1]).toBeLessThanOrEqual(2.95);
    expect(t[0]).toBeGreaterThan(0);
  });
  it("returns nothing for unknown duration", () => {
    expect(poseSampleTimes(0, 24)).toEqual([]);
    expect(poseSampleTimes(NaN, 24)).toEqual([]);
    expect(poseSampleTimes(10, 0)).toEqual([]);
  });
});

describe("poseSampleCount", () => {
  it("uses 24 for short and 32 for longer clips, capped by maxFrames", () => {
    expect(poseSampleCount(10)).toBe(24);
    expect(poseSampleCount(60)).toBe(32);
    expect(poseSampleCount(60, 16)).toBe(16);
    expect(poseSampleCount(60, 0)).toBe(1);
  });
});
