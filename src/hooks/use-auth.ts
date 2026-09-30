import { useSyncExternalStore } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
};

const listeners = new Set<() => void>();
const SERVER_AUTH_STATE: AuthState = { session: null, user: null, loading: true };
let authState: AuthState = { session: null, user: null, loading: true };
let initialized = false;
const AUTH_HYDRATION_TIMEOUT_MS = 6_000;

function isInvalidSessionError(message: string | undefined): boolean {
  return /user.*not.*found|user_not_found|does not exist|invalid.*(?:jwt|token)|jwt.*invalid/i.test(
    message ?? "",
  );
}

function clearInvalidLocalSession() {
  setAuthState({ session: null, user: null, loading: false });
  void supabase.auth.signOut({ scope: "local" }).catch(() => {
    // The state is already signed out. A failed cleanup must not restore or
    // keep using a token that the backend has rejected.
  });
}

function emit() {
  listeners.forEach((listener) => listener());
}

function setAuthState(next: Partial<AuthState>) {
  authState = { ...authState, ...next };
  emit();
}

function initAuthStore() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  // 1. Subscribe FIRST so no event is missed while we hydrate.
  supabase.auth.onAuthStateChange((event, session) => {
    // INITIAL_SESSION is only the locally persisted value. Keep startup gated
    // until getUser() verifies it below, otherwise a deleted account can fire
    // every authenticated background request with a stale bearer token.
    if (event === "INITIAL_SESSION") return;
    setAuthState({ session, user: session?.user ?? null, loading: false });
  });

  // 2. Hydrate from localStorage-backed session — this is the real
  //    "auth is ready" signal on mobile webviews. Network-based
  //    getUser() races with storage rehydration and produces false
  //    null-user states.
  const hydrationTimeout = window.setTimeout(() => {
    // A stuck auth storage lock must not hold every protected route behind a
    // full-screen loader forever. A valid session may still arrive through
    // onAuthStateChange or the late getSession resolution below.
    if (authState.loading) {
      setAuthState({ session: null, user: null, loading: false });
    }
  }, AUTH_HYDRATION_TIMEOUT_MS);

  supabase.auth
    .getSession()
    .then(({ data }) => {
      if (!data.session) {
        window.clearTimeout(hydrationTimeout);
        setAuthState({ session: null, user: null, loading: false });
        return;
      }

      // 3. Verify the persisted identity before publishing it to the app.
      //    A network failure still preserves the session for flaky mobile;
      //    an explicit invalid/deleted-user response clears it locally.
      supabase.auth
        .getUser()
        .then(({ data: userData, error }) => {
          window.clearTimeout(hydrationTimeout);
          if (userData?.user) {
            setAuthState({ session: data.session, user: userData.user, loading: false });
          } else if (error && isInvalidSessionError(error.message)) {
            clearInvalidLocalSession();
          } else {
            setAuthState({
              session: data.session,
              user: data.session?.user ?? null,
              loading: false,
            });
          }
        })
        .catch(() => {
          window.clearTimeout(hydrationTimeout);
          setAuthState({
            session: data.session,
            user: data.session?.user ?? null,
            loading: false,
          });
        });
    })
    .catch(() => {
      window.clearTimeout(hydrationTimeout);
      setAuthState({ session: null, user: null, loading: false });
    });
}

function subscribe(listener: () => void) {
  initAuthStore();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return authState;
}

function getServerSnapshot() {
  return SERVER_AUTH_STATE;
}

export function useAuth() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export async function signOut() {
  // Unlink this device from the user's push identity so alerts stop following them.
  try {
    const { logoutOneSignal } = await import("@/lib/onesignal");
    await logoutOneSignal();
  } catch {
    /* ignore */
  }
  // Signed media URLs and cached per-account lists must not carry over to the
  // next person on a shared device.
  try {
    const { resetPerUserClientState } = await import("@/lib/per-user-state");
    await resetPerUserClientState();
  } catch {
    /* ignore */
  }
  // A guardian acting as a managed child has their own session parked on this
  // device. Take it first so nothing restores it mid-sign-out, then revoke it
  // after the current one: "Sign out" ends both.
  let parked: import("@/lib/managed-session").ParkedGuardianSession | null = null;
  try {
    const { takeParkedGuardianSession } = await import("@/lib/managed-session");
    parked = takeParkedGuardianSession();
  } catch {
    /* ignore */
  }
  // `local` scope signs the user out of *this* device only. Supabase defaults
  // to `global`, which revokes every refresh token on the account — ending the
  // user's sessions on every other device they own, which is not what a
  // "Sign out" button on one browser should do.
  await supabase.auth.signOut({ scope: "local" });
  if (parked) {
    const { revokeParkedGuardianSession } = await import("@/lib/managed-session");
    await revokeParkedGuardianSession(parked);
  }
}

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (!error && data.user) return data.user;
  if (isInvalidSessionError(error?.message)) {
    clearInvalidLocalSession();
    return null;
  }
  const { data: sessionData } = await supabase.auth.getSession();
  return sessionData.session?.user ?? null;
}
