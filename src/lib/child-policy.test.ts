import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGE_POLICY,
  PERMISSION_MATRIX,
  can,
  checkChildUsername,
  cohortFromAge,
  cohortFromBirthday,
  cohortRank,
  isConsentBlocked,
  isMinorCohort,
  messagingAllowed,
  parseAgePolicy,
  parseChildControls,
  parseCohort,
  policyState,
  privacyFloor,
  requiresParentalConsent,
  trackingAllowed,
  type AgeCohort,
  type ConsentRecordView,
} from "@/lib/child-policy";

function birthdayForAge(age: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const consent = (status: ConsentRecordView["status"]): ConsentRecordView => ({
  status,
  method: status === "approved" ? "email_confirmation" : "unverified",
  parentEmail: "guardian@example.com",
  requestedAt: null,
  approvedAt: null,
  revokedAt: null,
  reverifyAt: null,
});

describe("cohorts", () => {
  it("buckets every age group", () => {
    expect(cohortFromAge(8)).toBe("child_under_13");
    expect(cohortFromAge(12)).toBe("child_under_13");
    expect(cohortFromAge(13)).toBe("teen_13_15");
    expect(cohortFromAge(15)).toBe("teen_13_15");
    expect(cohortFromAge(16)).toBe("teen_16_17");
    expect(cohortFromAge(17)).toBe("teen_16_17");
    expect(cohortFromAge(18)).toBe("adult");
    expect(cohortFromAge(null)).toBe("unknown");
  });

  it("derives cohorts from birthdays", () => {
    expect(cohortFromBirthday(birthdayForAge(9))).toBe("child_under_13");
    expect(cohortFromBirthday(birthdayForAge(14))).toBe("teen_13_15");
    expect(cohortFromBirthday(birthdayForAge(17))).toBe("teen_16_17");
    expect(cohortFromBirthday(birthdayForAge(40))).toBe("adult");
    expect(cohortFromBirthday("")).toBe("unknown");
  });

  it("honours configurable thresholds instead of hard-coded ages", () => {
    const config = { ...DEFAULT_AGE_POLICY, childMaxAge: 13, teenMidMaxAge: 15, adultAge: 16 };
    expect(cohortFromAge(13, config)).toBe("child_under_13");
    expect(cohortFromAge(15, config)).toBe("teen_13_15");
    expect(cohortFromAge(16, config)).toBe("adult");
  });

  it("ranks cohorts so privilege increases can be detected", () => {
    expect(cohortRank("child_under_13")).toBeLessThan(cohortRank("teen_13_15"));
    expect(cohortRank("teen_16_17")).toBeLessThan(cohortRank("adult"));
    expect(cohortRank("unknown")).toBe(0);
  });

  it("treats every under-18 cohort as a minor", () => {
    expect(isMinorCohort("child_under_13")).toBe(true);
    expect(isMinorCohort("teen_13_15")).toBe(true);
    expect(isMinorCohort("teen_16_17")).toBe(true);
    expect(isMinorCohort("adult")).toBe(false);
    expect(parseCohort("nonsense")).toBe("unknown");
  });
});

describe("age policy config", () => {
  it("parses the settings row and falls back safely", () => {
    const parsed = parseAgePolicy({
      child_max_age: 13,
      adult_age: 18,
      jurisdiction_default: "GEORGIA",
      child_public_media: true,
    });
    expect(parsed.childMaxAge).toBe(13);
    expect(parsed.jurisdiction).toBe("GEORGIA");
    expect(parsed.childPublicMedia).toBe(true);
    expect(parseAgePolicy(null)).toEqual(DEFAULT_AGE_POLICY);
    expect(parseAgePolicy({ jurisdiction_default: "MARS" }).jurisdiction).toBe("US_FEDERAL");
  });

  it("keeps biometric age estimation off by default", () => {
    expect(DEFAULT_AGE_POLICY.biometricAgeEstimationEnabled).toBe(false);
    expect(DEFAULT_AGE_POLICY.ageAssuranceRequired).toBe(false);
  });

  it("derives consent requirements from config, not hard-coded ages", () => {
    expect(requiresParentalConsent("child_under_13")).toBe(true);
    // Conservative global default = Georgia-style (consent under 16).
    expect(requiresParentalConsent("teen_13_15")).toBe(true);
    const federalOnly = { ...DEFAULT_AGE_POLICY, parentalConsentMaxAge: 12 };
    expect(requiresParentalConsent("teen_13_15", federalOnly)).toBe(false);
    const georgiaStyle = { ...DEFAULT_AGE_POLICY, parentalConsentMaxAge: 15 };
    expect(requiresParentalConsent("teen_13_15", georgiaStyle)).toBe(true);
    expect(requiresParentalConsent("teen_16_17", georgiaStyle)).toBe(false);
    const under16 = { ...DEFAULT_AGE_POLICY, parentalConsentMaxAge: 17 };
    expect(requiresParentalConsent("teen_16_17", under16)).toBe(true);
    expect(requiresParentalConsent("adult", under16)).toBe(false);
  });
});

describe("policy state machine", () => {
  it("routes children through the consent states", () => {
    expect(policyState({ cohort: "child_under_13" })).toBe("PARENTAL_CONSENT_REQUIRED");
    expect(policyState({ cohort: "child_under_13", consent: consent("pending") })).toBe(
      "PARENTAL_CONSENT_PENDING",
    );
    expect(policyState({ cohort: "child_under_13", consent: consent("approved") })).toBe(
      "PARENTAL_CONSENT_APPROVED",
    );
    expect(policyState({ cohort: "child_under_13", consent: consent("revoked") })).toBe(
      "PARENTAL_CONSENT_REVOKED",
    );
  });

  it("locks a 14-year-old pending guardian approval under the default policy", () => {
    expect(policyState({ cohort: "teen_13_15" })).toBe("PARENTAL_CONSENT_REQUIRED");
    expect(policyState({ cohort: "teen_13_15", consent: consent("pending") })).toBe(
      "PARENTAL_CONSENT_PENDING",
    );
    expect(policyState({ cohort: "teen_13_15", consent: consent("approved") })).toBe(
      "PARENTAL_CONSENT_APPROVED",
    );
  });

  it("classifies teens and adults without consent states", () => {
    const federalOnly = { ...DEFAULT_AGE_POLICY, parentalConsentMaxAge: 12 };
    expect(policyState({ cohort: "teen_13_15" }, federalOnly)).toBe("TEEN_13_15");
    expect(policyState({ cohort: "teen_16_17" })).toBe("TEEN_16_17");
    expect(policyState({ cohort: "adult" })).toBe("ADULT_18_PLUS");
    expect(policyState({ cohort: "unknown" })).toBe("AGE_UNKNOWN");
  });

  it("prioritises an age review over everything else", () => {
    expect(policyState({ cohort: "adult", ageReviewRequired: true })).toBe("AGE_REVIEW_REQUIRED");
  });

  it("blocks the app only while consent is missing, pending or revoked", () => {
    expect(isConsentBlocked({ cohort: "child_under_13" })).toBe(true);
    expect(isConsentBlocked({ cohort: "child_under_13", consent: consent("pending") })).toBe(true);
    expect(isConsentBlocked({ cohort: "child_under_13", consent: consent("revoked") })).toBe(true);
    expect(isConsentBlocked({ cohort: "child_under_13", consent: consent("approved") })).toBe(false);
    expect(isConsentBlocked({ cohort: "adult" })).toBe(false);
  });
});

describe("feature permission matrix", () => {
  it("never allows precise location or targeted ads for any minor", () => {
    for (const cohort of ["child_under_13", "teen_13_15", "teen_16_17"] as const) {
      expect(PERMISSION_MATRIX.precise_location[cohort]).toBe("never");
      expect(PERMISSION_MATRIX.targeted_advertising[cohort]).toBe("never");
      expect(can("precise_location", { cohort, consent: consent("approved") }).allowed).toBe(false);
      expect(can("targeted_advertising", { cohort, consent: consent("approved") }).allowed).toBe(
        false,
      );
    }
  });

  it("keeps adults on the standard experience", () => {
    for (const feature of ["direct_messaging", "public_reels", "game_hosting", "ai_analysis"] as const) {
      expect(can(feature, { cohort: "adult" }).allowed).toBe(true);
    }
  });

  it("locks a pre-consent child out of everything but the consent flow", () => {
    const subject = { cohort: "child_under_13" as AgeCohort };
    expect(can("account", subject).allowed).toBe(true);
    expect(can("parent_controls", subject).allowed).toBe(true);
    for (const feature of [
      "direct_messaging",
      "video_upload",
      "game_participation",
      "game_discovery",
      "follows",
    ] as const) {
      const d = can(feature, subject);
      expect(d.allowed).toBe(false);
      expect(d.reason).toMatch(/parent or guardian/i);
    }
  });

  it("respects guardian controls after consent is approved", () => {
    const base = { cohort: "child_under_13" as AgeCohort, consent: consent("approved") };
    const controls = parseChildControls({ ai_analysis: false, game_participation: false });
    expect(can("ai_analysis", { ...base, controls }).allowed).toBe(false);
    expect(can("game_participation", { ...base, controls }).allowed).toBe(false);
    const on = parseChildControls({ ai_analysis: true, game_participation: true });
    expect(can("ai_analysis", { ...base, controls: on }).allowed).toBe(true);
    expect(can("game_participation", { ...base, controls: on }).allowed).toBe(true);
  });

  it("never lets a child host a game or hold a public profile", () => {
    const base = { cohort: "child_under_13" as AgeCohort, consent: consent("approved") };
    expect(can("game_hosting", base).allowed).toBe(false);
    expect(can("public_profile", base).allowed).toBe(false);
    expect(can("public_reels", base).allowed).toBe(false);
  });

  it("blocks everything while an age change is under review", () => {
    const subject = { cohort: "adult" as AgeCohort, ageReviewRequired: true };
    expect(can("direct_messaging", subject).allowed).toBe(false);
    expect(can("account", subject).allowed).toBe(true);
  });

  it("treats an unknown age protectively", () => {
    expect(can("public_profile", { cohort: "unknown" }).allowed).toBe(false);
    expect(can("precise_location", { cohort: "unknown" }).allowed).toBe(false);
  });
});

describe("messaging policy", () => {
  const child = { cohort: "child_under_13" as AgeCohort };
  const teen = { cohort: "teen_13_15" as AgeCohort };
  const older = { cohort: "teen_16_17" as AgeCohort };
  const adult = { cohort: "adult" as AgeCohort };

  it("blocks unknown adults from messaging an under-13 member", () => {
    expect(messagingAllowed(adult, child)).toBe(false);
    expect(messagingAllowed(child, adult, { sharedGameOrChat: true })).toBe(false);
  });

  it("allows a verified guardian to message their child", () => {
    expect(messagingAllowed(adult, child, { guardianLink: true })).toBe(true);
  });

  it("allows a shared-context adult only when policy permits it", () => {
    const relaxed = { ...DEFAULT_AGE_POLICY, childAdultDmRequiresGuardianLink: false };
    expect(messagingAllowed(adult, child, { sharedGameOrChat: true }, relaxed)).toBe(true);
    expect(messagingAllowed(adult, child, { sharedGameOrChat: false }, relaxed)).toBe(false);
  });

  it("requires shared context for adult to 13-15 messages", () => {
    expect(messagingAllowed(adult, teen)).toBe(false);
    expect(messagingAllowed(adult, teen, { sharedGameOrChat: true })).toBe(true);
  });

  it("leaves 16-17 and adult messaging intact", () => {
    expect(messagingAllowed(adult, older)).toBe(true);
    expect(messagingAllowed(adult, adult)).toBe(true);
  });

  it("allows peer messaging but honours a guardian messaging switch", () => {
    expect(messagingAllowed(child, teen)).toBe(true);
    const off = { cohort: "child_under_13" as AgeCohort, controls: parseChildControls({ messaging: "off" }) };
    expect(messagingAllowed(off, teen)).toBe(false);
  });
});

describe("privacy floors and tracking", () => {
  it("forces generalized location and non-public profiles for minors", () => {
    expect(privacyFloor("teen_16_17", { locationPrecision: "exact", profileVisibility: "public" }))
      .toMatchObject({ locationPrecision: "city", profileVisibility: "members" });
    expect(
      privacyFloor("child_under_13", { locationPrecision: "exact", profileVisibility: "public" }),
    ).toMatchObject({ profileVisibility: "private", marketingEmails: false });
    expect(privacyFloor("adult", { locationPrecision: "exact", profileVisibility: "public" }))
      .toMatchObject({ locationPrecision: "exact", profileVisibility: "public" });
  });

  it("never enables targeted advertising or session replay for minors", () => {
    for (const cohort of ["child_under_13", "teen_13_15", "teen_16_17", "unknown"] as const) {
      const t = trackingAllowed(cohort);
      expect(t.targetedAds).toBe(false);
      expect(t.sessionReplay).toBe(false);
    }
    expect(trackingAllowed("child_under_13").analytics).toBe(false);
    expect(trackingAllowed("adult").targetedAds).toBe(true);
  });
});

describe("child username safety", () => {
  it("refuses identifying usernames", () => {
    for (const bad of [
      "call5551234567",
      "kid@example.com",
      "123 Maple Street",
      "born 2015-04-02",
      "northside high school",
    ]) {
      expect(checkChildUsername(bad, { cohort: "child_under_13" }).ok).toBe(false);
    }
  });

  it("refuses a child's full name and warns older teens", () => {
    expect(checkChildUsername("jordanmiller", { cohort: "child_under_13", fullName: "Jordan Miller" }).ok).toBe(
      false,
    );
    const teen = checkChildUsername("jordanmiller", {
      cohort: "teen_16_17",
      fullName: "Jordan Miller",
    });
    expect(teen.ok).toBe(true);
    expect(teen.level).toBe("warning");
  });

  it("accepts a safe handle and never blocks adults", () => {
    expect(checkChildUsername("hoopsdragon22", { cohort: "child_under_13" }).ok).toBe(true);
    expect(checkChildUsername("kid@example.com", { cohort: "adult" }).ok).toBe(true);
  });
});

describe("guardian controls parsing", () => {
  it("defaults to the most protective settings", () => {
    const d = parseChildControls(null);
    expect(d).toMatchObject({
      messaging: "guardian_only",
      mediaVisibility: "private",
      socialDiscovery: false,
      aiAnalysis: false,
      locationPrecision: "city",
    });
  });

  it("ignores invalid values", () => {
    expect(parseChildControls({ messaging: "everyone", location_precision: "exact" })).toMatchObject({
      messaging: "guardian_only",
      locationPrecision: "city",
    });
  });
});
