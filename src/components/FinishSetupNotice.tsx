import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ACCOUNT_TYPE_META, type AccountType, type HostedAccountType } from "@/lib/account-type";
import { continueAsPlayer, myProfilesKey } from "@/lib/account-profiles";

/**
 * Shown on a team/trainer/gym creation screen the user was routed to because
 * their registration is unfinished. Explains why they are here and lets them
 * bail out to a plain player account instead of being stuck.
 */
export function FinishSetupNotice({ kind }: { kind: HostedAccountType }) {
  const meta = ACCOUNT_TYPE_META[kind];
  const label = meta.label.toLowerCase();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  const switchToPlayer = async () => {
    setBusy(true);
    try {
      await continueAsPlayer();
      await qc.invalidateQueries({ queryKey: myProfilesKey(user?.id), refetchType: "all" });
      toast.success("You're set up as a player");
      navigate({ to: "/feed", replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not switch to a player account");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-lime/40 bg-lime/10 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-lime" aria-hidden />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-bold">Finish this to use your {label} account</p>
          <p className="mt-1 text-muted-foreground">
            You signed up as a {label}, but your {label} profile hasn&apos;t been created yet — so
            the app still shows you as a player. Create it to switch over.
          </p>
          <button
            type="button"
            onClick={switchToPlayer}
            disabled={busy}
            className="mt-3 text-xs font-bold underline underline-offset-2 disabled:opacity-50"
          >
            Continue as a player instead
          </button>
        </div>
      </div>
    </div>
  );
}
