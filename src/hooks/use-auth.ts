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

/** True when `next` is a later version of the user record than `current`. */
function isNewerUser(next: User, current: User): boolean {
  const a = Date.parse(next.updated_at ?? "");
  const b = Date.parse(current.updated_at ?? "");
  return Number.isFinite(a) && Number.isFinite(b) && a > b;
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
    // supabase-js re-emits SIGNED_IN with the stored session whenever any tab
    // opens or becomes visible, and TOKEN_REFRESHED about hourly. For the
    // member already published, keep the same user object (every [user]
    // effect would run again otherwise) and publish nothing unless the token
    // changed. USER_UPDATED carries a changed user, so it replaces it, and so
    // does a session whose user record is newer than the one held.
    const current = authState.user;
    if (
      (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") &&
      !authState.loading &&
      current &&
      session?.user?.id === current.id &&
      !isNewerUser(session.user, current)
    ) {
      if (session.access_token !== authState.session?.access_token) setAuthState({ session });
      return;
    }
    setAuthState({ session, user: session?.user ?? null, loading: false });
  });

  // The session read from storage, once getSession() has answered.
  let persisted: Session | null = null;
  const hydrationTimeout = window.setTimeout(() => {
    if (!authState.loading) return;
    if (persisted) {
      // Only the server check of a stored session is slow (GET /auth/v1/user).
      // Showing a member the signed-out screen until it answers is wrong, so
      // publish the stored session unverified, as a network failure of that
      // check does. The check keeps running: an explicit invalid or deleted
      // user answer still signs out below, and a valid one replaces the user.
      setAuthState({ session: persisted, user: persisted.user ?? null, loading: false });
      return;
    }
    // getSession() itself has not answered: a stuck auth storage lock must not
    // hold every protected route behind a full-screen loader forever. A valid
    // session may still arrive through onAuthStateChange or the late
    // getSession resolution below.
    setAuthState({ session: null, user: null, loading: false });
  }, AUTH_HYDRATION_TIMEOUT_MS);

  // 2. Hydrate from localStorage-backed session — this is the real
  //    "auth is ready" signal on mobile webviews. Network-based
  //    getUser() races with storage rehydration and produces false
  //    null-user states.
  supabase.auth
    .getSession()
    .then(({ data }) => {
      persisted = data.session;
      if (!data.session) {
        window.clearTimeout(hydrationTimeout);
        setAuthState({ session: null, user: null, loading: false });
        return;
      }

      // 3. Verify the persisted identity before publishing it to the app.
      //    A network failure still preserves the session for flaky mobile;
      //    an explicit invalid/deleted-user response clears it locally.
      //
      //    The answer can arrive after the state was already published (the
      //    timeout above, or any auth event). By then the person may have
      //    signed out, here or in another tab, or signed in as someone else,
      //    and the client may hold a refreshed token. A late answer therefore
      //    applies only while the state still holds the identity it checked,
      //    and never brings back the stored session it started from.
      const checked = data.session;
      const checkedId = checked.user?.id;
      const answeredLate = () => !authState.loading;
      const stillChecked = () => !!checkedId && authState.session?.user?.id === checkedId;
      supabase.auth
        .getUser()
        .then(({ data: userData, error }) => {
          window.clearTimeout(hydrationTimeout);
          if (answeredLate()) {
            // The state moved on: signed out, or another account. Drop it.
            if (!stillChecked()) return;
            if (userData?.user?.id === checkedId) {
              // Keep the session held now (it may be a refreshed token).
              setAuthState({ user: userData.user });
            } else if (!userData?.user && error && isInvalidSessionError(error.message)) {
              clearInvalidLocalSession();
            }
            // An unverified failure adds nothing to the state already shown.
            return;
          }
          if (userData?.user) {
            setAuthState({ session: checked, user: userData.user, loading: false });
          } else if (error && isInvalidSessionError(error.message)) {
            clearInvalidLocalSession();
          } else {
            setAuthState({ session: checked, user: checked.user ?? null, loading: false });
          }
        })
        .catch(() => {
          window.clearTimeout(hydrationTimeout);
          // Already published: a failed check changes nothing.
          if (answeredLate()) return;
          setAuthState({ session: checked, user: checked.user ?? null, loading: false });
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
