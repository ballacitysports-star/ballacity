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
let refreshPromise: Promise<AuthState> | null = null;

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

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "INITIAL_SESSION" && !session) return;
    setAuthState({ session, user: session?.user ?? null, loading: false });
  });

  void refreshAuth();
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

export async function refreshAuth() {
  if (typeof window === "undefined") return authState;
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const sessionUser = sessionData.session?.user ?? null;

      if (!sessionUser) {
        const next = { session: null, user: null, loading: false };
        setAuthState(next);
        return next;
      }

      setAuthState({ session: sessionData.session, user: sessionUser, loading: false });

      const { data, error } = await supabase.auth.getUser();
      const next = {
        session: sessionData.session,
        user: error ? sessionUser : data.user ?? sessionUser,
        loading: false,
      };
      setAuthState(next);
      return next;
    } catch {
      const next = { session: null, user: null, loading: false };
      setAuthState(next);
      return next;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function waitForAuthSession(timeoutMs = 5_000) {
  const started = Date.now();
  let lastState = await refreshAuth();
  if (lastState.user) return lastState;

  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    lastState = await refreshAuth();
    if (lastState.user) return lastState;
  }

  return lastState;
}

export async function signOut() {
  await supabase.auth.signOut();
  setAuthState({ session: null, user: null, loading: false });
}

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (!error && data.user) return data.user;
  const { data: sessionData } = await supabase.auth.getSession();
  return sessionData.session?.user ?? null;
}
