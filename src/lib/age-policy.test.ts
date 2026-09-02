import { describe, expect, it } from "vitest";
import {
  ADULT_AGE,
  CONSENT_REQUIRED_MESSAGE,
  MINIMUM_ACCOUNT_AGE,
  PARENTAL_CONSENT_MAX_AGE,
  ageCategoryFromAge,
  ageCategoryFromBirthday,
  birthdayConsentNotice,
  birthdayRequiresParentalConsent,
  categoryFromCohort,
  cohortFromCategory,
  isFieldPubliclyVisibleForMinor,
  isMinorCategory,
  minorMessagingAllowed,
  minorPrivacyFloor,
  validateAgeMinimum,
} from "@/lib/age-policy";

function birthdayForAge(age: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("age categories", () => {
  it("buckets ages into adult / teen / child / unknown", () => {
    expect(ageCategoryFromAge(30)).toBe("adult");
    expect(ageCategoryFromAge(ADULT_AGE)).toBe("adult");
    expect(ageCategoryFromAge(ADULT_AGE - 1)).toBe("teen");
    expect(ageCategoryFromAge(PARENTAL_CONSENT_MAX_AGE + 1)).toBe("teen");
    expect(ageCategoryFromAge(PARENTAL_CONSENT_MAX_AGE)).toBe("child");
    expect(ageCategoryFromAge(null)).toBe("unknown");
  });

  it("derives the category from a birthday", () => {
    expect(ageCategoryFromBirthday(birthdayForAge(25))).toBe("adult");
    expect(ageCategoryFromBirthday(birthdayForAge(15))).toBe("teen");
    expect(ageCategoryFromBirthday(birthdayForAge(9))).toBe("child");
    expect(ageCategoryFromBirthday("")).toBe("unknown");
  });

  it("round-trips between coarse categories and cohorts", () => {
    expect(categoryFromCohort("child_under_13")).toBe("child");
    expect(categoryFromCohort("teen_13_15")).toBe("teen");
    expect(categoryFromCohort("teen_16_17")).toBe("teen");
    expect(categoryFromCohort("adult")).toBe("adult");
    expect(cohortFromCategory("child")).toBe("child_under_13");
    expect(cohortFromCategory("adult")).toBe("adult");
  });

  it("treats children and teens as minors", () => {
    expect(isMinorCategory("child")).toBe(true);
    expect(isMinorCategory("teen")).toBe(true);
    expect(isMinorCategory("adult")).toBe(false);
    expect(isMinorCategory("unknown")).toBe(false);
  });
});

describe("birthday validation", () => {
  it("has no minimum account age — under-13 birthdays are accepted", () => {
    expect(MINIMUM_ACCOUNT_AGE).toBe(0);
    expect(validateAgeMinimum(birthdayForAge(8))).toBeNull();
    expect(validateAgeMinimum(birthdayForAge(12))).toBeNull();
    expect(validateAgeMinimum(birthdayForAge(30))).toBeNull();
    expect(validateAgeMinimum("")).toBeNull();
  });

  it("still rejects impossible dates", () => {
    expect(validateAgeMinimum("not-a-date")).toBeTruthy();
    expect(validateAgeMinimum(birthdayForAge(200))).toBeTruthy();
  });

  it("flags under-13 birthdays for parental consent instead of blocking", () => {
    expect(birthdayRequiresParentalConsent(birthdayForAge(10))).toBe(true);
    expect(birthdayConsentNotice(birthdayForAge(10))).toBe(CONSENT_REQUIRED_MESSAGE);
    expect(birthdayRequiresParentalConsent(birthdayForAge(14))).toBe(false);
    expect(birthdayConsentNotice(birthdayForAge(14))).toBeNull();
    expect(birthdayRequiresParentalConsent(birthdayForAge(30))).toBe(false);
    expect(birthdayRequiresParentalConsent("")).toBe(false);
  });
});

describe("minor protections", () => {
  it("blocks unknown adults from messaging children", () => {
    expect(minorMessagingAllowed("adult", "child")).toBe(false);
    expect(minorMessagingAllowed("adult", "child", { guardianLink: true })).toBe(true);
    expect(minorMessagingAllowed("child", "child")).toBe(true);
    expect(minorMessagingAllowed("adult", "adult")).toBe(true);
  });

  it("requires shared context for adult-to-teen messages", () => {
    expect(minorMessagingAllowed("adult", "teen")).toBe(false);
    expect(minorMessagingAllowed("adult", "teen", { sharedGameOrChat: true })).toBe(true);
  });

  it("floors minor privacy to city-level and non-public profiles", () => {
    const floored = minorPrivacyFloor("child", {
      locationPrecision: "exact",
      profileVisibility: "public",
    });
    expect(floored.locationPrecision).not.toBe("exact");
    expect(floored.profileVisibility).not.toBe("public");

    const adult = minorPrivacyFloor("adult", {
      locationPrecision: "exact",
      profileVisibility: "public",
    });
    expect(adult).toEqual({ locationPrecision: "exact", profileVisibility: "public" });
  });

  it("never exposes identifying fields for minors", () => {
    expect(isFieldPubliclyVisibleForMinor("birthday")).toBe(false);
    expect(isFieldPubliclyVisibleForMinor("sports")).toBe(true);
  });
});
