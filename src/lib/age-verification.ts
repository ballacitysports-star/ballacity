/**
 * Signup age gate — client-side model.
 *
 * The database owns the truth (public.calculate_age, public.platform_status,
 * public.set_my_birthday). This module holds the state machine, labels and
 * routing decisions the UI needs, plus hooks over the server functions.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  calculateAge,
  cohortFromAge,
  type AgeCohort,
  MAX_PLAUSIBLE_AGE_YEARS,
} from "@/lib/child-policy";
import { getMyAgeStatus, submitMyBirthday, type AgeStatus } from "@/lib/age-verification.functions";

/**
 * Authoritative account status. `authenticated` and `platform-active` are
 * deliberately different things: an under-13 member can hold a session while
 * every social feature stays off until a guardian approves the account.
 */
export type PlatformStatus =
  | "no_account"
  | "age_verification_required"
  | "consent_required"
  | "pending_parental_consent"
  | "consent_denied"
  | "consent_revoked"
  | "consent_expired"
  | "suspended"
  | "active";

/** Signup state machine (see SIGNUP_FLOW below for the transitions). */
export type SignupState =
  | "NEW"
  | "DOB_REQUIRED"
  | "AGE_DETERMINED"
  | "ADULT_ONBOARDING"
  | "TEEN_ONBOARDING"
  | "CHILD_CONSENT_REQUIRED"
  | "PARENT_CONSENT_PENDING"
  | "CHILD_ONBOARDING"
  | "CHILD_ACCOUNT_RESTRICTED"
  | "ACTIVE";

export const AGE_GATE_ROUTE = "/onboarding/age";
export const CHILD_CONSENT_ROUTE = "/onboarding/child";
export const ACCOUNT_TYPE_ROUTE = "/onboarding/account-type";

/**
 * Screens that belong to the age / guardian-consent step. Both root gates (age
 * determination AND the profile-type picker) must stand down on these paths —
 * if only one does, the two guards redirect against each other forever.
 */
export const ACCOUNT_SETUP_ESCAPES = [
  AGE_GATE_ROUTE,
  CHILD_CONSENT_ROUTE,
  "/parent",
  "/safety",
  "/account/legal",
];

export function isAccountSetupEscape(pathname: string): boolean {
  return ACCOUNT_SETUP_ESCAPES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}


export function isPlatformActive(status: PlatformStatus): boolean {
  return status === "active";
}

export function needsAgeGate(status: PlatformStatus): boolean {
  return status === "age_verification_required";
}

/**
 * Map the server's status + cohort onto the signup state machine. Pure, so the
 * transition table is unit-testable without a backend.
 */
export function signupStateFor(input: {
  authenticated: boolean;
  status: PlatformStatus;
  cohort: AgeCohort;
  hasAccountType: boolean;
}): SignupState {
  if (!input.authenticated) return "NEW";
  if (input.status === "age_verification_required" || input.cohort === "unknown") {
    return "DOB_REQUIRED";
  }
  if (input.cohort === "child_under_13") {
    switch (input.status) {
      case "consent_required":
        return "CHILD_CONSENT_REQUIRED";
      case "pending_parental_consent":
        return "PARENT_CONSENT_PENDING";
      case "consent_denied":
      case "consent_revoked":
      case "consent_expired":
        return "CHILD_ACCOUNT_RESTRICTED";
      case "active":
        return input.hasAccountType ? "ACTIVE" : "CHILD_ONBOARDING";
      default:
        return "CHILD_CONSENT_REQUIRED";
    }
  }
  if (input.status !== "active") return "CHILD_ACCOUNT_RESTRICTED";
  if (!input.hasAccountType) {
    return input.cohort === "adult" ? "ADULT_ONBOARDING" : "TEEN_ONBOARDING";
  }
  return "ACTIVE";
}

/** Where a member in this state belongs. `null` = stay put. */
export function routeForSignupState(state: SignupState): string | null {
  switch (state) {
    case "DOB_REQUIRED":
      return AGE_GATE_ROUTE;
    case "CHILD_CONSENT_REQUIRED":
    case "PARENT_CONSENT_PENDING":
    case "CHILD_ACCOUNT_RESTRICTED":
      return CHILD_CONSENT_ROUTE;
    case "ADULT_ONBOARDING":
    case "TEEN_ONBOARDING":
    case "CHILD_ONBOARDING":
      return ACCOUNT_TYPE_ROUTE;
    default:
      return null;
  }
}

export const SIGNUP_FLOW: Record<SignupState, SignupState[]> = {
  NEW: ["DOB_REQUIRED"],
  DOB_REQUIRED: ["AGE_DETERMINED"],
  AGE_DETERMINED: ["ADULT_ONBOARDING", "TEEN_ONBOARDING", "CHILD_CONSENT_REQUIRED"],
  ADULT_ONBOARDING: ["ACTIVE"],
  TEEN_ONBOARDING: ["ACTIVE"],
  CHILD_CONSENT_REQUIRED: ["PARENT_CONSENT_PENDING"],
  PARENT_CONSENT_PENDING: ["CHILD_ONBOARDING", "CHILD_ACCOUNT_RESTRICTED"],
  CHILD_ONBOARDING: ["ACTIVE"],
  CHILD_ACCOUNT_RESTRICTED: ["PARENT_CONSENT_PENDING"],
  ACTIVE: [],
};

/* ------------------------------------------------------------------ */
/* Date-of-birth entry helpers (client-side UX only)                   */
/* ------------------------------------------------------------------ */

export type DobParts = { month: string; day: string; year: string };

export const EMPTY_DOB: DobParts = { month: "", day: "", year: "" };

export type DobCheck =
  | { ok: true; iso: string; age: number; cohort: AgeCohort }
  | { ok: false; message: string };

/**
 * Validate a hand-entered month/day/year. Neutral wording only — the copy must
 * never hint that a lower age is "better", or a child will lie.
 */
export function checkDobParts(parts: DobParts, now: Date = new Date()): DobCheck {
  const m = Number(parts.month);
  const d = Number(parts.day);
  const y = Number(parts.year);
  if (!parts.month || !parts.day || !parts.year) {
    return { ok: false, message: "Enter your birth month, day and year." };
  }
  if (!Number.isInteger(m) || !Number.isInteger(d) || !Number.isInteger(y)) {
    return { ok: false, message: "Use numbers for month, day and year." };
  }
  if (String(y).length !== 4) return { ok: false, message: "Enter the full 4-digit year." };
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const age = calculateAge(iso, now);
  if (age == null) {
    // Distinguish "impossible date" from "future date" for a useful message.
    const probe = new Date(y, m - 1, d);
    const real = probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
    if (!real) return { ok: false, message: "That date doesn't exist. Check the month and day." };
    if (probe.getTime() > now.getTime()) {
      return { ok: false, message: "That date is in the future. Enter your real birth date." };
    }
    return { ok: false, message: `Enter a year within the last ${MAX_PLAUSIBLE_AGE_YEARS} years.` };
  }
  return { ok: true, iso, age, cohort: cohortFromAge(age) };
}

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/* ------------------------------------------------------------------ */
/* Hooks                                                              */
/* ------------------------------------------------------------------ */

export const AGE_STATUS_KEY = ["age-status"] as const;

export function useMyAgeStatus(enabled = true) {
  const fetchStatus = useServerFn(getMyAgeStatus);
  return useQuery<AgeStatus>({
    queryKey: AGE_STATUS_KEY,
    queryFn: () => fetchStatus(),
    enabled,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useSubmitBirthday() {
  const submit = useServerFn(submitMyBirthday);
  const qc = useQueryClient();
  return async (iso: string): Promise<AgeStatus> => {
    const result = await submit({ data: { dateOfBirth: iso } });
    qc.setQueryData(AGE_STATUS_KEY, result);
    await qc.invalidateQueries({ queryKey: AGE_STATUS_KEY });
    return result;
  };
}

/* ------------------------------------------------------------------ */
/* Pending date of birth captured on the signup form                   */
/* ------------------------------------------------------------------ */

const PENDING_DOB_KEY = "openrun:pending-dob";

export function stashPendingDob(iso: string) {
  try {
    window.localStorage.setItem(PENDING_DOB_KEY, iso);
  } catch {
    /* private mode */
  }
}

export function readPendingDob(): string | null {
  try {
    const v = window.localStorage.getItem(PENDING_DOB_KEY);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function clearPendingDob() {
  try {
    window.localStorage.removeItem(PENDING_DOB_KEY);
  } catch {
    /* ignore */
  }
}

export type { AgeStatus };
