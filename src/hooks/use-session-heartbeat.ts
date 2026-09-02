import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { recordSessionHeartbeat } from "@/lib/session-activity.functions";

const INTERVAL_MS = 60_000;

/**
 * Sends one heartbeat a minute while the tab is visible and the member is
 * signed in. Nothing is recorded in the background or while hidden.
 */
export function useSessionHeartbeat() {
  const { user } = useAuth();
  const beat = useServerFn(recordSessionHeartbeat);

  useEffect(() => {
    if (!user) return;
    let stopped = false;
    const timezone = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
      } catch {
        return null;
      }
    })();

    const tick = () => {
      if (stopped || document.visibilityState !== "visible") return;
      void beat({ data: { timezone } }).catch(() => {});
    };

    tick();
    const id = window.setInterval(tick, INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [user, beat]);
}
