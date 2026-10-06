import { describe, expect, it } from "vitest";
import { matchesAgeGroup, normalizeAgeGroups, parseAgeGroup } from "./age-groups";

describe("age groups", () => {
  it("normalizes to known ids in canonical order without duplicates", () => {
    expect(normalizeAgeGroups(["adult", "youth", "adult", "senior", 3])).toEqual([
      "youth",
      "adult",
    ]);
    expect(normalizeAgeGroups(null)).toEqual([]);
  });

  it("matches everyone when no age filter is set", () => {
    expect(matchesAgeGroup([], "")).toBe(true);
    expect(matchesAgeGroup(undefined, undefined)).toBe(true);
  });

  it("matches only trainers who listed the group", () => {
    expect(matchesAgeGroup(["youth", "teen"], "teen")).toBe(true);
    expect(matchesAgeGroup(["adult"], "youth")).toBe(false);
  });

  it("does not match a trainer with no age groups listed", () => {
    expect(matchesAgeGroup([], "youth")).toBe(false);
    expect(matchesAgeGroup(null, "adult")).toBe(false);
  });

  it("parses the search param defensively", () => {
    expect(parseAgeGroup("teen")).toBe("teen");
    expect(parseAgeGroup("kids")).toBe("");
    expect(parseAgeGroup(undefined)).toBe("");
  });
});
