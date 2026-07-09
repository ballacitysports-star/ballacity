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
    setAuthState({ session, user: session?.user ?? null, loading: false });
  });

  supabase.auth
    .getSession()
    .then(({ data: sessionData }) => {
      const session = sessionData.session;
      setAuthState({
        session,
        user: session?.user ?? null,
        loading: false,
      });

      if (!session) return;
      supabase.auth
        .getUser()
        .then(({ data, error }) => {
          if (error || !data.user) return;
          setAuthState({ user: data.user });
        })
        .catch(() => {
          // Keep the restored session user; a transient validation failure
          // should not put the app back into an indefinite loading state.
        });
    })
    .catch(() => {
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
  await supabase.auth.signOut();
}

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (!error && data.user) return data.user;
  const { data: sessionData } = await supabase.auth.getSession();
  return sessionData.session?.user ?? null;
}
