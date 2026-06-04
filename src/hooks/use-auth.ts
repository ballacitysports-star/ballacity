import { useSyncExternalStore } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
};

const listeners = new Set<() => void>();
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

  supabase.auth.onAuthStateChange((_event, session) => {
    setAuthState({ session, user: session?.user ?? null, loading: false });
  });

  supabase.auth.getSession().then(({ data }) => {
    setAuthState({
      session: data.session,
      user: data.session?.user ?? null,
      loading: false,
    });
  }).catch(() => {
    setAuthState({ session: null, user: null, loading: false });
  });
}

function subscribe(listener: () => void) {
  initAuthStore();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  initAuthStore();
  return authState;
}

function getServerSnapshot() {
  return { session: null, user: null, loading: true };
}

export function useAuth() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export async function signOut() {
  await supabase.auth.signOut();
}
