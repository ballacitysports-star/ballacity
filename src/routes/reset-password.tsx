import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/user-error";
import { supabase } from "@/integrations/supabase/client";

/**
 * What a failed password change reads as. The two refusals a person can fix get their own words (Supabase Auth names
 * them in `code`); anything else reads as userErrorMessage reads it (an expired reset link reads as the session
 * sentence), never as the raw text.
 */
function passwordErrorMessage(err: unknown): string {
  const code = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  if (code === "same_password") return "Choose a password you haven't used here before.";
  if (code === "weak_password") {
    return "That password is too easy to guess. Choose a longer one with a mix of letters and numbers.";
  }
  return userErrorMessage(err, "Couldn't update your password. Please try again.");
}

export const Route = createFileRoute("/reset-password")({
  head: () =>
    pageHead({
      path: "/reset-password",
      title: "Reset your password — BallaCity",
      description: "Set a new password for your BallaCity account.",
      noindex: true,
    }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Supabase recovery link sets a recovery session and fires PASSWORD_RECOVERY.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    // Also handle case where session is already established on mount.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated. You're signed in.");
      nav({ to: "/profile" });
    } catch (err) {
      toast.error(passwordErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-shell-narrow min-h-dvh flex flex-col pb-12">
      <header className="flex items-center gap-2 px-4 py-3">
        <Link
          to="/auth"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="bar-title">Set a new password</h1>
      </header>

      <div className="px-4 mt-6 space-y-5">
        {!ready ? (
          <p className="text-sm text-muted-foreground text-center">
            Open this page from the reset link in your email. If you just clicked the link, give it
            a moment to verify…
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Choose a new password. You'll be able to sign in with email + password going forward
              (Google sign-in keeps working too).
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password"
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
            />
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm password"
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
