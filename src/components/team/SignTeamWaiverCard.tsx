import { useState } from "react";
import { CheckCircle2, FileSignature } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignWaiverDialog } from "@/components/team/SignWaiverDialog";
import { usePublishedWaiver, useWaiverSignatures } from "@/lib/team-waivers";
import { useMyTeamRole } from "@/lib/team-roster";
import { useAuth } from "@/hooks/use-auth";

/** Lets a roster member sign the team's current published waiver themselves. */
export function SignTeamWaiverCard({ teamId, teamName }: { teamId: string; teamName: string }) {
  const { user } = useAuth();
  const role = useMyTeamRole(teamId);
  const waiver = usePublishedWaiver(role ? teamId : undefined);
  const sigs = useWaiverSignatures(waiver.data?.id);
  const [open, setOpen] = useState(false);

  if (!user || !role || !waiver.data || sigs.isLoading) return null;
  const signed = (sigs.data ?? []).some((s) => s.signerUserId === user.id);

  return (
    <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
      <div className="min-w-0">
        <div className="inline-flex items-center gap-2 text-sm font-semibold">
          <FileSignature className="h-4 w-4" /> {waiver.data.title}
        </div>
        <p className="text-xs text-muted-foreground">
          {signed ? "You've signed the current team waiver." : "Please sign the team waiver."}
        </p>
      </div>
      {signed ? (
        <span className="inline-flex items-center gap-1 text-xs text-primary">
          <CheckCircle2 className="h-4 w-4" /> Signed
        </span>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          Sign team waiver
        </Button>
      )}
      <SignWaiverDialog
        open={open}
        onOpenChange={setOpen}
        waiver={waiver.data}
        teamName={teamName}
        onSigned={() => sigs.refetch()}
      />
    </div>
  );
}
