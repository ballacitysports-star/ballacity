import { describe, expect, it } from "vitest";
import {
  ACCOUNT_TYPE_ROUTE,
  AGE_GATE_ROUTE,
  isAccountSetupEscape,
  needsAgeGate,
  routeForSignupState,
  signupStateFor,
} from "@/lib/age-verification";

/**
 * Regression: /onboarding/age and /onboarding/account-type used to redirect
 * against each other for an account with neither a date of birth nor a profile
 * type, flipping the screen every few hundred milliseconds.
 *
 * These tests lock the rule both root gates share: while the member is on an
 * account-setup screen, NEITHER gate may redirect.
 */

/** Mirrors the root gate: which guards are active for this path? */
function gates(pathname: string, isPublic = false) {
  const skipAgeCheck = isPublic || isAccountSetupEscape(pathname);
  const skipTypeCheck = isPublic || pathname === ACCOUNT_TYPE_ROUTE || skipAgeCheck;
  return { skipAgeCheck, skipTypeCheck };
}

describe("onboarding guards never loop", () => {
  it("stands both gates down on the date-of-birth screen", () => {
    const { skipAgeCheck, skipTypeCheck } = gates(AGE_GATE_ROUTE);
    expect(skipAgeCheck).toBe(true);
    expect(skipTypeCheck).toBe(true);
  });

  it("stands both gates down on guardian consent, parent center, legal and safety", () => {
    for (const p of ["/onboarding/child", "/parent", "/parent/child/1", "/safety", "/account/legal"]) {
      expect(gates(p).skipTypeCheck).toBe(true);
    }
  });

  it("keeps the age gate active on the profile-type picker but not the type gate", () => {
    const { skipAgeCheck, skipTypeCheck } = gates(ACCOUNT_TYPE_ROUTE);
    expect(skipAgeCheck).toBe(false);
    expect(skipTypeCheck).toBe(true);
  });

  it("an account with no birthday and no profile type settles on the age screen", () => {
    // Age gate sends them to /onboarding/age...
    expect(needsAgeGate("age_verification_required")).toBe(true);
    const state = signupStateFor({
      authenticated: true,
      status: "age_verification_required",
      cohort: "unknown",
      hasAccountType: false,
    });
    expect(routeForSignupState(state)).toBe(AGE_GATE_ROUTE);
    // ...and once there, nothing may redirect them away.
    expect(gates(AGE_GATE_ROUTE).skipTypeCheck).toBe(true);
  });

  it("a stored birthday with an undetermined cohort still resolves to the age screen only", () => {
    const state = signupStateFor({
      authenticated: true,
      status: "active",
      cohort: "unknown",
      hasAccountType: false,
    });
    expect(routeForSignupState(state)).toBe(AGE_GATE_ROUTE);
    expect(gates(AGE_GATE_ROUTE).skipTypeCheck).toBe(true);
  });

  it("still guards ordinary protected routes", () => {
    const { skipAgeCheck, skipTypeCheck } = gates("/feed");
    expect(skipAgeCheck).toBe(false);
    expect(skipTypeCheck).toBe(false);
  });
});
