import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/hooks/use-auth";
import { getOAuthRedirectUri } from "@/lib/oauth-redirect";
import { waitForAuthSession } from "@/lib/oauth-session";
import { getPostSignInDestination } from "@/lib/post-sign-in-destination";
import {
  peekPostAuthRedirect,
  savePostAuthRedirect,
} from "@/lib/post-auth-redirect";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — OpenRun" }] }),
  component: AuthPage,
});

type GoogleStatus =
  | { kind: "idle" }
  | { kind: "opening" }
  | { kind: "waiting" }
  | { kind: "timeout" }
  | { kind: "error"; message: string };

function AuthPage() {
  const { session } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [completingAuth, setCompletingAuth] = useState(false);
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus>({ kind: "idle" });
  const completingRef = useRef(false);
  const timeoutTimerRef = useRef<number | null>(null);

  const clearTimeoutTimer = () => {
    if (timeoutTimerRef.current !== null) {
      window.clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
  };

  const finishAuthenticatedSession = async (session: NonNullable<Awaited<ReturnType<typeof waitForAuthSession>>>) => {
    if (completingRef.current) return;
    completingRef.current = true;
    clearTimeoutTimer();
    setCompletingAuth(true);
    const target = await getPostSignInDestination(session);
    window.location.assign(target);
  };


  useEffect(() => {
    let cancelled = false;

    const finish = async (session: NonNullable<Awaited<ReturnType<typeof waitForAuthSession>>>) => {
      if (cancelled || completingRef.current) return;
      completingRef.current = true;
      setCompletingAuth(true);
      const target = await getPostSignInDestination(session);
      if (!cancelled) window.location.assign(target);
    };

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) void finish(data.session);
    });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) {
        void finish(session);
      }
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
      clearTimeoutTimer();
    };
  }, []);


  useEffect(() => {
    if (session) void finishAuthenticatedSession(session);
  }, [session]);

  const checkExistingSession = async () => {
    const session = await waitForAuthSession({ timeoutMs: 2_000, intervalMs: 150 });
    if (session) {
      const target = await getPostSignInDestination(session);
      window.location.assign(target);
      return true;
    }
    return false;
  };




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
            emailRedirectTo: window.location.origin,
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
          await finishAuthenticatedSession(data.session);
        } else {
          toast.success("Check your email to confirm your account.");
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
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
        if (data.session) {
          await finishAuthenticatedSession(data.session);
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

  const oauth = async (provider: "google") => {
    setGoogleBusy(true);
    setGoogleStatus({ kind: "opening" });
    try {
      if (!peekPostAuthRedirect()) savePostAuthRedirect("/profile");
      const oauthPromise = lovable.auth.signInWithOAuth(provider, {
        redirect_uri: getOAuthRedirectUri(),
      });
      setGoogleStatus({ kind: "waiting" });
      const firstResult = await Promise.race([
        oauthPromise.then((result) => ({ kind: "oauth" as const, result })),
        waitForAuthSession({ timeoutMs: 20_000, intervalMs: 250 }).then(
          (session) => ({ kind: "session" as const, session }),
        ),
      ]);

      if (firstResult.kind === "session") {
        if (firstResult.session) {
          const target = await getPostSignInDestination(firstResult.session);
          window.location.assign(target);
          return;
        }
        setGoogleStatus({ kind: "timeout" });
        return;
      }

      const result = firstResult.result;
      if (result.error) {
        const message = result.error.message || "Google sign-in failed";
        setGoogleStatus({ kind: "error", message });
        toast.error(message);
        return;
      }
      if (result.redirected) {
        // Full-page redirect is in flight — nothing more to do here.
        return;
      }
      // Popup/web_message flow: session write happens asynchronously.
      // Let the top-level onAuthStateChange / useAuth effect drive navigation,
      // and only escalate to a timeout if nothing lands within 15s.
      setGoogleStatus({ kind: "waiting" });
      clearTimeoutTimer();
      timeoutTimerRef.current = window.setTimeout(() => {
        if (!completingRef.current) setGoogleStatus({ kind: "timeout" });
        timeoutTimerRef.current = null;
      }, 15_000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign-in failed";
      setGoogleStatus({ kind: "error", message });
      toast.error(message);
    } finally {
      setGoogleBusy(false);
    }
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
          onClick={() => oauth("google")}
          disabled={googleBusy || busy}
          aria-busy={googleBusy}
          className="w-full rounded-full border border-border bg-surface px-4 py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {googleBusy ? (
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-foreground"
              aria-hidden
            />
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden>
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.5-5.9 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.6 26.7 36.5 24 36.5c-5.4 0-9.6-3.4-11.3-8.1l-6.5 5C9.6 39.7 16.2 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.2 5.2C40.8 35.6 44 30.2 44 24c0-1.3-.1-2.3-.4-3.5z"/>
            </svg>
          )}
          {googleStatus.kind === "opening"
            ? "Opening Google…"
            : googleStatus.kind === "waiting"
              ? "Finishing sign-in…"
              : completingAuth
                ? "Finishing sign-in…"
              : "Continue with Google"}
        </button>

        <div
          role="status"
          aria-live="polite"
          className="min-h-[1.25rem] text-center text-xs text-muted-foreground"
        >
          {googleStatus.kind === "opening" && "Waiting for the Google window…"}
          {googleStatus.kind === "waiting" && "Confirming your session…"}
        </div>

        {!completingAuth && !session && (googleStatus.kind === "timeout" || googleStatus.kind === "error") && (
          <div
            role="alert"
            className="rounded-2xl border border-border bg-surface p-4 space-y-3"
          >
            <div>
              <p className="text-sm font-bold">
                {googleStatus.kind === "timeout"
                  ? "Sign-in is taking longer than expected"
                  : "Google sign-in failed"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {googleStatus.kind === "timeout"
                  ? "We didn't detect a session yet. If you already approved Google, try checking again — otherwise start over."
                  : googleStatus.message}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {googleStatus.kind === "timeout" && (
                <button
                  onClick={async () => {
                    setGoogleBusy(true);
                    setGoogleStatus({ kind: "waiting" });
                    try {
                      const ok = await checkExistingSession();
                      if (!ok) setGoogleStatus({ kind: "timeout" });
                    } finally {
                      setGoogleBusy(false);
                    }
                  }}
                  disabled={googleBusy}
                  className="rounded-full border border-border bg-background px-4 py-2 text-xs font-bold disabled:opacity-50"
                >
                  Check session
                </button>
              )}
              <button
                onClick={() => {
                  setGoogleStatus({ kind: "idle" });
                  void oauth("google");
                }}
                disabled={googleBusy}
                className="rounded-full bg-lime-gradient px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50"
              >
                Try again
              </button>
              <button
                onClick={() => setGoogleStatus({ kind: "idle" })}
                disabled={googleBusy}
                className="rounded-full px-4 py-2 text-xs font-bold text-muted-foreground underline disabled:opacity-50"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}




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
            disabled={busy || googleBusy}
            className="w-full rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            {busy || completingAuth ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
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
