/**
 * Coarse age categories — a thin compatibility layer over the authoritative
 * policy engine in `src/lib/child-policy.ts`.
 *
 * ballaCity intentionally supports members under 13. There is no blanket 13+
 * minimum: an under-13 account is a legitimate account state that stays
 * feature-locked until a parent or guardian approves it (see
 * `PERMISSION_MATRIX` and `policyState` in child-policy).
 *
 * Every rule below delegates to child-policy so age rules exist in exactly
 * one place. Do not add new age logic here — extend child-policy instead.
 *
 * LEGAL REVIEW REQUIRED — technical controls are not a compliance claim. The
 * verifiable-consent method in particular needs qualified legal sign-off.
 */

import {
  DEFAULT_AGE_POLICY,
  ageFromBirthday as cohortAgeFromBirthday,
  cohortFromAge,
  cohortFromBirthday,
  isMinorCohort,
  isPubliclyVisibleForMinor,
  messagingAllowed,
  privacyFloor,
  requiresParentalConsent,
  type AgeCohort,
  type AgePolicyConfig,
  type MessagingContext,
} from "@/lib/child-policy";

export const LEGAL_REVIEW_REQUIRED = "LEGAL REVIEW REQUIRED";

/**
 * There is no minimum account age. Under-13 members are supported through the
 * parental-consent architecture rather than refused at the door.
 */
export const MINIMUM_ACCOUNT_AGE = 0;

/** Oldest age that requires verifiable parental consent (configurable). */
export const PARENTAL_CONSENT_MAX_AGE = DEFAULT_AGE_POLICY.parentalConsentMaxAge;

/** Oldest age still in the child cohort. Distinct from the consent age. */
export const CHILD_MAX_AGE = DEFAULT_AGE_POLICY.childMaxAge;

/** Age at which an account is treated as an adult (configurable). */
export const ADULT_AGE = DEFAULT_AGE_POLICY.adultAge;

/** Implausible birthdays are still rejected, purely as data validation. */
export const MAX_PLAUSIBLE_AGE = 120;

export const CONSENT_REQUIRED_MESSAGE = `Because you're under ${PARENTAL_CONSENT_MAX_AGE + 1}, your Guardian has to approve this account before games, messages and videos turn on.`;

export const CHILD_SUPPORT_NOTE =
  "ballaCity supports members under the consent age through verifiable parental consent. Consent, privacy floors and feature permissions are enforced server-side; ballaCity does not claim COPPA compliance without legal review of the consent method.";

/**
 * Coarse age bucket. This is the only age information most of the product
 * needs; the full date of birth is private (stored in `profile_birthdays`).
 */
export type AgeCategory = "adult" | "teen" | "child" | "unknown";

export const AGE_CATEGORY_LABELS: Record<AgeCategory, string> = {
  adult: `Adult (${ADULT_AGE}+)`,
  teen: `Teen (${CHILD_MAX_AGE + 1}–${ADULT_AGE - 1})`,
  child: `Child (under ${CHILD_MAX_AGE + 1})`,
  unknown: "Not shared",
};

export function ageFromBirthday(iso: string | null | undefined): number | null {
  return cohortAgeFromBirthday(iso);
}

/** Map a fine-grained cohort onto the coarse category. */
export function categoryFromCohort(cohort: AgeCohort): AgeCategory {
  if (cohort === "adult") return "adult";
  if (cohort === "child_under_13") return "child";
  if (cohort === "unknown") return "unknown";
  return "teen";
}

/** Map a coarse category onto the most protective matching cohort. */
export function cohortFromCategory(cat: AgeCategory): AgeCohort {
  if (cat === "adult") return "adult";
  if (cat === "child") return "child_under_13";
  if (cat === "teen") return "teen_13_15";
  return "unknown";
}

export function ageCategoryFromAge(
  age: number | null | undefined,
  config: AgePolicyConfig = DEFAULT_AGE_POLICY,
): AgeCategory {
  return categoryFromCohort(cohortFromAge(age, config));
}

export function ageCategoryFromBirthday(
  iso: string | null | undefined,
  config: AgePolicyConfig = DEFAULT_AGE_POLICY,
): AgeCategory {
  return categoryFromCohort(cohortFromBirthday(iso, config));
}

export function isMinorCategory(cat: AgeCategory): boolean {
  return isMinorCohort(cohortFromCategory(cat));
}

/**
 * Birthday validation. Under-13 is VALID — it routes the member into the
 * parental-consent flow instead of being refused. Only impossible values are
 * rejected here; the database applies the same cohort rules on write.
 */
export function validateAgeMinimum(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const age = ageFromBirthday(iso);
  if (age == null) return "Enter a valid date of birth";
  if (age > MAX_PLAUSIBLE_AGE) return "Enter a valid date of birth";
  return null;
}

/**
 * Whether this birthday puts the member into a cohort that needs a parent or
 * guardian to approve the account. Drives the child-registration hand-off.
 */
export function birthdayRequiresParentalConsent(
  iso: string | null | undefined,
  config: AgePolicyConfig = DEFAULT_AGE_POLICY,
): boolean {
  if (!iso) return false;
  return requiresParentalConsent(cohortFromBirthday(iso, config), config);
}

/** UI notice shown next to the birthday field, or null when none applies. */
export function birthdayConsentNotice(
  iso: string | null | undefined,
  config: AgePolicyConfig = DEFAULT_AGE_POLICY,
): string | null {
  return birthdayRequiresParentalConsent(iso, config) ? CONSENT_REQUIRED_MESSAGE : null;
}

/* ------------------------------------------------------------------ */
/* Delegated policy helpers (mirror the database guards)              */
/* ------------------------------------------------------------------ */

/**
 * Adult↔minor direct messaging, resolved by the child-policy engine.
 * Unknown adult → child/young-teen is blocked unless a legitimate
 * relationship exists (guardian link, or shared game/chat for older teens).
 */
export function minorMessagingAllowed(
  a: AgeCategory,
  b: AgeCategory,
  ctx: MessagingContext = {},
  config: AgePolicyConfig = DEFAULT_AGE_POLICY,
): boolean {
  return messagingAllowed(
    { cohort: cohortFromCategory(a) },
    { cohort: cohortFromCategory(b) },
    ctx,
    config,
  );
}

/** Privacy floor applied to minors: no precise location, no public profile. */
export function minorPrivacyFloor(
  cat: AgeCategory,
  prefs: { locationPrecision: string; profileVisibility: string },
): { locationPrecision: string; profileVisibility: string } {
  const floored = privacyFloor(cohortFromCategory(cat), prefs as never);
  return {
    locationPrecision: floored.locationPrecision,
    profileVisibility: floored.profileVisibility,
  };
}

export function isFieldPubliclyVisibleForMinor(field: string): boolean {
  return isPubliclyVisibleForMinor(field);
}

export { MINOR_NEVER_PUBLIC_FIELDS as MINOR_HIDDEN_PUBLIC_FIELDS } from "@/lib/child-policy";
