import { useEffect, useState, useSyncExternalStore } from "react";
import {
  IDENTITY_SWITCH_MAX_HOLD_MS,
  identitySwitchHoldRemainingMs,
} from "@/lib/authgate-decision";
import { getIdentitySwitchStartedAt, subscribeIdentitySwitch } from "@/lib/managed-session";

/**
 * Whether AuthGate should hold a signed-out tab for a guardian <-> managed-child
 * switch running in it.
 *
 * True while the switch is in progress, so the gate never sends the tab to
 * /auth between one session going out and the next coming in. Re-renders the
 * moment the switch ends, and turns false on its own once the switch has run
 * longer than `maxMs`, so a switch that never navigates cannot leave the tab
 * on the loading fallback for good.
 */
export function useIdentitySwitchHold(maxMs: number = IDENTITY_SWITCH_MAX_HOLD_MS): boolean {
  const startedAt = useSyncExternalStore(
    subscribeIdentitySwitch,
    getIdentitySwitchStartedAt,
    () => null,
  );
  // The switch (identified by its start time) whose allowance has run out.
  const [overran, setOverran] = useState<number | null>(null);

  useEffect(() => {
    if (startedAt === null) return;
    const remaining = identitySwitchHoldRemainingMs(startedAt, Date.now(), maxMs);
    if (remaining <= 0) {
      setOverran(startedAt);
      return;
    }
    const timer = setTimeout(() => setOverran(startedAt), remaining);
    return () => clearTimeout(timer);
  }, [startedAt, maxMs]);

  return startedAt !== null && overran !== startedAt;
}
