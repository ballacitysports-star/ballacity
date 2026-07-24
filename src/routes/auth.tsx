import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/hooks/use-auth";
import { trackSigninEvent } from "@/lib/auth-signin-telemetry";
import { sanitizeNextPath } from "@/routes/__root";
import { readLastVisited } from "@/lib/last-visited";
import { AccountTypePicker } from "@/components/AccountTypePicker";
import {
  ACCOUNT_TYPE_META,
  type AccountType,
  setPendingAccountType,
} from "@/lib/account-type";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — OpenRun" }] }),
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

  const goPostAuth = () => {
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
    if (!loading && user) goPostAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) goPostAuth();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED")) {
        goPostAuth();
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
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: next ? `${window.location.origin}${next}` : window.location.origin,
            data: { display_name: displayName || email.split("@")[0] },
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

  const google = (opts: { isRetry?: boolean } = {}) => {
    // CRITICAL: call signInWithOAuth SYNCHRONOUSLY as the first statement
    // in the click handler. iOS Chrome only treats popup.open() as a
    // trusted user gesture if no awaits / state updates happen first.
    const promise = lovable.auth.signInWithOAuth("google", {
      redirect_uri: next ? `${window.location.origin}${next}` : window.location.origin,
      extraParams: { prompt: "select_account" },
    });

    setBusy(true);
    trackSigninEvent(opts.isRetry ? "retry_clicked" : "attempt");

    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    const isIOSChrome = isIOS && /CriOS/.test(ua);
    const isInAppWebview = /(FBAN|FBAV|Instagram|Line|Twitter|LinkedInApp|Snapchat|TikTok)/i.test(ua);

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
      toast.error("Google sign-in popup was blocked", {
        description: browserGuidance,
        action: {
          label: "Retry",
          onClick: () => google({ isRetry: true }),
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
    promise
      .then((result) => {
        if (result?.error) {
          const msg = result.error.message || "";
          if (/popup|blocked|window|opener/i.test(msg)) {
            showBlockedToast(msg);
          } else {
            trackSigninEvent("failure", { errorMessage: msg });
            toast.error(msg || "Google sign-in failed");
          }
        } else if (!result?.redirected) {
          // Tokens were returned in-window and setSession was called.
          // Hard-reload bypasses router/state races in mobile webviews
          // (notably the Lovable Android app) where onAuthStateChange
          // fires but the client-side navigate never leaves /auth.
          trackSigninEvent("success");
          window.location.replace(next ?? "/profile");
        } else {
          trackSigninEvent("success");
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (/popup|blocked|window|opener/i.test(msg)) {
          showBlockedToast(msg);
        } else {
          trackSigninEvent("failure", { errorMessage: msg });
          toast.error(msg || "Google sign-in failed");
        }
      })
      .finally(() => {
        setBusy(false);
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

        <button
          onClick={() => google()}
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
          Continue with Google
        </button>

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
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="w-full text-center text-xs text-muted-foreground py-2"
        >
          {mode === "signin"
            ? "New to OpenRun? Create an account"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
