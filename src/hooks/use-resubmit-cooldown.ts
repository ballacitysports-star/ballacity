import { useEffect, useState } from "react";
import { joinResubmitCooldownRemainingMs, type JoinRequest } from "@/lib/payments";

/**
 * Milliseconds until a declined join request may be sent again, kept current
 * once a second while the cooldown runs and idle otherwise.
 *
 * Only the component that shows the countdown calls this, so only it re-renders
 * every second. The game page used to run this clock itself and re-rendered all
 * of GameDetail every second for the 15-minute cooldown (P2-6).
 */
export function useResubmitCooldownMs(req: JoinRequest | null): number {
  const remaining = joinResubmitCooldownRemainingMs(req);
  const counting = remaining > 0;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [counting]);
  return remaining;
}
