import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { RolePicker } from "@/components/RolePicker";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { PrimaryCTA } from "@/components/PrimaryCTA";
import { LoadingState } from "@/components/ui/loading-state";
import {
  type AccountType,
  type SetupId,
  accountTypeForSetup,
  canChooseRole,
  clearPendingAccountType,
  hrefForSetup,
  isAccountType,
  setAccountTypeForCurrentUser,
} from "@/lib/account-type";
import { useMyAgeStatus } from "@/lib/age-verification";
import { trackEvent } from "@/lib/analytics";

/** How long the cards wait for the age answer before showing without Parent / Guardian. */
const AGE_WAIT_MS = 3000;

/**
 * The profile-type step. Rendered either as its own page
 * (/onboarding/account-type) or inline by the root gate.
 *
 * One selection, then straight to that setup: Player to the sport and position
 * wizard, Parent / Guardian to Add your child, Team / Coach to the team or coach
 * setup, Facility / Venue to the facility setup. There is no second question.
 *
 * `onResolved` fires after a type is saved, with the setup they chose (which is
 * what decides where they go; the type is only what is stored);
 * `onAlreadySet` fires when the account already has a type. When omitted, the
 * screen navigates itself.
 */
export function AccountTypeScreen({
  onResolved,
  onAlreadySet,
}: {
  onResolved?: (type: AccountType, setup: SetupId) => void;
  onAlreadySet?: () => void;
}) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [choice, setChoice] = useState<SetupId | null>(null);
  // Age is settled before this screen is reachable. Parent / Guardian is offered
  // to adults only, so the cards wait for the answer rather than reflow when it
  // comes — but not for long: a stalled request must not hold the picker back.
  const { data: ageStatus, isPending: agePending } = useMyAgeStatus(!!user);
  const allowParent = canChooseRole("parent", ageStatus?.cohort);
  const [ageWaitOver, setAgeWaitOver] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setAgeWaitOver(true), AGE_WAIT_MS);
    return () => window.clearTimeout(t);
  }, []);
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
      const type = accountTypeForSetup(choice);
      await setAccountTypeForCurrentUser(type);
      // Parents are stored as "player"; remember the role so they're labelled as guardians.
      if (choice === "child") {
        await supabase.auth.updateUser({ data: { is_guardian: true } }).catch(() => undefined);
      }
      clearPendingAccountType();
      trackEvent("select_role", { role: choice, account_type: type });
      toast.success("Account type set.");
      if (onResolved) {
        onResolved(type, choice);
        setBusy(false);
      } else {
        window.location.replace(hrefForSetup(choice));
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

  if (loading || !user || !checked || (agePending && !ageWaitOver)) {
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
      description="Pick what fits you now. You can add other profiles later and switch between them anytime."
      footer={
        <button type="button" onClick={signOut} className="underline-offset-2 hover:underline">
          Sign out
        </button>
      }
    >
      <div className="space-y-5">
        <RolePicker value={choice} onChange={setChoice} heading={false} allowParent={allowParent} />
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
