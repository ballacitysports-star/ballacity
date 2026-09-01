import { describe, expect, it } from "vitest";
import {
  AGE_MINIMUM_MESSAGE,
  DEFAULT_YOUTH_FLAGS,
  MINIMUM_AGE,
  ageCategoryFromAge,
  ageCategoryFromBirthday,
  isFieldPubliclyVisibleForMinor,
  isMinorCategory,
  minorMessagingAllowed,
  minorPrivacyFloor,
  parseYouthFlags,
  validateAgeMinimum,
  youthFlagActive,
  type YouthFlags,
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
    expect(ageCategoryFromAge(18)).toBe("adult");
    expect(ageCategoryFromAge(17)).toBe("teen");
    expect(ageCategoryFromAge(13)).toBe("teen");
    expect(ageCategoryFromAge(12)).toBe("child");
    expect(ageCategoryFromAge(null)).toBe("unknown");
  });

  it("derives the category from a birthday", () => {
    expect(ageCategoryFromBirthday(birthdayForAge(25))).toBe("adult");
    expect(ageCategoryFromBirthday(birthdayForAge(15))).toBe("teen");
    expect(ageCategoryFromBirthday(birthdayForAge(9))).toBe("child");
    expect(ageCategoryFromBirthday("")).toBe("unknown");
  });

  it("treats teens and children as minors", () => {
    expect(isMinorCategory("teen")).toBe(true);
    expect(isMinorCategory("child")).toBe(true);
    expect(isMinorCategory("adult")).toBe(false);
    expect(isMinorCategory("unknown")).toBe(false);
  });
});

describe("minimum age policy", () => {
  it("rejects under-13 while youth features are off", () => {
    expect(validateAgeMinimum(birthdayForAge(MINIMUM_AGE - 1))).toBe(AGE_MINIMUM_MESSAGE);
  });

  it("accepts 13+ and blank values", () => {
    expect(validateAgeMinimum(birthdayForAge(MINIMUM_AGE))).toBeNull();
    expect(validateAgeMinimum(birthdayForAge(41))).toBeNull();
    expect(validateAgeMinimum("")).toBeNull();
  });

  it("only allows under-13 when youth features are explicitly enabled", () => {
    expect(validateAgeMinimum(birthdayForAge(10), true)).toBeNull();
  });
});

describe("youth feature flags", () => {
  it("defaults every flag to off", () => {
    for (const value of Object.values(DEFAULT_YOUTH_FLAGS)) expect(value).toBe(false);
  });

  it("parses partial/invalid stored values safely", () => {
    expect(parseYouthFlags(null).enabled).toBe(false);
    expect(parseYouthFlags({ enabled: "yes" }).enabled).toBe(false);
    expect(parseYouthFlags({ enabled: true }).parental_consent).toBe(false);
    expect(parseYouthFlags({ enabled: true }).enabled).toBe(true);
  });

  it("keeps sub-controls inert until the master switch is on", () => {
    const flags: YouthFlags = { ...DEFAULT_YOUTH_FLAGS, parental_consent: true };
    expect(youthFlagActive(flags, "parental_consent")).toBe(false);
    expect(youthFlagActive({ ...flags, enabled: true }, "parental_consent")).toBe(true);
  });
});

describe("minor messaging architecture", () => {
  const off = DEFAULT_YOUTH_FLAGS;
  const on: YouthFlags = { ...DEFAULT_YOUTH_FLAGS, enabled: true };

  it("leaves 13+ messaging unchanged while youth features are off", () => {
    expect(minorMessagingAllowed("adult", "teen", off)).toBe(true);
    expect(minorMessagingAllowed("adult", "adult", off)).toBe(true);
  });

  it("blocks unrestricted adult-to-minor messaging when youth is enabled", () => {
    expect(minorMessagingAllowed("adult", "child", on)).toBe(false);
    expect(minorMessagingAllowed("teen", "adult", on)).toBe(false);
    expect(minorMessagingAllowed("teen", "teen", on)).toBe(true);
  });

  it("defers to the messaging control once it is in place", () => {
    expect(
      minorMessagingAllowed("adult", "child", { ...on, minor_messaging_restrictions: true }),
    ).toBe(true);
  });
});

describe("minor privacy floor", () => {
  it("downgrades precise location and public visibility for minors", () => {
    expect(
      minorPrivacyFloor("teen", { locationPrecision: "exact", profileVisibility: "public" }),
    ).toEqual({ locationPrecision: "city", profileVisibility: "members" });
  });

  it("leaves adults untouched", () => {
    const prefs = { locationPrecision: "exact", profileVisibility: "public" };
    expect(minorPrivacyFloor("adult", prefs)).toEqual(prefs);
  });

  it("never exposes private minor fields publicly", () => {
    expect(isFieldPubliclyVisibleForMinor("birthday")).toBe(false);
    expect(isFieldPubliclyVisibleForMinor("precise_location")).toBe(false);
    expect(isFieldPubliclyVisibleForMinor("display_name")).toBe(true);
  });
});
