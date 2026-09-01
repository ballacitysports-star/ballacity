/**
 * Age gating & minor-safety foundation.
 *
 * OpenRun is configured for members who are at least 13 years old. Youth
 * (under-13) functionality is gated behind administrator-controlled feature
 * flags that default to OFF.
 *
 * LEGAL REVIEW REQUIRED — age gating alone is NOT a claim of COPPA
 * compliance. Supporting members under 13 requires a dedicated legal/privacy
 * review and a parental-consent implementation before any flag is enabled.
 */

export const LEGAL_REVIEW_REQUIRED = "LEGAL REVIEW REQUIRED";

/** Minimum age to hold an OpenRun account while youth features are OFF. */
export const MINIMUM_AGE = 13;

/** Age at which an account is treated as an adult. */
export const ADULT_AGE = 18;

export const AGE_MINIMUM_MESSAGE = `You must be at least ${MINIMUM_AGE} years old to use OpenRun.`;

export const COPPA_DISCLAIMER =
  "OpenRun does not claim COPPA compliance. Age gating limits accounts to 13+; supporting younger members requires a separate legal and privacy review plus verifiable parental consent.";

/**
 * Coarse age bucket. This is the only age information the product needs to
 * enforce policy — a full date of birth is never required to be shared
 * publicly, and the category itself is private to the member and moderators.
 */
export type AgeCategory = "adult" | "teen" | "child" | "unknown";

export const AGE_CATEGORY_LABELS: Record<AgeCategory, string> = {
  adult: "Adult (18+)",
  teen: `Teen (${MINIMUM_AGE}–17)`,
  child: `Child (under ${MINIMUM_AGE})`,
  unknown: "Not shared",
};

export function ageFromBirthday(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const md = now.getMonth() - d.getMonth();
  if (md < 0 || (md === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export function ageCategoryFromAge(age: number | null | undefined): AgeCategory {
  if (age == null || !Number.isFinite(age)) return "unknown";
  if (age >= ADULT_AGE) return "adult";
  if (age >= MINIMUM_AGE) return "teen";
  return "child";
}

export function ageCategoryFromBirthday(iso: string | null | undefined): AgeCategory {
  return ageCategoryFromAge(ageFromBirthday(iso));
}

export function isMinorCategory(cat: AgeCategory): boolean {
  return cat === "teen" || cat === "child";
}

/**
 * Whether a birthday satisfies the age policy. Returns an error string for
 * the UI, or null when the value is acceptable. `youthEnabled` reflects the
 * administrator flag — when OFF, under-13 accounts are refused (the database
 * enforces the same rule, so the gate cannot be bypassed client-side).
 */
export function validateAgeMinimum(
  iso: string | null | undefined,
  youthEnabled = false,
): string | null {
  if (!iso) return null;
  const cat = ageCategoryFromBirthday(iso);
  if (cat === "child" && !youthEnabled) return AGE_MINIMUM_MESSAGE;
  return null;
}

/* ------------------------------------------------------------------ */
/* Youth feature flags                                                */
/* ------------------------------------------------------------------ */

export const YOUTH_FLAG_KEYS = [
  "enabled",
  "parent_guardian_accounts",
  "parental_consent",
  "parent_controlled_profile",
  "minor_messaging_restrictions",
  "minor_location_restrictions",
  "minor_media_restrictions",
  "minor_reporting",
  "parent_notifications",
] as const;

export type YouthFlagKey = (typeof YOUTH_FLAG_KEYS)[number];

export type YouthFlags = Record<YouthFlagKey, boolean>;

/** Every youth capability is OFF until an authorized administrator enables it. */
export const DEFAULT_YOUTH_FLAGS: YouthFlags = YOUTH_FLAG_KEYS.reduce((acc, k) => {
  acc[k] = false;
  return acc;
}, {} as YouthFlags);

export const YOUTH_FLAG_META: Record<YouthFlagKey, { label: string; description: string }> = {
  enabled: {
    label: "Youth features",
    description:
      "Master switch for all under-13 functionality. LEGAL REVIEW REQUIRED before enabling — parental consent must be implemented first.",
  },
  parent_guardian_accounts: {
    label: "Parent/guardian accounts",
    description: "Allow an adult to hold a linked guardian account for a minor.",
  },
  parental_consent: {
    label: "Parental consent",
    description: "Require verifiable guardian consent before a minor account becomes active.",
  },
  parent_controlled_profile: {
    label: "Parent-controlled profile",
    description: "Guardian approves profile details, photos and visibility for the minor.",
  },
  minor_messaging_restrictions: {
    label: "Messaging restrictions",
    description:
      "Safety controls for who may message a minor. Until this is on, adult↔minor direct messages are blocked whenever youth features are enabled.",
  },
  minor_location_restrictions: {
    label: "Location restrictions",
    description: "Never expose a minor's precise location; city-level only.",
  },
  minor_media_restrictions: {
    label: "Media restrictions",
    description: "Limit publishing and sharing of a minor's photos and highlight reels.",
  },
  minor_reporting: {
    label: "Reporting",
    description: "Youth-specific reporting paths routed to moderation with priority handling.",
  },
  parent_notifications: {
    label: "Parent notifications",
    description: "Notify the linked guardian about activity, requests and reports.",
  },
};

export function parseYouthFlags(value: unknown): YouthFlags {
  const out = { ...DEFAULT_YOUTH_FLAGS };
  if (!value || typeof value !== "object") return out;
  for (const key of YOUTH_FLAG_KEYS) {
    const raw = (value as Record<string, unknown>)[key];
    out[key] = raw === true;
  }
  return out;
}

/** Youth sub-controls only take effect while the master switch is on. */
export function youthFlagActive(flags: YouthFlags, key: YouthFlagKey): boolean {
  if (key === "enabled") return flags.enabled;
  return flags.enabled && flags[key];
}

/* ------------------------------------------------------------------ */
/* Messaging + privacy policy (mirrors the database guards)           */
/* ------------------------------------------------------------------ */

/**
 * Adult↔minor direct messaging. With youth features OFF the platform is 13+
 * and messaging is unchanged. With youth features ON, adult↔minor messaging
 * requires the messaging-restriction control to be in place.
 */
export function minorMessagingAllowed(
  a: AgeCategory,
  b: AgeCategory,
  flags: YouthFlags,
): boolean {
  if (!flags.enabled) return true;
  if (flags.minor_messaging_restrictions) return true;
  const mixed =
    (isMinorCategory(a) && b === "adult") || (isMinorCategory(b) && a === "adult");
  return !mixed;
}

/** Privacy floor applied to minors: no precise location, no public web profile. */
export function minorPrivacyFloor(
  cat: AgeCategory,
  prefs: { locationPrecision: string; profileVisibility: string },
): { locationPrecision: string; profileVisibility: string } {
  if (!isMinorCategory(cat)) return prefs;
  return {
    locationPrecision: prefs.locationPrecision === "exact" ? "city" : prefs.locationPrecision,
    profileVisibility: prefs.profileVisibility === "public" ? "members" : prefs.profileVisibility,
  };
}

/** Fields never shown publicly for a minor's profile. */
export const MINOR_HIDDEN_PUBLIC_FIELDS = [
  "precise_location",
  "contact_info",
  "birthday",
  "graduating_class",
] as const;

export function isFieldPubliclyVisibleForMinor(field: string): boolean {
  return !(MINOR_HIDDEN_PUBLIC_FIELDS as readonly string[]).includes(field);
}
