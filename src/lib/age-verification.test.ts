import { describe, expect, it } from "vitest";
import { calculateAge, cohortFromBirthday } from "@/lib/child-policy";
import {
  checkDobParts,
  routeForSignupState,
  signupStateFor,
  type PlatformStatus,
} from "@/lib/age-verification";

const NOW = "2026-03-15";

describe("calculateAge — calendar exactness", () => {
  it("turns the right age on the birthday itself", () => {
    expect(calculateAge("2013-03-15", NOW)).toBe(13);
    expect(calculateAge("2013-03-16", NOW)).toBe(12); // one day short
    expect(calculateAge("2013-03-14", NOW)).toBe(13);
  });

  it("handles Feb 29 birthdays in non-leap years", () => {
    expect(calculateAge("2008-02-29", "2026-02-28")).toBe(17);
    expect(calculateAge("2008-02-29", "2026-03-01")).toBe(18);
  });

  it("is date-only, so time of day and timezone can't shift it", () => {
    expect(calculateAge("2013-03-15", new Date(2026, 2, 15, 0, 0, 0))).toBe(13);
    expect(calculateAge("2013-03-15", new Date(2026, 2, 15, 23, 59, 59))).toBe(13);
  });

  it("rejects missing, future, impossible and implausible dates", () => {
    expect(calculateAge(null, NOW)).toBeNull();
    expect(calculateAge("", NOW)).toBeNull();
    expect(calculateAge("2030-01-01", NOW)).toBeNull();
    expect(calculateAge("2013-02-30", NOW)).toBeNull();
    expect(calculateAge("2013-13-01", NOW)).toBeNull();
    expect(calculateAge("1850-01-01", NOW)).toBeNull();
  });
});

describe("cohort boundaries", () => {
  const cases: Array<[string, string]> = [
    ["2013-03-16", "child_under_13"], // 12
    ["2013-03-15", "teen_13_15"], // exactly 13
    ["2011-03-15", "teen_13_15"], // 15
    ["2010-03-15", "teen_16_17"], // 16
    ["2009-03-16", "teen_16_17"], // 16, day before 17th
    ["2008-03-15", "adult"], // exactly 18
  ];
  it.each(cases)("%s → %s", (dob, cohort) => {
    // cohortFromBirthday uses today's date, so compute from the fixed age instead.
    const age = calculateAge(dob, NOW);
    expect(age).not.toBeNull();
    expect(cohortFromBirthday(shiftToToday(dob, NOW))).toBe(cohort);
  });
});

/** Rebase a birth date so its age today equals its age on the fixed NOW. */
function shiftToToday(dob: string, now: string): string {
  const age = calculateAge(dob, now)!;
  const t = new Date();
  const [, , d] = dob.split("-").map(Number);
  const month = t.getMonth() + 1;
  const day = Math.min(d, 28);
  const hadBirthday = day <= t.getDate();
  const year = t.getFullYear() - age - (hadBirthday ? 0 : 1);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

describe("checkDobParts minimum age", () => {
  const now = new Date(2026, 8, 11);

  it("refuses an under-13 birthday", () => {
    const r = checkDobParts({ month: "1", day: "1", year: "2020" }, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/at least 13/);
  });

  it("accepts exactly 13", () => {
    const r = checkDobParts({ month: "9", day: "11", year: "2013" }, now);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cohort).toBe("teen_13_15");
  });

  it("still accepts adults", () => {
    const r = checkDobParts({ month: "5", day: "4", year: "1990" }, now);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cohort).toBe("adult");
  });
});

describe("checkDobParts", () => {
  it("requires all three parts", () => {
    const r = checkDobParts({ month: "3", day: "", year: "2010" });
    expect(r.ok).toBe(false);
  });
  it("requires a 4-digit year", () => {
    const r = checkDobParts({ month: "3", day: "1", year: "10" });
    expect(r).toMatchObject({ ok: false });
  });
  it("returns an ISO date and cohort for a valid entry", () => {
    const r = checkDobParts({ month: "3", day: "15", year: "2013" }, new Date(2026, 2, 15));
    expect(r).toMatchObject({ ok: true, iso: "2013-03-15", age: 13 });
  });
  it("refuses impossible and future dates", () => {
    expect(checkDobParts({ month: "2", day: "30", year: "2013" }).ok).toBe(false);
    expect(checkDobParts({ month: "1", day: "1", year: "2999" }).ok).toBe(false);
  });
});

describe("signup state machine", () => {
  const base = { authenticated: true, hasAccountType: false } as const;

  it("sends an authenticated user with no verified age to the DOB gate", () => {
    const state = signupStateFor({
      ...base,
      status: "age_verification_required",
      cohort: "unknown",
    });
    expect(state).toBe("DOB_REQUIRED");
    expect(routeForSignupState(state)).toBe("/onboarding/age");
  });

  it("treats an unknown cohort as unverified even when the status looks active", () => {
    expect(signupStateFor({ ...base, status: "active", cohort: "unknown" })).toBe("DOB_REQUIRED");
  });

  it("routes under-13 into the guardian flow, never ordinary onboarding", () => {
    const statuses: PlatformStatus[] = [
      "consent_required",
      "pending_parental_consent",
      "consent_denied",
      "consent_revoked",
      "consent_expired",
    ];
    for (const status of statuses) {
      const state = signupStateFor({ ...base, status, cohort: "child_under_13" });
      expect(routeForSignupState(state)).toBe("/onboarding/child");
    }
  });

  it("lets an approved child continue to onboarding", () => {
    expect(signupStateFor({ ...base, status: "active", cohort: "child_under_13" })).toBe(
      "CHILD_ONBOARDING",
    );
  });

  it("routes verified teens and adults to the account-type picker", () => {
    expect(
      routeForSignupState(signupStateFor({ ...base, status: "active", cohort: "adult" })),
    ).toBe("/onboarding/account-type");
    expect(
      routeForSignupState(signupStateFor({ ...base, status: "active", cohort: "teen_13_15" })),
    ).toBe("/onboarding/account-type");
  });

  it("is ACTIVE only once age and account type are both settled", () => {
    expect(
      signupStateFor({
        authenticated: true,
        status: "active",
        cohort: "adult",
        hasAccountType: true,
      }),
    ).toBe("ACTIVE");
  });

  it("signed-out users are NEW", () => {
    expect(
      signupStateFor({
        authenticated: false,
        status: "no_account",
        cohort: "unknown",
        hasAccountType: false,
      }),
    ).toBe("NEW");
  });
});
