import { describe, expect, it } from "vitest";
import { SPORT_ACTIVITY_MIN, maskSmallCount } from "./sport-activity";

describe("maskSmallCount", () => {
  it("hides counts under the threshold, including zero", () => {
    for (const n of [0, 1, SPORT_ACTIVITY_MIN - 1]) {
      expect(maskSmallCount(n)).toEqual({ value: null, small: true });
    }
  });

  it("shows counts at or above the threshold", () => {
    expect(maskSmallCount(SPORT_ACTIVITY_MIN)).toEqual({ value: SPORT_ACTIVITY_MIN, small: false });
    expect(maskSmallCount(120)).toEqual({ value: 120, small: false });
  });
});
