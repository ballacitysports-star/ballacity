import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AccountTypePicker } from "@/components/AccountTypePicker";
import { type AccountType, isAccountType } from "@/lib/account-type";

export const Route = createFileRoute("/onboarding/account-type")({
  head: () => ({ meta: [{ title: "Choose account type — OpenRun" }] }),
  component: OnboardingAccountTypePage,
});

function OnboardingAccountTypePage() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const [current, setCurrent] = useState<AccountType | null>(null);
  const [pick, setPick] = useState<AccountType | null>(null);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      nav({ to: "/auth" });
      return;
    }
    let cancelled = false;
    supabase
      .from("profiles")
      .select("account_type")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const t = (data as { account_type?: string } | null)?.account_type;
        if (isAccountType(t)) {
          setCurrent(t);
          setPick(t);
        }
        setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user, loading, nav]);

  const save = async () => {
    if (!pick || busy) return;
    setBusy(true);
    try {
      await setAccountTypeForCurrentUser(pick);
      toast.success("Account type saved.");
      // Route to the correct linked-profile creation flow for non-player types.
      // Player accounts already have their linked row (public.profiles) from the
      // handle_new_user trigger, so they go straight to the feed.
      if (pick === "team") {
        nav({ to: "/teams/create" });
      } else if (pick === "trainer") {
        nav({ to: "/trainers/create" });
      } else if (pick === "gym") {
        nav({ to: "/orgs/create" });
      } else {
        nav({ to: "/feed" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save account type");
    } finally {
      setBusy(false);
    }
  };

  if (loading || !checked) return null;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-8">
      <div className="text-center">
        <div className="font-display text-2xl font-bold">Welcome to OpenRun</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Set your account type to continue. This is permanent.
        </p>
      </div>
      <div className="mt-8">
        <AccountTypePicker
          value={pick}
          onChange={setPick}
          title="I am a…"
          subtitle="Each type gets a tailored profile. To use another type, create a separate account."
        />
      </div>
      {current && current !== pick && current !== "player" ? (
        <p className="mt-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
          Heads up: your account currently owns a {current}. Switching to {pick} will hide those from
          your profile — they'll remain in the database but you won't be able to manage them from
          this account.
        </p>
      ) : null}
      <button
        onClick={save}
        disabled={!pick || busy}
        className="mt-6 w-full rounded-full bg-lime-gradient px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Saving…" : "Continue"}
      </button>
    </div>
  );
}
