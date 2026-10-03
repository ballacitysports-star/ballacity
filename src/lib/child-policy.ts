/**
 * ballaCity child & teen policy engine.
 *
 * ONE place decides every age-dependent rule: cohorts, jurisdiction, parental
 * consent requirements, feature permissions, privacy/messaging/media floors.
 * Nothing in the UI should branch on a raw age or birthday — call this module.
 *
 * The database mirrors these rules (age_cohort_from_birthday, minor_messaging_allowed,
 * child_features_locked, enforce_minor_privacy_floor, block_locked_child_activity)
 * so a client that lies about its cohort gains nothing.
 *
 * LEGAL REVIEW REQUIRED — this module implements technical controls. It is not
 * a claim that ballaCity is "COPPA compliant" or "Georgia compliant". Thresholds,
 * consent methods and jurisdiction rules must be confirmed by qualified counsel.
 */

export const CHILD_POLICY_DISCLAIMER =
  "ballaCity implements technical child-safety and parental-consent controls. This is not a legal compliance claim; applicable requirements must be confirmed by qualified legal counsel.";

/* ------------------------------------------------------------------ */
/* Cohorts                                                             */
/* ------------------------------------------------------------------ */

export const AGE_COHORTS = [
  "child_under_13",
  "teen_13_15",
  "teen_16_17",
  "adult",
  "unknown",
] as const;
export type AgeCohort = (typeof AGE_COHORTS)[number];

export const COHORT_META: Record<AgeCohort, { label: string; short: string; description: string }> =
  {
    child_under_13: {
      label: "Child (under 13)",
      short: "Under 13",
      description:
        "Child account. A parent or guardian must approve the account before most features unlock.",
    },
    teen_13_15: {
      label: "Teen (13–15)",
      short: "13–15",
      description: "Teen account with the strongest teen privacy and safety defaults.",
    },
    teen_16_17: {
      label: "Teen (16–17)",
      short: "16–17",
      description: "Teen account with protective privacy defaults.",
    },
    adult: { label: "Adult (18+)", short: "18+", description: "Standard adult account." },
    unknown: {
      label: "Age not shared",
      short: "Unknown",
      description: "No birthday on file. Protective defaults apply until an age is known.",
    },
  };

/** Higher rank = more capability. Used for age-change protection. */
export function cohortRank(cohort: AgeCohort): number {
  switch (cohort) {
    case "adult":
      return 3;
    case "teen_16_17":
      return 2;
    case "teen_13_15":
      return 1;
    default:
      return 0;
  }
}

export function isMinorCohort(cohort: AgeCohort): boolean {
  return cohort === "child_under_13" || cohort === "teen_13_15" || cohort === "teen_16_17";
}

export function isChildCohort(cohort: AgeCohort): boolean {
  return cohort === "child_under_13";
}

export function parseCohort(value: unknown): AgeCohort {
  return (AGE_COHORTS as readonly string[]).includes(value as string)
    ? (value as AgeCohort)
    : "unknown";
}

/* ------------------------------------------------------------------ */
/* Configurable thresholds & jurisdictions                             */
/* ------------------------------------------------------------------ */

export const JURISDICTIONS = ["US_FEDERAL", "GEORGIA", "OTHER_STATE", "DEFAULT"] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

export type AgePolicyConfig = {
  /** Oldest age still treated as a child (COPPA cohort). */
  childMaxAge: number;
  /** Oldest age in the younger-teen cohort. */
  teenMidMaxAge: number;
  /** Age at which an account is an adult. */
  adultAge: number;
  /** Oldest age that requires verifiable parental consent. */
  parentalConsentMaxAge: number;
  jurisdiction: Jurisdiction;
  childAdultDmRequiresGuardianLink: boolean;
  teenAdultDmRequiresSharedContext: boolean;
  childPublicMedia: boolean;
  childSocialDiscovery: boolean;
  childAiAnalysisRequiresParent: boolean;
  childPreciseLocationEverPublic: boolean;
  ageAssuranceRequired: boolean;
  /** Biometric / facial age estimation is OFF pending a legal + product decision. */
  biometricAgeEstimationEnabled: boolean;
  /** 0 = consent does not expire. */
  consentReverificationDays: number;
  /**
   * Hours (local time of the RECIPIENT) during which minors get no push
   * notifications. `null` disables the curfew entirely.
   *
   * LEGAL REVIEW REQUIRED — the default models NY's SAFE for Kids Act window
   * (12am–6am) because it is the more protective of the windows we know about;
   * Connecticut's is 9pm–8am. Neither is asserted to be satisfied by this
   * implementation.
   */
  notificationCurfew: { startHour: number; endHour: number } | null;
};

export const DEFAULT_AGE_POLICY: AgePolicyConfig = {
  childMaxAge: 12,
  teenMidMaxAge: 15,
  adultAge: 18,
  /**
   * Conservative GLOBAL default: verifiable parental consent through age 15.
   *
   * LEGAL REVIEW REQUIRED. Federal COPPA reaches under-13, but Georgia's
   * Protecting Georgia's Children on Social Media Act (O.C.G.A. §§ 39-6-1
   * to -5) reaches under-16. There is no reliable per-request jurisdiction
   * signal yet, so the platform applies the more protective threshold to
   * everyone rather than leaving the stricter rule unwired. Once jurisdiction
   * detection exists, resolve the config through `policyForJurisdiction()`
   * per session instead of relying on this global default.
   */
  parentalConsentMaxAge: 15,
  jurisdiction: "US_FEDERAL",
  childAdultDmRequiresGuardianLink: true,
  teenAdultDmRequiresSharedContext: true,
  childPublicMedia: false,
  childSocialDiscovery: false,
  childAiAnalysisRequiresParent: true,
  childPreciseLocationEverPublic: false,
  ageAssuranceRequired: false,
  biometricAgeEstimationEnabled: false,
  consentReverificationDays: 0,
  notificationCurfew: { startHour: 0, endHour: 6 },
};

/**
 * Jurisdiction-specific threshold overrides. Values are engineering defaults
 * modeled on published statutes — LEGAL REVIEW REQUIRED before relying on any
 * of them as a compliance position.
 */
export const JURISDICTION_POLICY_OVERRIDES: Partial<
  Record<Jurisdiction, Partial<AgePolicyConfig>>
> = {
  // O.C.G.A. §§ 39-6-1 to -5 — verifiable parental consent for under-16.
  GEORGIA: { parentalConsentMaxAge: 15 },
  // Federal COPPA floor only (under-13). Kept explicit so the difference is
  // visible in the admin UI rather than implied.
  US_FEDERAL: { parentalConsentMaxAge: 12 },
};

/** The jurisdiction whose thresholds the current defaults are modeled on. */
export const MODELED_CONSENT_JURISDICTION: Jurisdiction = "GEORGIA";

const num = (v: unknown, fallback: number) => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
};
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** Parse the admin-managed `age_policy` settings row into a typed config. */
export function parseAgePolicy(value: unknown): AgePolicyConfig {
  const raw = (value ?? {}) as Record<string, unknown>;
  const d = DEFAULT_AGE_POLICY;
  const jur = raw["jurisdiction_default"];
  return {
    childMaxAge: num(raw["child_max_age"], d.childMaxAge),
    teenMidMaxAge: num(raw["teen_mid_max_age"], d.teenMidMaxAge),
    adultAge: num(raw["adult_age"], d.adultAge),
    parentalConsentMaxAge: num(raw["parental_consent_max_age"], d.parentalConsentMaxAge),
    jurisdiction: (JURISDICTIONS as readonly string[]).includes(jur as string)
      ? (jur as Jurisdiction)
      : d.jurisdiction,
    childAdultDmRequiresGuardianLink: bool(
      raw["child_adult_dm_requires_guardian_link"],
      d.childAdultDmRequiresGuardianLink,
    ),
    teenAdultDmRequiresSharedContext: bool(
      raw["teen_adult_dm_requires_shared_context"],
      d.teenAdultDmRequiresSharedContext,
    ),
    childPublicMedia: bool(raw["child_public_media"], d.childPublicMedia),
    childSocialDiscovery: bool(raw["child_social_discovery"], d.childSocialDiscovery),
    childAiAnalysisRequiresParent: bool(
      raw["child_ai_analysis_requires_parent"],
      d.childAiAnalysisRequiresParent,
    ),
    childPreciseLocationEverPublic: bool(
      raw["child_precise_location_ever_public"],
      d.childPreciseLocationEverPublic,
    ),
    ageAssuranceRequired: bool(raw["age_assurance_required"], d.ageAssuranceRequired),
    biometricAgeEstimationEnabled: bool(
      raw["biometric_age_estimation_enabled"],
      d.biometricAgeEstimationEnabled,
    ),
    consentReverificationDays: num(raw["consent_reverification_days"], d.consentReverificationDays),
    notificationCurfew: bool(raw["notification_curfew_enabled"], d.notificationCurfew !== null)
      ? {
          startHour: clampHour(
            num(raw["notification_curfew_start_hour"], d.notificationCurfew?.startHour ?? 0),
          ),
          endHour: clampHour(
            num(raw["notification_curfew_end_hour"], d.notificationCurfew?.endHour ?? 6),
          ),
        }
      : null,
  };
}

const clampHour = (h: number) => Math.min(23, Math.max(0, Math.round(h)));

/**
 * Jurisdiction overrides layered on top of the base config.
 *
 * Call this once jurisdiction is known for a session; until then the platform
 * runs on the conservative global defaults in DEFAULT_AGE_POLICY.
 */
export function policyForJurisdiction(
  config: AgePolicyConfig,
  jurisdiction: Jurisdiction | null | undefined,
): AgePolicyConfig {
  if (!jurisdiction) return config;
  const overrides = JURISDICTION_POLICY_OVERRIDES[jurisdiction] ?? {};
  // Never loosen the platform default — a jurisdiction override may only make
  // the consent threshold stricter. LEGAL REVIEW REQUIRED before changing this
  // to allow a lower per-jurisdiction threshold.
  const parentalConsentMaxAge = Math.max(
    config.parentalConsentMaxAge,
    overrides.parentalConsentMaxAge ?? 0,
  );
  return { ...config, ...overrides, parentalConsentMaxAge, jurisdiction };
}

/* ------------------------------------------------------------------ */
/* Notification curfew for minors                                      */
/* ------------------------------------------------------------------ */

/** True when `hour` (0–23, recipient local time) falls inside the curfew. */
export function hourInCurfew(hour: number, curfew: AgePolicyConfig["notificationCurfew"]): boolean {
  if (!curfew) return false;
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const { startHour, endHour } = curfew;
  if (startHour === endHour) return false;
  return startHour < endHour ? h >= startHour && h < endHour : h >= startHour || h < endHour;
}

/** The recipient's local hour for an instant, in an IANA timezone. */
export function localHourIn(date: Date, timezone: string | null | undefined): number {
  if (!timezone) return date.getUTCHours();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).format(date);
    const h = Number(parts.replace(/[^\d]/g, ""));
    return Number.isFinite(h) ? h % 24 : date.getUTCHours();
  } catch {
    return date.getUTCHours();
  }
}

export type CurfewDecision = {
  /** Send the push immediately. */
  send: boolean;
  /** When suppressed, the earliest instant the push may be delivered. */
  deliverAfter: Date | null;
  reason:
    | "not_a_minor"
    | "curfew_disabled"
    | "outside_curfew"
    | "curfew_lifted_by_guardian"
    | "in_curfew";
};

/**
 * Should a push go out now? Minors inside the curfew window are queued, not
 * dropped — the in-app notification row is always written by the caller, so
 * nothing is silently lost.
 *
 * A guardian may explicitly lift the curfew for their child (mirrors the other
 * parent-controlled features). The separate `notifications` control is an
 * independent, more restrictive layer handled by the caller.
 */
export function notificationCurfewDecision(input: {
  cohort: AgeCohort;
  curfewLifted?: boolean;
  timezone?: string | null;
  now?: Date;
  config?: AgePolicyConfig;
}): CurfewDecision {
  const config = input.config ?? DEFAULT_AGE_POLICY;
  const now = input.now ?? new Date();
  if (!isMinorCohort(input.cohort)) {
    return { send: true, deliverAfter: null, reason: "not_a_minor" };
  }
  const curfew = config.notificationCurfew;
  if (!curfew) return { send: true, deliverAfter: null, reason: "curfew_disabled" };
  const hour = localHourIn(now, input.timezone ?? null);
  if (!hourInCurfew(hour, curfew)) {
    return { send: true, deliverAfter: null, reason: "outside_curfew" };
  }
  if (input.curfewLifted) {
    return { send: true, deliverAfter: null, reason: "curfew_lifted_by_guardian" };
  }
  // Hours remaining until the window closes, in the recipient's local time.
  const hoursLeft = (curfew.endHour - hour + 24) % 24 || 24;
  const deliverAfter = new Date(now.getTime());
  deliverAfter.setUTCMinutes(0, 0, 0);
  deliverAfter.setUTCHours(deliverAfter.getUTCHours() + hoursLeft);
  return { send: false, deliverAfter, reason: "in_curfew" };
}

/**
 * THE age calculation for ballaCity. Calendar-based (never 365-day math) and
 * date-only, so a member's age never shifts with timezone or clock time.
 *
 * `dateOfBirth` accepts `YYYY-MM-DD` (canonical) or a Date. `currentDate`
 * defaults to today in the viewer's local calendar and exists so tests can
 * pin an exact day. Returns null for missing, malformed, future or
 * implausible dates — callers must treat null as "age unknown", never as 0.
 *
 * The database mirrors this in public.calculate_age(dob, now) and is the
 * authoritative source; this copy exists for UX only.
 */
export const MAX_PLAUSIBLE_AGE_YEARS = 120;

function toDateParts(
  value: string | Date | null | undefined,
): { y: number; m: number; d: number } | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    // Reject impossible calendar dates (2013-02-30, 2013-13-01, …).
    const probe = new Date(y, m - 1, d);
    if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) {
      return null;
    }
    return { y, m, d };
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return { y: parsed.getFullYear(), m: parsed.getMonth() + 1, d: parsed.getDate() };
}

export function calculateAge(
  dateOfBirth: string | Date | null | undefined,
  currentDate: string | Date = new Date(),
): number | null {
  const b = toDateParts(dateOfBirth);
  const n = toDateParts(currentDate);
  if (!b || !n) return null;
  let age = n.y - b.y;
  // The birthday has not happened yet this calendar year.
  if (n.m < b.m || (n.m === b.m && n.d < b.d)) age -= 1;
  if (age < 0) return null; // future date of birth
  if (age > MAX_PLAUSIBLE_AGE_YEARS) return null;
  return age;
}

export function ageFromBirthday(
  iso: string | null | undefined,
  currentDate: string | Date = new Date(),
): number | null {
  return calculateAge(iso, currentDate);
}

export function cohortFromAge(
  age: number | null | undefined,
  config: AgePolicyConfig = DEFAULT_AGE_POLICY,
): AgeCohort {
  if (age == null || !Number.isFinite(age)) return "unknown";
  if (age <= config.childMaxAge) return "child_under_13";
  if (age <= config.teenMidMaxAge) return "teen_13_15";
  if (age < config.adultAge) return "teen_16_17";
  return "adult";
}

export function cohortFromBirthday(
  iso: string | null | undefined,
  config: AgePolicyConfig = DEFAULT_AGE_POLICY,
): AgeCohort {
  return cohortFromAge(ageFromBirthday(iso), config);
}

export function requiresParentalConsent(
  cohort: AgeCohort,
  config: AgePolicyConfig = DEFAULT_AGE_POLICY,
): boolean {
  if (cohort === "child_under_13") return true;
  // A jurisdiction may extend consent to older teens; driven purely by config.
  if (cohort === "teen_13_15") return config.parentalConsentMaxAge >= config.teenMidMaxAge;
  if (cohort === "teen_16_17") return config.parentalConsentMaxAge >= config.adultAge - 1;
  return false;
}

/* ------------------------------------------------------------------ */
/* Consent state machine                                               */
/* ------------------------------------------------------------------ */

export const CONSENT_STATES = ["required", "pending", "approved", "revoked", "expired"] as const;
export type ConsentState = (typeof CONSENT_STATES)[number];

export const CONSENT_METHODS = [
  "unverified",
  "email_confirmation",
  "third_party_verified",
  "manual_review",
] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

export const CONSENT_METHOD_META: Record<ConsentMethod, { label: string; note: string }> = {
  unverified: {
    label: "Not verified",
    note: "No verification has been completed.",
  },
  email_confirmation: {
    label: "Guardian email confirmation",
    note: "Guardian confirmed a one-time link sent to their email. LEGAL REVIEW REQUIRED — email confirmation alone may not be a sufficient verifiable-consent method for every use of a child's information.",
  },
  third_party_verified: {
    label: "Approved verification provider",
    note: "Consent verified by a configured third-party parental-consent provider. No provider is enabled until one is selected and contracted.",
  },
  manual_review: {
    label: "ballaCity manual review",
    note: "Consent recorded by trained staff after reviewing guardian evidence.",
  },
};

/** Which methods may be used, in priority order. Configurable per deployment. */
export const ENABLED_CONSENT_METHODS: ConsentMethod[] = ["email_confirmation", "manual_review"];

export type ConsentRecordView = {
  status: ConsentState;
  method: ConsentMethod;
  parentEmail: string | null;
  requestedAt: string | null;
  approvedAt: string | null;
  revokedAt: string | null;
  reverifyAt: string | null;
};

export type ChildPolicyState =
  | "ADULT_18_PLUS"
  | "TEEN_16_17"
  | "TEEN_13_15"
  | "CHILD_UNDER_13"
  | "AGE_UNKNOWN"
  | "AGE_REVIEW_REQUIRED"
  | "PARENTAL_CONSENT_REQUIRED"
  | "PARENTAL_CONSENT_PENDING"
  | "PARENTAL_CONSENT_APPROVED"
  | "PARENTAL_CONSENT_REVOKED";

export type PolicySubject = {
  cohort: AgeCohort;
  consent?: ConsentRecordView | null;
  ageReviewRequired?: boolean;
  jurisdiction?: Jurisdiction | null;
};

/** The single conceptual state the rest of the app reacts to. */
export function policyState(
  subject: PolicySubject,
  config: AgePolicyConfig = DEFAULT_AGE_POLICY,
): ChildPolicyState {
  if (subject.ageReviewRequired) return "AGE_REVIEW_REQUIRED";
  const needsConsent = requiresParentalConsent(subject.cohort, config);
  if (needsConsent) {
    const status = subject.consent?.status ?? "required";
    if (status === "approved") return "PARENTAL_CONSENT_APPROVED";
    if (status === "pending") return "PARENTAL_CONSENT_PENDING";
    if (status === "revoked") return "PARENTAL_CONSENT_REVOKED";
    return "PARENTAL_CONSENT_REQUIRED";
  }
  switch (subject.cohort) {
    case "adult":
      return "ADULT_18_PLUS";
    case "teen_16_17":
      return "TEEN_16_17";
    case "teen_13_15":
      return "TEEN_13_15";
    case "child_under_13":
      return "CHILD_UNDER_13";
    default:
      return "AGE_UNKNOWN";
  }
}

/** True while a child account must stay inside the consent flow only. */
export function isConsentBlocked(
  subject: PolicySubject,
  config: AgePolicyConfig = DEFAULT_AGE_POLICY,
): boolean {
  const state = policyState(subject, config);
  return (
    state === "PARENTAL_CONSENT_REQUIRED" ||
    state === "PARENTAL_CONSENT_PENDING" ||
    state === "PARENTAL_CONSENT_REVOKED"
  );
}

/* ------------------------------------------------------------------ */
/* Feature permission matrix                                           */
/* ------------------------------------------------------------------ */

export const FEATURE_KEYS = [
  "account",
  "player_profile",
  "public_profile",
  "game_discovery",
  "game_participation",
  "game_hosting",
  "game_payments",
  "direct_messaging",
  "game_chat",
  "team_membership",
  "video_upload",
  "public_reels",
  "ai_analysis",
  "precise_location",
  "social_discovery",
  "follows",
  "comments",
  "targeted_advertising",
  "parent_controls",
  "night_notifications",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type PermissionLevel =
  /** Fully available. */
  | "allowed"
  /** Available with protective defaults that the member may loosen only partly. */
  | "protected"
  /** Available only while a guardian control allows it. */
  | "parent_controlled"
  /** Narrowed to a safe subset (e.g. teammates only). */
  | "restricted"
  /** Not available to this cohort. */
  | "blocked"
  /** Never available to anyone in this cohort, not configurable in-product. */
  | "never";

export const FEATURE_META: Record<FeatureKey, { label: string; group: string }> = {
  account: { label: "Account", group: "Identity" },
  player_profile: { label: "Player profile", group: "Identity" },
  public_profile: { label: "Public web profile", group: "Identity" },
  game_discovery: { label: "Game discovery", group: "Games" },
  game_participation: { label: "Game participation", group: "Games" },
  game_hosting: { label: "Hosting games", group: "Games" },
  game_payments: { label: "Game payment coordination", group: "Games" },
  direct_messaging: { label: "Direct messaging", group: "Communication" },
  game_chat: { label: "Game chat", group: "Communication" },
  team_membership: { label: "Team membership", group: "Social" },
  video_upload: { label: "Video upload", group: "Media" },
  public_reels: { label: "Public highlight reels", group: "Media" },
  ai_analysis: { label: "AI video analysis", group: "Media" },
  precise_location: { label: "Precise location sharing", group: "Privacy" },
  social_discovery: { label: "Discoverable by other members", group: "Social" },
  follows: { label: "Followers & following", group: "Social" },
  comments: { label: "Comments", group: "Social" },
  targeted_advertising: { label: "Targeted advertising", group: "Privacy" },
  parent_controls: { label: "Parent/guardian controls", group: "Identity" },
  night_notifications: { label: "Overnight notifications", group: "Communication" },
};

type MatrixCohort = Exclude<AgeCohort, "unknown">;

/**
 * Conceptual starting matrix. Values are product policy, not a statement of
 * what any specific law mandates — see CHILD_POLICY_DISCLAIMER.
 */
export const PERMISSION_MATRIX: Record<FeatureKey, Record<MatrixCohort, PermissionLevel>> = {
  account: {
    child_under_13: "parent_controlled",
    teen_13_15: "protected",
    teen_16_17: "allowed",
    adult: "allowed",
  },
  player_profile: {
    child_under_13: "restricted",
    teen_13_15: "restricted",
    teen_16_17: "protected",
    adult: "allowed",
  },
  public_profile: {
    child_under_13: "never",
    teen_13_15: "blocked",
    teen_16_17: "protected",
    adult: "allowed",
  },
  game_discovery: {
    child_under_13: "restricted",
    teen_13_15: "protected",
    teen_16_17: "allowed",
    adult: "allowed",
  },
  game_participation: {
    child_under_13: "parent_controlled",
    teen_13_15: "protected",
    teen_16_17: "allowed",
    adult: "allowed",
  },
  game_hosting: {
    child_under_13: "blocked",
    teen_13_15: "blocked",
    teen_16_17: "protected",
    adult: "allowed",
  },
  // Money changing hands is adult territory; 16-17 gets the protective defaults.
  game_payments: {
    child_under_13: "blocked",
    teen_13_15: "blocked",
    teen_16_17: "protected",
    adult: "allowed",
  },
  direct_messaging: {
    child_under_13: "restricted",
    teen_13_15: "restricted",
    teen_16_17: "protected",
    adult: "allowed",
  },
  game_chat: {
    child_under_13: "restricted",
    teen_13_15: "protected",
    teen_16_17: "protected",
    adult: "allowed",
  },
  team_membership: {
    child_under_13: "parent_controlled",
    teen_13_15: "protected",
    teen_16_17: "protected",
    adult: "allowed",
  },
  video_upload: {
    child_under_13: "parent_controlled",
    teen_13_15: "protected",
    teen_16_17: "protected",
    adult: "allowed",
  },
  public_reels: {
    child_under_13: "blocked",
    teen_13_15: "restricted",
    teen_16_17: "protected",
    adult: "allowed",
  },
  ai_analysis: {
    child_under_13: "parent_controlled",
    teen_13_15: "protected",
    teen_16_17: "protected",
    adult: "allowed",
  },
  precise_location: {
    child_under_13: "never",
    teen_13_15: "never",
    teen_16_17: "never",
    adult: "protected",
  },
  social_discovery: {
    child_under_13: "blocked",
    teen_13_15: "restricted",
    teen_16_17: "protected",
    adult: "allowed",
  },
  follows: {
    child_under_13: "restricted",
    teen_13_15: "protected",
    teen_16_17: "protected",
    adult: "allowed",
  },
  comments: {
    child_under_13: "restricted",
    teen_13_15: "protected",
    teen_16_17: "protected",
    adult: "allowed",
  },
  targeted_advertising: {
    child_under_13: "never",
    teen_13_15: "never",
    teen_16_17: "never",
    adult: "protected",
  },
  parent_controls: {
    child_under_13: "allowed",
    teen_13_15: "parent_controlled",
    teen_16_17: "parent_controlled",
    adult: "blocked",
  },
  // Overnight pushes to minors are off unless a guardian lifts the curfew.
  night_notifications: {
    child_under_13: "parent_controlled",
    teen_13_15: "parent_controlled",
    teen_16_17: "parent_controlled",
    adult: "allowed",
  },
};

export type ChildControls = {
  messaging: "off" | "guardian_only" | "teammates" | "peers";
  mediaVisibility: "private" | "guardian" | "teammates";
  socialDiscovery: boolean;
  aiAnalysis: boolean;
  locationPrecision: "city" | "region";
  gameParticipation: boolean;
  notifications: boolean;
  /**
   * Guardian has explicitly consented to lifting the overnight notification
   * curfew for this minor. Off by default — the curfew is the safe state.
   */
  notificationCurfewLifted: boolean;
  /** Guardian-authorised public player card. Off by default. */
  publicProfile: boolean;
};

export const DEFAULT_CHILD_CONTROLS: ChildControls = {
  messaging: "guardian_only",
  mediaVisibility: "private",
  socialDiscovery: false,
  aiAnalysis: false,
  locationPrecision: "city",
  gameParticipation: true,
  notifications: true,
  notificationCurfewLifted: false,
  publicProfile: false,
};

export function parseChildControls(row: unknown): ChildControls {
  const r = (row ?? {}) as Record<string, unknown>;
  const d = DEFAULT_CHILD_CONTROLS;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    (allowed as readonly string[]).includes(v as string) ? (v as T) : fallback;
  return {
    messaging: pick(r["messaging"], ["off", "guardian_only", "teammates", "peers"], d.messaging),
    mediaVisibility: pick(
      r["media_visibility"],
      ["private", "guardian", "teammates"],
      d.mediaVisibility,
    ),
    socialDiscovery: bool(r["social_discovery"], d.socialDiscovery),
    aiAnalysis: bool(r["ai_analysis"], d.aiAnalysis),
    locationPrecision: pick(r["location_precision"], ["city", "region"], d.locationPrecision),
    gameParticipation: bool(r["game_participation"], d.gameParticipation),
    notifications: bool(r["notifications"], d.notifications),
    notificationCurfewLifted: bool(r["notification_curfew_lifted"], d.notificationCurfewLifted),
    publicProfile: bool(r["public_profile"], d.publicProfile),
  };
}

export type FeatureDecision = {
  allowed: boolean;
  level: PermissionLevel;
  reason: string | null;
};

/**
 * The single question the app asks: "can this member use this feature?"
 * Consent state and guardian controls are folded in.
 */
export function can(
  feature: FeatureKey,
  subject: PolicySubject & { controls?: ChildControls | null },
  config: AgePolicyConfig = DEFAULT_AGE_POLICY,
): FeatureDecision {
  const cohort: MatrixCohort = subject.cohort === "unknown" ? "teen_13_15" : subject.cohort;
  const level = PERMISSION_MATRIX[feature][cohort];
  const state = policyState(subject, config);

  if (state === "AGE_REVIEW_REQUIRED" && feature !== "account" && feature !== "parent_controls") {
    return { allowed: false, level, reason: "Your age change is being reviewed." };
  }

  if (isConsentBlocked(subject, config) && feature !== "account" && feature !== "parent_controls") {
    return {
      allowed: false,
      level,
      reason:
        state === "PARENTAL_CONSENT_REVOKED"
          ? "A parent or guardian withdrew consent for this account."
          : "A parent or guardian must approve this account first.",
    };
  }

  if (level === "never" || level === "blocked") {
    return {
      allowed: false,
      level,
      reason: `Not available for ${COHORT_META[subject.cohort].short} accounts.`,
    };
  }

  if (level === "parent_controlled") {
    const controls = subject.controls ?? DEFAULT_CHILD_CONTROLS;
    const on =
      feature === "video_upload"
        ? controls.mediaVisibility !== "private" || true
        : feature === "ai_analysis"
          ? controls.aiAnalysis
          : feature === "game_participation"
            ? controls.gameParticipation
            : feature === "team_membership"
              ? controls.gameParticipation
              : feature === "night_notifications"
                ? controls.notifications && controls.notificationCurfewLifted
                : true;

    return {
      allowed: on,
      level,
      reason: on ? null : "A parent or guardian has turned this off.",
    };
  }

  return { allowed: true, level, reason: null };
}

/* ------------------------------------------------------------------ */
/* Messaging policy (mirrors public.minor_messaging_allowed)            */
/* ------------------------------------------------------------------ */

export type MessagingContext = {
  guardianLink?: boolean;
  sharedGameOrChat?: boolean;
};

export function messagingAllowed(
  a: { cohort: AgeCohort; controls?: ChildControls | null },
  b: { cohort: AgeCohort; controls?: ChildControls | null },
  ctx: MessagingContext = {},
  config: AgePolicyConfig = DEFAULT_AGE_POLICY,
): boolean {
  const pair = (x: AgeCohort, y: AgeCohort) =>
    (a.cohort === x && b.cohort === y) || (b.cohort === x && a.cohort === y);

  if (pair("child_under_13", "adult")) {
    if (ctx.guardianLink) return true;
    if (config.childAdultDmRequiresGuardianLink) return false;
    return !!ctx.sharedGameOrChat;
  }
  if (pair("teen_13_15", "adult")) {
    if (config.teenAdultDmRequiresSharedContext) return !!ctx.sharedGameOrChat;
    return true;
  }
  for (const side of [a, b]) {
    if (side.cohort === "child_under_13" && (side.controls?.messaging ?? "guardian_only") === "off")
      return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Privacy floors                                                      */
/* ------------------------------------------------------------------ */

export function privacyFloor(
  cohort: AgeCohort,
  prefs: { locationPrecision: string; profileVisibility: string; marketingEmails?: boolean },
): { locationPrecision: string; profileVisibility: string; marketingEmails: boolean } {
  let locationPrecision = prefs.locationPrecision;
  let profileVisibility = prefs.profileVisibility;
  let marketingEmails = prefs.marketingEmails ?? false;
  if (isMinorCohort(cohort)) {
    if (locationPrecision === "exact") locationPrecision = "city";
    if (profileVisibility === "public") profileVisibility = "members";
  }
  if (cohort === "child_under_13") {
    profileVisibility = "private";
    marketingEmails = false;
  }
  return { locationPrecision, profileVisibility, marketingEmails };
}

/** Fields never exposed publicly for a minor. */
export const MINOR_NEVER_PUBLIC_FIELDS = [
  "precise_location",
  "home_address",
  "phone",
  "email",
  "birthday",
  "graduating_class",
  "school",
] as const;

export function isPubliclyVisibleForMinor(field: string): boolean {
  return !(MINOR_NEVER_PUBLIC_FIELDS as readonly string[]).includes(field);
}

/** Child accounts must never be used for targeted advertising or ad tracking. */
export function trackingAllowed(cohort: AgeCohort): {
  analytics: boolean;
  targetedAds: boolean;
  sessionReplay: boolean;
} {
  if (isMinorCohort(cohort) || cohort === "unknown") {
    return { analytics: cohort === "teen_16_17", targetedAds: false, sessionReplay: false };
  }
  return { analytics: true, targetedAds: true, sessionReplay: true };
}

/* ------------------------------------------------------------------ */
/* Username safety for children                                        */
/* ------------------------------------------------------------------ */

const IDENTIFYING_PATTERNS: Array<{ re: RegExp; message: string }> = [
  { re: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, message: "looks like a phone number" },
  { re: /\d{10,}/, message: "looks like a phone number" },
  { re: /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, message: "looks like an email address" },
  {
    re: /\b\d{1,5}\s+(north|south|east|west|n|s|e|w)?\s*\w+\s+(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|court|ct)\b/i,
    message: "looks like a street address",
  },
  {
    re: /\b(19|20)\d{2}[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/,
    message: "looks like a date of birth",
  },
  {
    re: /\b(elementary|middle\s*school|high\s*school|academy|prep)\b/i,
    message: "names a school",
  },
];

export type UsernameCheck = {
  ok: boolean;
  level: "error" | "warning" | "ok";
  message: string | null;
};

/**
 * Child usernames must not carry identifying information. Structural matches
 * are refused; a full-name-looking handle is warned about because "firstlast"
 * is often legitimate for older members.
 */
export function checkChildUsername(
  username: string,
  opts: { cohort: AgeCohort; fullName?: string | null } = { cohort: "child_under_13" },
): UsernameCheck {
  const value = (username ?? "").trim();
  if (!value) return { ok: true, level: "ok", message: null };
  if (!isMinorCohort(opts.cohort)) return { ok: true, level: "ok", message: null };

  const normalized = value.replace(/[_.\-\s]/g, "");
  for (const p of IDENTIFYING_PATTERNS) {
    if (p.re.test(value) || p.re.test(normalized)) {
      return {
        ok: false,
        level: "error",
        message: `Pick a different username — this one ${p.message}. Usernames shouldn't include personal information.`,
      };
    }
  }
  const full = (opts.fullName ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (full.length >= 6 && normalized.toLowerCase().includes(full)) {
    return {
      ok: opts.cohort !== "child_under_13",
      level: opts.cohort === "child_under_13" ? "error" : "warning",
      message:
        "This username contains your full name. Something that doesn't identify you is safer.",
    };
  }
  if (/\b(1[0-7]|[1-9])(yo|yrs|yearold)\b/i.test(normalized)) {
    return { ok: true, level: "warning", message: "Avoid putting your age in your username." };
  }
  return { ok: true, level: "ok", message: null };
}
