import { createFileRoute, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import type { User } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/hooks/use-auth";
import { trackSigninEvent } from "@/lib/auth-signin-telemetry";
import { classifyOAuthFailure } from "@/lib/oauth-outcome";
import { sanitizeNextPath } from "@/routes/__root";
import { readLastVisited } from "@/lib/last-visited";
import { AccountTypePicker } from "@/components/AccountTypePicker";
import {
  ACCOUNT_TYPE_META,
  type AccountType,
  isAccountType,
  setPendingAccountType,
} from "@/lib/account-type";
import { LegalConsent, allAccepted, emptyConsentValue } from "@/components/legal/LegalConsent";
import { currentAcceptances, stashPendingConsent } from "@/lib/legal-consent";



export const Route = createFileRoute("/auth")({
  head: () =>
    pageHead({
      path: "/auth",
      title: "Sign in — OpenRun",
      description: "Sign in or create an OpenRun account to join and host pickup games.",
      noindex: true,
    }),
  validateSearch: (s: Record<string, unknown>) => {
    const next = sanitizeNextPath(s.next);
    return next ? { next } : {};
  },
  component: AuthPage,
});

function AuthPage() {
  const { next } = Route.useSearch();
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [signupStep, setSignupStep] = useState<"type" | "form">("type");
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  // Never pre-checked: the user must tick each document themselves.
  const [consent, setConsent] = useState(emptyConsentValue);
  const consentOk = allAccepted(consent);

  // Non-null while we're inside the post-provider grace window (see oauth()).
  const [waitingProvider, setWaitingProvider] = useState<string | null>(null);
  // Monotonic token: bumping it cancels any in-flight session poll.
  const waitingRef = useRef(0);

  useEffect(
    () => () => {
      waitingRef.current += 1;
    },
    [],
  );

  const needsAccountType = async (currentUser: User | null | undefined) => {
    if (!currentUser) return false;
    const { data, error } = await supabase
      .from("profiles")
      .select("account_type")
      .eq("id", currentUser.id)
      .maybeSingle();
    if (error) {
      console.warn("[auth] account type check failed", error.message);
      return false;
    }
    const t = (data as { account_type?: string } | null)?.account_type;
    return !isAccountType(t);
  };

  const goPostAuth = async (currentUser: User | null | undefined = user) => {
    if (await needsAccountType(currentUser)) {
      window.location.replace("/onboarding/account-type");
      return;
    }
    let dest = sanitizeNextPath(next);
    if (!dest) dest = readLastVisited() ?? undefined;
    if (!dest) {
      // Some mobile in-app browsers strip the `next` query on redirects;
      // fall back to a same-origin referrer, then to the in-app default
      // surface (/feed) so users never get bounced back to marketing.
      try {
        const ref = document.referrer;
        if (ref) {
          const u = new URL(ref);
          if (u.origin === window.location.origin) {
            dest = sanitizeNextPath(`${u.pathname}${u.search}${u.hash}`);
          }
        }
      } catch {
        /* ignore */
      }
    }
    if (!dest) dest = "/feed";
    // Hard reload keeps mobile webviews / OAuth popups in sync with the
    // freshly-hydrated session; a client-side navigate can race with the
    // AuthGate's own loading flip.
    window.location.replace(dest);
  };

  useEffect(() => {
    if (!loading && user) void goPostAuth(user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) void goPostAuth(data.session.user);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        session &&
        (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED")
      ) {
        void goPostAuth(session.user);
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (mode === "signup") {
        if (!accountType) {
          toast.error("Pick an account type first.");
          setSignupStep("type");
          return;
        }
        if (!consentOk) {
          toast.error("Please agree to the Terms of Service and Privacy Policy to continue.");
          return;
        }
        // Signup may finish without a session (email confirmation), so the exact
        // accepted versions are parked and written on first authenticated load.
        stashPendingConsent(currentAcceptances());
        setPendingAccountType(accountType);

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              display_name: displayName || email.split("@")[0],
              account_type: accountType,
            },
          },
        });
        if (error) throw error;
        // Supabase returns 200 with empty identities for already-registered emails.
        if (data.user && data.user.identities && data.user.identities.length === 0) {
          toast.error("An account with this email already exists. Try signing in.");
          setMode("signin");
          return;
        }
        if (data.session) {
          toast.success("Account created!");
        } else {
          toast.success("Check your email to confirm your account.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          const msg = error.message?.toLowerCase() ?? "";
          if (msg.includes("invalid login") || msg.includes("invalid credentials")) {
            toast.error("Email or password is incorrect.", {
              description:
                "If you signed up with Google, continue with Google and set a password under Profile → Security, or use Forgot password to set one now.",
              action: {
                label: "Forgot password",
                onClick: () => void sendReset(email),
              },
              duration: 8000,
            });
            return;
          }
          if (msg.includes("email not confirmed")) {
            toast.error("Confirm your email first, then sign in.");
            return;
          }
          throw error;
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Auth failed");
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async (addr: string) => {
    if (!addr) {
      toast.error("Enter your email above first.");
      return;
    }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(addr, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast.success("Check your email for a reset link.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send reset email");
    }
  };

  const oauth = (provider: "google" | "apple", opts: { isRetry?: boolean } = {}) => {
    // Cheap synchronous consent guard before the tap gesture is consumed.
    if (mode === "signup" && !consentOk) {
      toast.error("Please agree to the Terms of Service and Privacy Policy to continue.");
      return;
    }
    // CRITICAL: start the OAuth helper before storage writes, state updates,
    // telemetry, or toasts. Mobile Safari/Chrome can reject the vendor popup if
    // anything meaningful runs before the helper consumes the tap gesture.
    const promise = lovable.auth.signInWithOAuth(provider, {
      redirect_uri: window.location.origin,
      ...(provider === "google" ? { extraParams: { prompt: "select_account" } } : {}),
    });

    if (mode === "signup") stashPendingConsent(currentAcceptances());


    const providerLabel = provider === "apple" ? "Apple" : "Google";
    if (mode === "signup" && accountType) {
      setPendingAccountType(accountType);
    }
    // Stash the intended destination so we can navigate to it AFTER the
    // session is confirmed. `redirect_uri` MUST stay a public same-origin URL —
    // passing protected routes to Google/Apple causes vendor rejection.
    try {
      const safeNext = sanitizeNextPath(next);
      if (safeNext) window.sessionStorage.setItem("openrun:oauth-next", safeNext);
      else window.sessionStorage.removeItem("openrun:oauth-next");
      window.sessionStorage.setItem("openrun:oauth-provider", provider);
    } catch {
      /* sessionStorage may be unavailable in private mode */
    }

    setBusy(true);
    trackSigninEvent(opts.isRetry ? "retry_clicked" : "attempt");

    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    const isIOSChrome = isIOS && /CriOS/.test(ua);
    const isInAppWebview = /(FBAN|FBAV|Instagram|Line|Twitter|LinkedInApp|Snapchat|TikTok)/i.test(
      ua,
    );

    const browserGuidance = isIOSChrome
      ? "In iOS Chrome, tap the ••• menu → Settings → Content Settings → Block Pop-ups → off. Or open this page in Safari."
      : isIOS
        ? "In Safari, go to Settings → Safari → turn off Block Pop-ups, then retry."
        : isInAppWebview
          ? "This in-app browser blocks sign-in popups. Tap the ••• menu and choose 'Open in browser', then retry."
          : "Allow popups for this site in your browser settings, then retry.";

    let blockedReported = false;
    const showBlockedToast = (errorMessage?: string) => {
      if (!blockedReported) {
        blockedReported = true;
        trackSigninEvent("popup_blocked", { errorMessage: errorMessage ?? null });
      }
      toast.error(`${providerLabel} sign-in popup was blocked`, {
        description: browserGuidance,
        action: {
          label: "Retry",
          onClick: () => oauth(provider, { isRetry: true }),
        },
        cancel: {
          label: "Copy link",
          onClick: () => {
            trackSigninEvent("copy_link_clicked");
            void navigator.clipboard?.writeText(window.location.href);
            toast.success("Link copied — paste it in another browser");
          },
        },
        duration: 15000,
      });
    };

    // No hang timer: the popup stays open while the user completes Google's
    // account picker + password + 2FA, which can easily take 30–60s. Only
    // treat the sign-in as blocked/failed when the OAuth helper's promise
    // itself rejects or returns an error — that IS the signal that the
    // popup couldn't open. onAuthStateChange handles the success redirect.
    const reportVendorFailure = (raw: string) => {
      // Log the raw error so recurrences leave a diagnosable trail.
      console.error(`[auth] ${provider} sign-in failed:`, raw);
      trackSigninEvent("failure", { provider, errorMessage: raw });
      if (/vendor|provider|external_provider|oauth/i.test(raw)) {
        toast.error(`${providerLabel} sign-in was rejected by the provider`, {
          description: "Please retry from this screen. Your account setup choice is still saved.",
          action: {
            label: "Retry",
            onClick: () => oauth(provider, { isRetry: true }),
          },
          duration: 10000,
        });
      } else {
        toast.error(raw || `${providerLabel} sign-in failed`);
      }
    };

    // iPhone Safari freezes the opener tab the moment the user switches to
    // the provider tab, so the helper's popup-closed watcher fires a bogus
    // "Sign in was cancelled". That signal is NOT proof of failure — keep
    // waiting for a session before showing anything scary. Classification
    // lives in @/lib/oauth-outcome so it can be unit-tested.

    const waitForSession = (raw: string) => {
      waitingRef.current += 1;
      const token = waitingRef.current;
      trackSigninEvent("inconclusive_wait", { provider, errorMessage: raw });
      setWaitingProvider(providerLabel);
      const startedAt = Date.now();
      const GRACE_MS = 120_000;
      const tick = async () => {
        if (waitingRef.current !== token) return; // superseded / unmounted
        const { data } = await supabase.auth.getSession();
        if (waitingRef.current !== token) return;
        if (data.session?.user) {
          waitingRef.current += 1; // stop further ticks and dedupe handling
          trackSigninEvent("success_after_wait", { provider });
          setWaitingProvider(null);
          void goPostAuth(data.session.user);
          return;
        }
        if (Date.now() - startedAt >= GRACE_MS) {
          waitingRef.current += 1;
          trackSigninEvent("wait_timeout", { provider, errorMessage: raw });
          setWaitingProvider(null);
          setBusy(false);
          toast.error(`We didn't hear back from ${providerLabel}`, {
            description: "Nothing was submitted. You can try signing in again.",
            action: {
              label: "Retry",
              onClick: () => oauth(provider, { isRetry: true }),
            },
            duration: 12000,
          });
          return;
        }
        window.setTimeout(() => void tick(), 1000);
      };
      void tick();
    };

    // Set when we enter the grace window, so `finally` leaves the button in
    // its "Finishing sign-in…" state instead of looking idle.
    let waiting = false;
    const handleAmbiguous = (raw: string) => {
      const outcome = classifyOAuthFailure(raw);
      if (outcome === "inconclusive") {
        waiting = true;
        waitForSession(raw);
      } else if (outcome === "popup_blocked") {
        showBlockedToast(raw);
      } else {
        reportVendorFailure(raw);
      }
    };

    promise
      .then((result) => {
        if (result?.error) {
          handleAmbiguous(result.error.message || "");
        } else if (!result?.redirected) {
          // Tokens were returned in-window and setSession was called.
          // Hard-reload bypasses router/state races in mobile webviews
          // (notably the Lovable Android app) where onAuthStateChange
          // fires but the client-side navigate never leaves /auth.
          trackSigninEvent("success", { provider });
          void supabase.auth.getSession().then(({ data }) => {
            void goPostAuth(data.session?.user ?? user);
          });
        } else {
          trackSigninEvent("success", { provider });
        }
      })
      .catch((err: unknown) => {
        handleAmbiguous(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!waiting) setBusy(false);
      });
  };

  return (
    <div className="mx-auto max-w-md min-h-screen flex flex-col pb-12">
      <header className="flex items-center gap-2 px-4 py-3">
        <Link
          to="/"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-display text-lg font-bold">
          {mode === "signin" ? "Sign in" : "Create account"}
        </h1>
      </header>

      <div className="px-4 mt-6 space-y-5">
        <div className="text-center">
          <div className="font-display text-3xl font-bold">OpenRun</div>
          <p className="text-sm text-muted-foreground mt-1">
            Save games, write reviews, and build your reputation.
          </p>
        </div>

        {mode === "signup" && signupStep === "type" ? (
          <>
            <AccountTypePicker value={accountType} onChange={setAccountType} />
            <p className="text-center text-xs text-muted-foreground">
              You can add team, trainer, and gym profiles later and switch between them anytime.
            </p>

            <button
              onClick={() => {
                if (!accountType) {
                  toast.error("Pick an account type to continue.");
                  return;
                }
                setSignupStep("form");
              }}
              className="w-full rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              Continue
            </button>
            <button
              onClick={() => setMode("signin")}
              className="w-full text-center text-xs text-muted-foreground py-2"
            >
              Already have an account? Sign in
            </button>
          </>
        ) : (
          <>
            {mode === "signup" && accountType ? (
              <div className="flex items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3 text-sm">
                <span>
                  Signing up as{" "}
                  <span className="font-bold">
                    {ACCOUNT_TYPE_META[accountType].emoji} {ACCOUNT_TYPE_META[accountType].label}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setSignupStep("type")}
                  className="text-xs text-muted-foreground underline"
                >
                  Change
                </button>
              </div>
            ) : null}

            {mode === "signup" ? (
              <LegalConsent value={consent} onChange={setConsent} disabled={busy} />
            ) : null}



            <button
              onClick={() => oauth("google")}
              disabled={busy}
              className="w-full rounded-full border border-border bg-surface px-4 py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden>
                <path
                  fill="#FFC107"
                  d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.5-5.9 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"
                />
                <path
                  fill="#FF3D00"
                  d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
                />
                <path
                  fill="#4CAF50"
                  d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.6 26.7 36.5 24 36.5c-5.4 0-9.6-3.4-11.3-8.1l-6.5 5C9.6 39.7 16.2 44 24 44z"
                />
                <path
                  fill="#1976D2"
                  d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.2 5.2C40.8 35.6 44 30.2 44 24c0-1.3-.1-2.3-.4-3.5z"
                />
              </svg>
              {waitingProvider === "Google" ? "Finishing sign-in…" : "Continue with Google"}
            </button>

            <button
              onClick={() => oauth("apple")}
              disabled={busy}
              className="w-full rounded-full border border-border bg-foreground px-4 py-3 text-sm font-bold text-background flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M16.365 1.43c0 1.14-.42 2.22-1.19 3.02-.83.87-2.14 1.54-3.24 1.45-.14-1.09.42-2.24 1.16-3.02.82-.87 2.22-1.51 3.27-1.45zM20.5 17.36c-.55 1.27-.82 1.84-1.53 2.96-.99 1.56-2.39 3.5-4.12 3.51-1.54.02-1.94-1-4.03-.99-2.09.01-2.53 1.01-4.07.99-1.73-.02-3.06-1.77-4.05-3.33C.1 16.24-.63 11.05 1.03 8.16c1.18-2.05 3.05-3.25 4.81-3.25 1.79 0 2.92 1 4.4 1 1.44 0 2.32-1 4.39-1 1.57 0 3.23.86 4.42 2.35-3.88 2.13-3.25 7.67 1.45 10.1z" />
              </svg>
              {waitingProvider === "Apple" ? "Finishing sign-in…" : "Continue with Apple"}
            </button>

            {waitingProvider ? (
              <p
                role="status"
                aria-live="polite"
                className="text-center text-xs text-muted-foreground"
              >
                Waiting for {waitingProvider} to finish… keep this tab open.
              </p>
            ) : null}

            <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
              <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
            </div>

            <form onSubmit={submit} className="space-y-3">
              {mode === "signup" && (
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Display name"
                  className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
                />
              )}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                required
                autoComplete="email"
                className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
                minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
              >
                {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
              </button>
            </form>

            {mode === "signin" && (
              <button
                onClick={async () => {
                  setBusy(true);
                  try {
                    await sendReset(email);
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
                className="w-full text-center text-xs text-muted-foreground py-1 underline"
              >
                Forgot password?
              </button>
            )}

            <button
              onClick={() => {
                const nextMode = mode === "signin" ? "signup" : "signin";
                setMode(nextMode);
                if (nextMode === "signup") setSignupStep("type");
              }}
              className="w-full text-center text-xs text-muted-foreground py-2"
            >
              {mode === "signin"
                ? "New to OpenRun? Create an account"
                : "Already have an account? Sign in"}
            </button>

            <p className="text-center text-[11px] text-muted-foreground">
              <Link to="/terms" className="underline">
                Terms of Service
              </Link>{" "}
              ·{" "}
              <Link to="/privacy" className="underline">
                Privacy Policy
              </Link>
            </p>
          </>
        )}

      </div>
    </div>
  );
}
