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
  EMPTY_DOB,
  MONTHS,
  checkDobParts,
  stashPendingDob,
  type DobParts,
} from "@/lib/age-verification";
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
      title: "Sign in — ballaCity",
      description: "Sign in or create an ballaCity account to join and host pickup games.",
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
  // Mandatory at signup: no account is activated without a date of birth.
  const [dob, setDob] = useState<DobParts>(EMPTY_DOB);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  // Never pre-checked: the user must tick each document themselves.
  const [consent, setConsent] = useState(emptyConsentValue);
  const consentOk = allAccepted(consent);
  // Inline, field-associated validation messages (toasts alone are invisible to
  // screen readers and vanish before a user can act on them).
  const [errors, setErrors] = useState<{
    type: string | null;
    dob: string | null;
    consent: string | null;
    form: string | null;
  }>({ type: null, dob: null, consent: null, form: null });
  const dobRef = useRef<HTMLSelectElement | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);

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

  // Never let a stalled network call trap the user on the sign-in form: every
  // await between "submit succeeded" and "leave /auth" is bounded, and the
  // fallback always continues (AuthGate re-runs the same check server-side).
  const withTimeout = async <T,>(op: PromiseLike<T>, ms: number, fallback: T): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve(op),
        new Promise<T>((resolve) => {
          timer = setTimeout(() => resolve(fallback), ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const needsAccountType = async (currentUser: User | null | undefined) => {
    if (!currentUser) return false;
    const query = supabase
      .from("profiles")
      .select("account_type")
      .eq("id", currentUser.id)
      .maybeSingle();
    const res = await withTimeout(query, 2500, null as unknown as Awaited<typeof query> | null);
    if (!res) {
      console.warn("[auth] account type check timed out; continuing");
      return false;
    }
    const { data, error } = res;
    if (error) {
      console.warn("[auth] account type check failed", error.message);
      return false;
    }
    const t = (data as { account_type?: string } | null)?.account_type;
    return !isAccountType(t);
  };

  const leave = (dest: string) => {
    // Hard reload keeps mobile webviews / OAuth popups in sync with the
    // freshly-hydrated session; a client-side navigate can race with the
    // AuthGate's own loading flip.
    window.location.replace(dest);
    // If the document load never takes (proxy hiccup, blocked replace), retry
    // once with an assignment so the user isn't left staring at the form.
    window.setTimeout(() => {
      if (window.location.pathname === "/auth") window.location.href = dest;
    }, 2500);
  };

  const goPostAuth = async (currentUser: User | null | undefined = user) => {
    if (await needsAccountType(currentUser)) {
      leave("/onboarding/account-type");
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
    leave(dest);
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
    setErrors({ type: null, dob: null, consent: null, form: null });
    setBusy(true);
    try {
      if (mode === "signup") {
        if (!accountType) {
          setErrors((p) => ({ ...p, type: "Pick an account type first." }));
          toast.error("Pick an account type first.");
          setSignupStep("type");
          return;
        }
        // Age is determined BEFORE the account exists. The date itself is only
        // parked locally; the server derives the age and cohort from it on the
        // first authenticated load (see /onboarding/age).
        const dobCheck = checkDobParts(dob);
        if (!dobCheck.ok) {
          setErrors((p) => ({ ...p, dob: dobCheck.message }));
          toast.error(dobCheck.message);
          dobRef.current?.focus();
          return;
        }
        if (!consentOk) {
          const message =
            "Please agree to the Terms of Service and Privacy Policy to continue.";
          setErrors((p) => ({ ...p, consent: message }));
          toast.error(message);
          return;
        }

        // Signup may finish without a session (email confirmation), so the exact
        // accepted versions are parked and written on first authenticated load.
        stashPendingConsent(currentAcceptances());
        setPendingAccountType(accountType);
        stashPendingDob(dobCheck.iso);


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
          setErrors((p) => ({
            ...p,
            form: "An account with this email already exists. Try signing in.",
          }));
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
            setErrors((p) => ({ ...p, form: "Email or password is incorrect." }));
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
            setErrors((p) => ({ ...p, form: "Confirm your email first, then sign in." }));
            toast.error("Confirm your email first, then sign in.");
            return;
          }
          throw error;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Auth failed";
      setErrors((p) => ({ ...p, form: message }));
      toast.error(message);
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

  // Move focus to the error summary so it is announced immediately.
  useEffect(() => {
    if (errors.form) summaryRef.current?.focus();
  }, [errors.form]);

  const oauth = (provider: "google" | "apple", opts: { isRetry?: boolean } = {}) => {
    // Cheap synchronous consent guard before the tap gesture is consumed.
    if (mode === "signup" && !consentOk) {
      setErrors((p) => ({
        ...p,
        consent: "Please agree to the Terms of Service and Privacy Policy to continue.",
      }));
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
          <div className="font-display text-3xl font-bold">ballaCity</div>
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

            {errors.type ? (
              <p role="alert" className="text-center text-xs font-semibold text-destructive">
                {errors.type}
              </p>
            ) : null}

            <button
              onClick={() => {
                if (!accountType) {
                  setErrors((p) => ({ ...p, type: "Pick an account type to continue." }));
                  toast.error("Pick an account type to continue.");
                  return;
                }
                setErrors((p) => ({ ...p, type: null }));
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

            {errors.form ? (
              <div
                role="alert"
                ref={summaryRef}
                tabIndex={-1}
                className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                {errors.form}
              </div>
            ) : null}

            <form onSubmit={submit} noValidate className="space-y-3">
              {mode === "signup" && (
                <div>
                  <label
                    htmlFor="signup-display-name"
                    className="mb-1 block text-xs font-semibold text-muted-foreground"
                  >
                    Display name
                  </label>
                  <input
                    id="signup-display-name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Display name"
                    autoComplete="nickname"
                    className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
                  />
                </div>
              )}
              {mode === "signup" && (
                <fieldset
                  aria-describedby={`dob-hint${errors.dob ? " dob-error" : ""}`}
                  aria-invalid={errors.dob ? true : undefined}
                >
                  <legend className="mb-1 text-xs font-semibold text-muted-foreground">
                    Date of birth
                  </legend>
                  <div className="grid grid-cols-3 gap-2">
                    <select
                      aria-label="Birth month"
                      aria-invalid={errors.dob ? true : undefined}
                      aria-describedby={`dob-hint${errors.dob ? " dob-error" : ""}`}
                      ref={dobRef}
                      value={dob.month}
                      onChange={(e) => setDob((p) => ({ ...p, month: e.target.value }))}
                      className="rounded-2xl border border-border bg-surface px-3 py-3 text-sm outline-none focus:border-lime"
                    >
                      <option value="">Month</option>
                      {MONTHS.map((m, i) => (
                        <option key={m} value={String(i + 1)}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Birth day"
                      aria-invalid={errors.dob ? true : undefined}
                      aria-describedby={`dob-hint${errors.dob ? " dob-error" : ""}`}
                      value={dob.day}
                      onChange={(e) => setDob((p) => ({ ...p, day: e.target.value }))}
                      className="rounded-2xl border border-border bg-surface px-3 py-3 text-sm outline-none focus:border-lime"
                    >
                      <option value="">Day</option>
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={String(d)}>
                          {d}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label="Birth year"
                      aria-invalid={errors.dob ? true : undefined}
                      aria-describedby={`dob-hint${errors.dob ? " dob-error" : ""}`}
                      inputMode="numeric"
                      autoComplete="bday-year"
                      placeholder="Year"
                      maxLength={4}
                      value={dob.year}
                      onChange={(e) =>
                        setDob((p) => ({
                          ...p,
                          year: e.target.value.replace(/[^0-9]/g, "").slice(0, 4),
                        }))
                      }
                      className="rounded-2xl border border-border bg-surface px-3 py-3 text-sm outline-none focus:border-lime"
                    />
                  </div>
                  {errors.dob ? (
                    <p id="dob-error" role="alert" className="mt-1 text-xs font-semibold text-destructive">
                      {errors.dob}
                    </p>
                  ) : null}
                  <p id="dob-hint" className="mt-1 text-[11px] text-muted-foreground">
                    Your age helps us provide the right safety and privacy settings. Your birth date
                    stays private.
                  </p>
                </fieldset>
              )}

              <div>
                <label
                  htmlFor="auth-email"
                  className="mb-1 block text-xs font-semibold text-muted-foreground"
                >
                  Email
                </label>
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  required
                  autoComplete="email"
                  className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
                />
              </div>
              <div>
                <label
                  htmlFor="auth-password"
                  className="mb-1 block text-xs font-semibold text-muted-foreground"
                >
                  Password
                </label>
                <input
                  id="auth-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  required
                  minLength={6}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  aria-describedby={mode === "signup" ? "password-hint" : undefined}
                  className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
                />
                {mode === "signup" ? (
                  <p id="password-hint" className="mt-1 text-[11px] text-muted-foreground">
                    At least 6 characters.
                  </p>
                ) : null}
              </div>
              {mode === "signup" && errors.consent ? (
                <p role="alert" className="text-xs font-semibold text-destructive">
                  {errors.consent}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={busy}
                aria-busy={busy}
                className="w-full rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
              >
                {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
              </button>
              <p className="sr-only" role="status" aria-live="polite">
                {busy ? "Submitting, please wait." : ""}
              </p>
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
                ? "New to ballaCity? Create an account"
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
