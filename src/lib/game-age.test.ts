import { describe, expect, it } from "vitest";
import { ageGateMessage, ageGateState, isAgeEligible } from "./game-age";

describe("strict game age gate", () => {
  const adultsOnly = { minAge: 18, maxAge: null };

  it("has no gate when the game sets no age limit", () => {
    expect(ageGateState({ req: { minAge: null, maxAge: null }, viewerAge: 9 })).toBe("none");
    expect(ageGateState({ req: null, viewerAge: null })).toBe("none");
  });

  it("marks a viewer outside the range as ineligible, never as 'needs approval'", () => {
    expect(ageGateState({ req: adultsOnly, viewerAge: 17 })).toBe("ineligible");
    expect(ageGateState({ req: { minAge: 21, maxAge: 40 }, viewerAge: 45 })).toBe("ineligible");
    expect(ageGateState({ req: { minAge: 8, maxAge: 12 }, viewerAge: 14 })).toBe("ineligible");
  });

  it("treats an unknown age as blocked, not eligible", () => {
    expect(ageGateState({ req: adultsOnly, viewerAge: null })).toBe("unknown_age");
    expect(ageGateState({ req: adultsOnly, viewerAge: Number.NaN })).toBe("unknown_age");
  });

  it("lets viewers inside the range through", () => {
    expect(ageGateState({ req: adultsOnly, viewerAge: 18 })).toBe("eligible");
    expect(isAgeEligible(30, { minAge: 21, maxAge: 40 })).toBe(true);
  });

  it("never offers a host-approval path in the player message", () => {
    for (const state of ["ineligible", "unknown_age"] as const) {
      const msg = ageGateMessage(state, adultsOnly) ?? "";
      expect(msg).toContain("18+");
      expect(msg.toLowerCase()).not.toContain("request the host");
      expect(msg.toLowerCase()).not.toContain("host reviews");
    }
    expect(ageGateMessage("eligible", adultsOnly)).toBeNull();
    expect(ageGateMessage("none", null)).toBeNull();
  });
});
