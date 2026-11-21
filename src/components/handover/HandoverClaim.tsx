import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { completeManagedHandover, lookupManagedHandover } from "@/lib/managed-handover.functions";
import { handoverErrorMessage } from "@/lib/managed-handover";
import { takeParkedGuardianSession } from "@/lib/managed-session";
import { resetPerUserClientState } from "@/lib/per-user-state";
import { userErrorMessage } from "@/lib/user-error";

type Phase = "confirm" | "working" | "password" | "saved" | "signin";

const MIN_PASSWORD = 8;

/** What a failed password change reads as; never the raw text. */
function passwordMessage(err: unknown): string {
  const code = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  if (code === "same_password") return "Choose a password you haven't used here before.";
  if (code === "weak_password") {
    return "That password is too easy to guess. Choose a longer one with a mix of letters and numbers.";
  }
  return userErrorMessage(err, "Couldn't save your password. Please try again.");
}

/**
 * The page behind the link in the handover email (docs/managed-account-handover.md). Open to anyone holding the link
 * (the token is the credential), so it shows only who is handing over which account and a masked address, never the
 * address itself or anything else of the account.
 *
 * Confirming does everything on the server (managed-handover.server.ts): their address goes on the sign-in record, the
 * account stops being managed, the family link ends. The server then hands back a one-time sign-in so the adult can
 * choose a password here; the password goes straight to the sign-in service and never through our server. If that last
 * step fails the account is already theirs, and "Forgot password" on their own address finishes the job.
 */
export function HandoverClaim({ token }: { token: string }) {
  const lookupFn = useServerFn(lookupManagedHandover);
  const completeFn = useServerFn(completeManagedHandover);
  const lookup = useQuery({
    queryKey: ["handover-lookup", token],
    queryFn: () => lookupFn({ data: { token } }),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const [phase, setPhase] = useState<Phase>("confirm");
  const [mine, setMine] = useState(false);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const confirm = async () => {
    if (busy || !mine) return;
    setBusy(true);
    setFailure(null);
    setPhase("working");
    try {
      const done = await completeFn({ data: { token, confirmed: true } });
      if (!done.recoveryTokenHash) {
        setPhase("signin");
        return;
      }
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: done.recoveryTokenHash,
        type: "recovery",
      });
      if (error || !data.user) {
        setPhase("signin");
        return;
      }
      // A guardian's parked session on this device is not this person's: drop it (the key only, never revoke here).
      takeParkedGuardianSession();
      await resetPerUserClientState();
      setPhase("password");
    } catch (e) {
      setFailure(
        handoverErrorMessage(e, "Something went wrong and nothing was changed. Please try again."),
      );
      setPhase("confirm");
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password.length < MIN_PASSWORD) {
      toast.error(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== again) {
      toast.error("The two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPhase("saved");
    } catch (err) {
      toast.error(passwordMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const guardian = lookup.data && lookup.data.valid ? lookup.data.guardianName : null;

  return (
    <div className="page-shell-narrow flex min-h-dvh flex-col px-4 pb-12 pt-8">
      <h1 className="bar-title">Take over your BallaCity account</h1>

      {lookup.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground" role="status">
          Checking your link…
        </p>
      ) : phase === "signin" ? (
        <div className="mt-6 space-y-3" role="status">
          <p className="text-sm">
            Your account is yours now, and the family link has ended. We couldn&apos;t sign you in
            from here, so sign in with your email address. Choose &quot;Forgot password&quot; to set
            your password.
          </p>
          <Button asChild>
            <Link to="/auth">Go to sign in</Link>
          </Button>
        </div>
      ) : phase === "saved" ? (
        <div className="mt-6 space-y-3" role="status">
          <p className="text-sm">
            Done. This account is yours: sign in with your email address and this password whenever
            you like.
          </p>
          <Button asChild>
            <a href="/profile">Open my account</a>
          </Button>
        </div>
      ) : phase === "password" ? (
        <form onSubmit={savePassword} className="mt-6 space-y-3">
          <p className="text-sm text-muted-foreground">
            You&apos;re in, and the account is yours. Choose a password so you can sign in again.
          </p>
          <label
            className="block text-xs font-semibold text-muted-foreground"
            htmlFor="handover-password"
          >
            New password
          </label>
          <input
            id="handover-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            required
            className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
          />
          <label
            className="block text-xs font-semibold text-muted-foreground"
            htmlFor="handover-password-again"
          >
            Type it again
          </label>
          <input
            id="handover-password-again"
            type="password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            required
            className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
          />
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Saving…" : "Save password"}
          </Button>
        </form>
      ) : lookup.data && lookup.data.valid ? (
        <div className="mt-6 space-y-4">
          <p className="text-sm">
            {guardian ? guardian : "The person who manages your account"} has been managing the
            BallaCity account <span className="font-semibold">{lookup.data.childName}</span> for you
            and started handing it over.
          </p>
          <p className="text-sm text-muted-foreground">
            If you continue, this account becomes yours. You sign in with{" "}
            {lookup.data.emailMasked ?? "your email address"} and a password you choose. Your games,
            teams and videos stay as they are, and the person who managed it can no longer see it or
            change its settings. If this isn&apos;t what you expected, close this page: nothing
            changes unless you continue.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={mine}
              onChange={(e) => setMine(e.target.checked)}
              className="mt-1"
            />
            <span>This is my account, and I want to take it over.</span>
          </label>
          {failure ? (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          ) : null}
          <Button
            onClick={confirm}
            disabled={!mine || busy || phase === "working"}
            className="w-full"
          >
            {phase === "working" ? "Setting up your account…" : "Take over my account"}
          </Button>
        </div>
      ) : (
        <div className="mt-6 space-y-3" role="status">
          <p className="text-sm">
            {handoverErrorMessage(
              lookup.data && !lookup.data.valid ? lookup.data.code : "HANDOVER_INVALID",
              handoverErrorMessage("HANDOVER_INVALID"),
            )}
          </p>
          <Button asChild variant="outline">
            <Link to="/auth">Go to sign in</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
