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
    // Don't clobber a session we just published from getSession().
    if (event === "INITIAL_SESSION" && !session) return;
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
      window.clearTimeout(hydrationTimeout);
      setAuthState({
        session: data.session,
        user: data.session?.user ?? null,
        loading: false,
      });

      // 3. Best-effort server verification. Only downgrade to signed-out
      //    if Auth explicitly says the user is gone — never on a network
      //    error, which would falsely sign the user out on flaky mobile.
      if (data.session) {
        supabase.auth
          .getUser()
          .then(({ data: userData, error }) => {
            if (userData?.user) {
              setAuthState({ user: userData.user });
            } else if (error && /user.*not.*found|invalid|jwt/i.test(error.message ?? "")) {
              setAuthState({ session: null, user: null });
            }
          })
          .catch(() => {
            /* network error — keep the persisted session */
          });
      }
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
  // Signed media URLs are per-viewer credentials: drop them so a shared device
  // can't keep rendering the previous account's private media.
  try {
    const { clearMediaUrlCache } = await import("@/hooks/use-media-url");
    clearMediaUrlCache();
  } catch {
    /* ignore */
  }
  await supabase.auth.signOut();
}

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (!error && data.user) return data.user;
  const { data: sessionData } = await supabase.auth.getSession();
  return sessionData.session?.user ?? null;
}
