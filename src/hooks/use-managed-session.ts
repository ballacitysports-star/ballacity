import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  isIdentitySwitchInProgress,
  readParkedGuardianSession,
  switchBackToGuardian,
} from "@/lib/managed-session";

/**
 * Keeps every tab consistent with guardian ⇄ managed-child switching.
 *
 * - Another tab switched identity: the session in storage changed from one
 *   user straight to another (supabase-js broadcasts it), so reload rather than
 *   keep rendering the previous person's cached data.
 * - The child's session vanished while a guardian session is parked (the
 *   child was deleted, or the session expired): put the guardian back instead
 *   of stranding them on the sign-in page.
 */
export function useManagedSessionWatcher() {
  const { user, loading } = useAuth();
  const lastUserId = useRef<string | null>(null);

  useEffect(() => {
    if (loading) return;
    const id = user?.id ?? null;
    const previous = lastUserId.current;
    lastUserId.current = id;
    // The tab doing the switch navigates by itself once it finishes.
    if (previous && id && previous !== id && !isIdentitySwitchInProgress()) {
      window.location.reload();
    }
  }, [user?.id, loading]);

  useEffect(() => {
    if (loading || user || isIdentitySwitchInProgress()) return;
    if (readParkedGuardianSession()) void switchBackToGuardian();
  }, [user, loading]);
}
