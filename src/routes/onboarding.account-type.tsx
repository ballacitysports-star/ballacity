import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
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

export const Route = createFileRoute("/onboarding/account-type")({
  head: () =>
    pageHead({
      path: "/onboarding/account-type",
      title: "Choose your profile type — ballaCity",
      description: "Start as a player, team, trainer, or gym — you can add more profiles later.",
      noindex: true,
    }),
  component: OnboardingAccountTypePage,
});

function destinationFor(t: AccountType): string {
  switch (t) {
    case "team":
      return "/teams/create";
    case "trainer":
      return "/trainers/create";
    case "gym":
      return "/orgs/create";
    case "player":
    default:
      return "/onboarding/welcome";
  }
}

function OnboardingAccountTypePage() {
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
        navigate({ to: "/feed", replace: true });
      } else {
        setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
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
      window.location.replace(destinationFor(choice));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
      setBusy(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  if (loading || !user || !checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-lg space-y-6">
        <AccountTypePicker value={choice} onChange={setChoice} />
        <div className="rounded-lg border border-border bg-surface p-3 text-xs text-muted-foreground">
          This is just your starting point. You can add other profiles later and switch between
          them anytime.
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={!choice || busy}
            onClick={submit}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Continue"}
          </button>
          <button
            type="button"
            onClick={signOut}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
