import { describe, expect, it } from "vitest";
import {
  IDENTITY_SWITCH_MAX_HOLD_MS,
  decideAuthGateStep,
  identitySwitchHoldRemainingMs,
} from "@/lib/authgate-decision";

const signedOutOnProtectedPage = {
  loading: false,
  hasUser: false,
  isPublic: false,
  pathname: "/parent",
  holdForIdentitySwitch: false,
};

describe("decideAuthGateStep", () => {
  it("sends a signed-out visitor on a protected page to the sign-in check", () => {
    expect(decideAuthGateStep(signedOutOnProtectedPage)).toBe("verify");
  });

  it("holds a signed-out tab that is between one session and the next of a switch", () => {
    // Otherwise the sign-in page mounts mid-switch and forwards the restored
    // guardian to `next` (the page the child had open), racing the switch's own
    // navigation to the Parent Center.
    expect(decideAuthGateStep({ ...signedOutOnProtectedPage, holdForIdentitySwitch: true })).toBe(
      "identity-switch-skip",
    );
  });

  it("verifies again once the hold ends", () => {
    const during = decideAuthGateStep({ ...signedOutOnProtectedPage, holdForIdentitySwitch: true });
    const after = decideAuthGateStep({ ...signedOutOnProtectedPage, holdForIdentitySwitch: false });
    expect([during, after]).toEqual(["identity-switch-skip", "verify"]);
  });

  it("decides nothing while auth is loading, switch or not", () => {
    for (const holdForIdentitySwitch of [false, true]) {
      expect(
        decideAuthGateStep({ ...signedOutOnProtectedPage, loading: true, holdForIdentitySwitch }),
      ).toBe("wait-for-auth");
    }
  });

  it("lets a signed-in user, a public page and the sign-in page itself through first", () => {
    const hold = { ...signedOutOnProtectedPage, holdForIdentitySwitch: true };
    expect(decideAuthGateStep({ ...hold, hasUser: true })).toBe("user-present");
    expect(decideAuthGateStep({ ...hold, isPublic: true })).toBe("public-skip");
    expect(decideAuthGateStep({ ...hold, pathname: "/auth" })).toBe("auth-route-skip");
  });
});

describe("identitySwitchHoldRemainingMs", () => {
  it("is zero when no switch is running", () => {
    expect(identitySwitchHoldRemainingMs(null, 1_000)).toBe(0);
  });

  it("counts down from the allowance and never goes negative", () => {
    const start = 50_000;
    expect(identitySwitchHoldRemainingMs(start, start)).toBe(IDENTITY_SWITCH_MAX_HOLD_MS);
    expect(identitySwitchHoldRemainingMs(start, start + 4_000)).toBe(
      IDENTITY_SWITCH_MAX_HOLD_MS - 4_000,
    );
    expect(identitySwitchHoldRemainingMs(start, start + IDENTITY_SWITCH_MAX_HOLD_MS)).toBe(0);
    expect(identitySwitchHoldRemainingMs(start, start + 10 * IDENTITY_SWITCH_MAX_HOLD_MS)).toBe(0);
  });
});
