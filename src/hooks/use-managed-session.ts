import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
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
  const auth = useAuth();
  const { user, loading } = auth;
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
    if (auth.loading || auth.user || isIdentitySwitchInProgress()) return;
    if (!readParkedGuardianSession()) return;
    // No user is not yet proof that the child's session is gone. When the
    // server check of the stored session outlasts the auth store's hydration
    // timeout (a slow auth server on any full page load), the store publishes
    // "no user" and then the user once the check answers. Switching back on
    // that signed the child out and sent the guardian to the Parent Center
    // unasked. So act only once the client holds no session either. A sign-out
    // that comes later is a new auth state, and this runs again for it.
    let cancelled = false;
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        // An error (e.g. a refresh that failed on the network) says nothing
        // about whether the session is gone; a real removal signs out.
        if (cancelled || error || data.session || isIdentitySwitchInProgress()) return;
        if (readParkedGuardianSession()) void switchBackToGuardian();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // The whole auth state, not just `user`: a sign-out after the hydration
    // timeout leaves `user` null and `loading` false, but it is a new state.
  }, [auth]);
}
