import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { useEffect, useState } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/account/security")({
  head: () =>
    pageHead({
      path: "/account/security",
      title: "Security — ballaCity",
      description: "Manage sign-in methods, password, and connected accounts.",
      noindex: true,
    }),
  component: AccountSecurityPage,
});

function AccountSecurityPage() {
  const nav = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setUser(data.user);
      setEmail(data.user?.email ?? "");
      setChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      if (session?.user?.email) setEmail((prev) => prev || session.user.email!);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const providers = (user?.app_metadata?.providers as string[] | undefined) ?? [];
  const hasPassword = providers.includes("email");
  const hasGoogle = providers.includes("google");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !user) return;
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match.");
      return;
    }
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      toast.error("Email is required.");
      return;
    }
    setBusy(true);
    try {
      const updates: { password: string; email?: string } = { password };
      if (trimmedEmail.toLowerCase() !== (user.email ?? "").toLowerCase()) {
        updates.email = trimmedEmail;
      }
      const { error } = await supabase.auth.updateUser(updates);
      if (error) throw error;
      toast.success(
        hasPassword
          ? "Password updated."
          : `Email sign-in enabled for ${trimmedEmail}. You can now sign in with your password.`,
      );
      nav({ to: "/profile" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update credentials");
    } finally {
      setBusy(false);
    }
  };

  if (!checked) return null;

  if (!user) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md sm:max-w-2xl lg:max-w-4xl flex-col items-center justify-center px-6 text-center">
        <h1 className="font-display text-2xl font-bold">Sign in required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in with Google first, then come back here to add an email password.
        </p>
        <Link
          to="/auth"
          className="mt-6 inline-flex rounded-full bg-lime-gradient px-6 py-3 text-sm font-bold text-primary-foreground"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md sm:max-w-2xl lg:max-w-4xl min-h-screen flex flex-col pb-12">
      <header className="flex items-center gap-2 px-4 py-3">
        <Link
          to="/profile"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-display text-lg font-bold">Account security</h1>
      </header>

      <div className="px-4 mt-4 space-y-5">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2 text-sm font-bold">
            <ShieldCheck className="h-4 w-4 text-lime" /> Sign-in methods
          </div>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            <li>Google: {hasGoogle ? "Linked" : "Not linked"}</li>
            <li>Email + password: {hasPassword ? "Enabled" : "Not set up yet"}</li>
          </ul>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {hasPassword
              ? "Update the password used for email sign-in. Google sign-in keeps working."
              : "Set an email and password. Afterwards you can sign in with either Google or email/password."}
          </p>
          <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
          />
          <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {hasPassword ? "New password" : "Password"}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={hasPassword ? "New password" : "Choose a password"}
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
            {busy ? "Saving…" : hasPassword ? "Update password" : "Enable email sign-in"}
          </button>
          {email.trim().toLowerCase() !== (user.email ?? "").toLowerCase() && (
            <p className="text-xs text-muted-foreground">
              Changing the email may require you to confirm it from your inbox before email sign-in
              works.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
