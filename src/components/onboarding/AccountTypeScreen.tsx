import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AccountTypePicker } from "@/components/AccountTypePicker";
import {
  type AccountType,
  clearPendingAccountType,
  isAccountType,
  setAccountTypeForCurrentUser,
} from "@/lib/account-type";

export function destinationForAccountType(t: AccountType): string {
  switch (t) {
    case "team":
      return "/teams/create";
    case "trainer":
      return "/trainers/create";
    case "gym":
      return "/orgs/create";
    case "player":
    default:
      // Players go through "who is this for?" first (§4 step 2). That is the
      // fork deciding whether this account gets the owner's own profile, a
      // child's, or both, and it has to come before the profile wizard —
      // which asks about one athlete and would otherwise assume it is them.
      return "/onboarding/setup-for";
  }
}

/**
 * The profile-type step. Rendered either as its own page
 * (/onboarding/account-type) or inline by the root gate.
 *
 * `onResolved` fires after a type is saved; `onAlreadySet` fires when the
 * account already has one. When omitted, the screen navigates itself.
 */
export function AccountTypeScreen({
  onResolved,
  onAlreadySet,
}: {
  onResolved?: (type: AccountType) => void;
  onAlreadySet?: () => void;
}) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [choice, setChoice] = useState<AccountType | null>(null);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);

  // If the user already has an account_type, bounce out to the app.
  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("account_type")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const t = (data as { account_type?: string } | null)?.account_type;
      if (isAccountType(t)) {
        if (onAlreadySet) onAlreadySet();
        else navigate({ to: "/feed", replace: true });
      } else {
        setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, navigate]);

  // Not signed in — bounce to /auth.
  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [loading, user, navigate]);

  const submit = async () => {
    if (!choice || busy) return;
    setBusy(true);
    try {
      await setAccountTypeForCurrentUser(choice);
      clearPendingAccountType();
      toast.success("Account type set.");
      if (onResolved) {
        onResolved(choice);
        setBusy(false);
      } else {
        window.location.replace(destinationForAccountType(choice));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
      setBusy(false);
    }
  };

  const signOut = async () => {
    // Device-level sign-out — see signOut() in @/hooks/use-auth for why
    // this is `local` and not Supabase's default `global` scope.
    await supabase.auth.signOut({ scope: "local" });
    navigate({ to: "/auth", replace: true });
  };

  if (loading || !user || !checked) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <LoadingState label="Loading your account…" />
      </div>
    );
  }

  return (
    <OnboardingShell
      step={2}
      steps={2}
      title="Where do you want to start?"
      description="Pick what fits you now. You can add team, trainer, and gym profiles later and switch between them anytime."
      footer={
        <button
          type="button"
          onClick={signOut}
          className="underline-offset-2 hover:underline"
        >
          Sign out
        </button>
      }
    >
      <div className="space-y-5">
        <AccountTypePicker value={choice} onChange={setChoice} heading={false} />
        <p className="rounded-2xl border border-border bg-surface p-3 text-xs text-muted-foreground">
          This is just your starting point. You can add other profiles later and switch between them
          anytime.
        </p>
        <PrimaryCTA type="button" disabled={!choice} loading={busy} onClick={submit}>
          Continue
        </PrimaryCTA>
      </div>
    </OnboardingShell>
  );
}
