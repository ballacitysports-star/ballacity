import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type OAuthTokens = {
  access_token: string;
  refresh_token: string;
};

type OAuthSessionResult = {
  session: Session | null;
  error: Error | null;
  foundTokens: boolean;
};

function paramsFromUrl(url: string) {
  const parsed = new URL(url);
  const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  return [parsed.searchParams, new URLSearchParams(hash)];
}

export function readOAuthTokensFromUrl(url: string): OAuthTokens | null {
  const paramSets = paramsFromUrl(url);
  for (const params of paramSets) {
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (accessToken && refreshToken) {
      return { access_token: accessToken, refresh_token: refreshToken };
    }
  }
  return null;
}

export function readOAuthCodeFromUrl(url: string): string | null {
  const paramSets = paramsFromUrl(url);
  for (const params of paramSets) {
    const code = params.get("code");
    if (code) return code;
  }
  return null;
}

export function hasOAuthErrorInUrl(url: string): boolean {
  return paramsFromUrl(url).some((params) => params.has("error"));
}

function cleanOAuthUrl() {
  if (typeof window === "undefined") return;
  window.history.replaceState(
    window.history.state,
    document.title,
    window.location.pathname,
  );
}

export async function establishSessionFromOAuthUrl(
  url = typeof window !== "undefined" ? window.location.href : "",
): Promise<OAuthSessionResult> {
  if (!url) return { session: null, error: null, foundTokens: false };
  const tokens = readOAuthTokensFromUrl(url);
  if (!tokens) {
    const code = readOAuthCodeFromUrl(url);
    if (!code) return { session: null, error: null, foundTokens: false };

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    cleanOAuthUrl();
    return {
      session: data.session ?? null,
      error: error ?? null,
      foundTokens: true,
    };
  }

  const { data, error } = await supabase.auth.setSession(tokens);
  cleanOAuthUrl();
  return {
    session: data.session ?? null,
    error: error ?? null,
    foundTokens: true,
  };
}

export async function waitForAuthSession({
  timeoutMs = 8_000,
  intervalMs = 200,
}: {
  timeoutMs?: number;
  intervalMs?: number;
} = {}): Promise<Session | null> {
  return new Promise((resolve) => {
    let settled = false;
    let polling = false;
    let subscription: { unsubscribe: () => void } | undefined;

    const cleanup = () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
      subscription?.unsubscribe();
    };

    const finish = (session: Session | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(session);
    };

    const poll = () => {
      if (polling || settled) return;
      polling = true;
      supabase.auth
        .getSession()
        .then(({ data }) => {
          if (data.session) finish(data.session);
        })
        .catch(() => {
          // Keep waiting until the hard timeout or an auth-state event fires.
        })
        .finally(() => {
          polling = false;
        });
    };

    const timeout = window.setTimeout(() => finish(null), timeoutMs);
    const interval = window.setInterval(poll, intervalMs);
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) finish(session);
    });
    subscription = data.subscription;
    poll();
  });
}