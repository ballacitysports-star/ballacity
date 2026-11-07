import { describe, expect, it } from "vitest";
import {
  ageRequirementLabel,
  hasAgeRequirement,
  isAgeEligible,
  requesterAgeLabel,
} from "./game-age";

describe("requesterAgeLabel", () => {
  const teens = { minAge: 13, maxAge: 17 };

  it("says nothing when the game has no age requirement", () => {
    expect(requesterAgeLabel(15, null)).toBeNull();
    expect(requesterAgeLabel(15, { minAge: null, maxAge: null })).toBeNull();
    expect(hasAgeRequirement({ minAge: null, maxAge: null })).toBe(false);
  });

  it("shows the age when it is inside the range", () => {
    expect(requesterAgeLabel(15, teens)).toBe("Age 15");
    expect(isAgeEligible(15, teens)).toBe(true);
  });

  it("names the range when the age falls outside it", () => {
    expect(requesterAgeLabel(21, teens)).toBe(`Age 21 · outside ${ageRequirementLabel(teens)}`);
  });

  // The database returns no age for a minor unless the viewer is the minor, a
  // verified guardian or a moderator, and none for anyone without a birthday.
  // The host sees the same neutral label in both cases.
  it("does not claim the player withheld their age when none is returned", () => {
    expect(requesterAgeLabel(null, teens)).toBe("Age not shown");
    expect(requesterAgeLabel(undefined, teens)).toBe("Age not shown");
    expect(requesterAgeLabel(Number.NaN, teens)).toBe("Age not shown");
  });
});
