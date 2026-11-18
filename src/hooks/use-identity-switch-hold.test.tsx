// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The AuthGate hold for a guardian <-> managed-child switch, driven by the real
 * switch flag in managed-session.ts. revokeParkedGuardianSession sets the flag
 * for exactly as long as its auth calls take, so a pending setSession is a
 * switch in progress and resolving it ends the switch.
 */

const auth = vi.hoisted(() => ({
  setSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth },
}));

import { IDENTITY_SWITCH_MAX_HOLD_MS, decideAuthGateStep } from "@/lib/authgate-decision";
import {
  isIdentitySwitchInProgress,
  revokeParkedGuardianSession,
  type ParkedGuardianSession,
} from "@/lib/managed-session";
import { useIdentitySwitchHold } from "@/hooks/use-identity-switch-hold";

const parked: ParkedGuardianSession = {
  accessToken: "access",
  refreshToken: "refresh",
  guardianUserId: "guardian",
  guardianName: null,
  childUserId: "child",
  childName: "Kid",
  parkedAt: "2026-11-14T00:00:00Z",
};

/** Start a switch that runs until the returned function is called. */
function startSwitch(): { finish: () => Promise<void> } {
  let release!: (v: { error: null }) => void;
  auth.setSession.mockReturnValueOnce(new Promise((r) => (release = r)));
  auth.signOut.mockResolvedValueOnce({ error: null });
  const done = revokeParkedGuardianSession(parked);
  return {
    finish: async () => {
      release({ error: null });
      await done;
    },
  };
}

/** What AuthGate does for a signed-out tab on a protected page. */
function useGateStepForSignedOutTab() {
  const holdForIdentitySwitch = useIdentitySwitchHold();
  return decideAuthGateStep({
    loading: false,
    hasUser: false,
    isPublic: false,
    pathname: "/parent",
    holdForIdentitySwitch,
  });
}

describe("useIdentitySwitchHold", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    auth.setSession.mockReset();
    auth.signOut.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does not hold a signed-out tab when no switch is running", () => {
    const { result } = renderHook(useGateStepForSignedOutTab);
    expect(isIdentitySwitchInProgress()).toBe(false);
    expect(result.current).toBe("verify");
  });

  it("holds while the switch runs and re-checks the moment it ends", async () => {
    const { result } = renderHook(useGateStepForSignedOutTab);

    let sw!: ReturnType<typeof startSwitch>;
    act(() => {
      sw = startSwitch();
    });
    expect(isIdentitySwitchInProgress()).toBe(true);
    expect(result.current).toBe("identity-switch-skip");

    // No navigation to /auth, however long the switch takes within its allowance.
    act(() => {
      vi.advanceTimersByTime(IDENTITY_SWITCH_MAX_HOLD_MS - 1);
    });
    expect(result.current).toBe("identity-switch-skip");

    await act(async () => {
      await sw.finish();
    });
    expect(isIdentitySwitchInProgress()).toBe(false);
    expect(result.current).toBe("verify");
  });

  it("stops holding a switch that never ends once its allowance runs out", async () => {
    const { result } = renderHook(useGateStepForSignedOutTab);

    let sw!: ReturnType<typeof startSwitch>;
    act(() => {
      sw = startSwitch();
    });
    expect(result.current).toBe("identity-switch-skip");

    act(() => {
      vi.advanceTimersByTime(IDENTITY_SWITCH_MAX_HOLD_MS);
    });
    // The flag is still stuck, but the tab goes on to the normal sign-in check.
    expect(isIdentitySwitchInProgress()).toBe(true);
    expect(result.current).toBe("verify");

    await act(async () => {
      await sw.finish();
    });
  });

  it("gives a later switch its own full allowance", async () => {
    const { result } = renderHook(useGateStepForSignedOutTab);

    let first!: ReturnType<typeof startSwitch>;
    act(() => {
      first = startSwitch();
    });
    act(() => {
      vi.advanceTimersByTime(IDENTITY_SWITCH_MAX_HOLD_MS);
    });
    await act(async () => {
      await first.finish();
    });
    expect(result.current).toBe("verify");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    let second!: ReturnType<typeof startSwitch>;
    act(() => {
      second = startSwitch();
    });
    expect(result.current).toBe("identity-switch-skip");

    await act(async () => {
      await second.finish();
    });
    expect(result.current).toBe("verify");
  });
});
