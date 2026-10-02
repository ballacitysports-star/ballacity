import { Link } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { fetchWaiverRequirement, type TeamWaiver } from "@/lib/team-waivers";
import { SignWaiverDialog } from "@/components/team/SignWaiverDialog";
import {
  ROLE_META,
  teamRosterErrorMessage,
  useMyTeamInvites,
  useRespondToTeamInvite,
} from "@/lib/team-roster";
import { useParentMode } from "@/hooks/use-parent-mode";

/**
 * Pending team invitations for the signed-in player.
 *
 * Renders nothing when there are none, so it can sit at the top of any feed or
 * notifications surface without leaving an empty card behind.
 */
export function TeamInvitesInbox({ className = "" }: { className?: string }) {
  const invites = useMyTeamInvites();
  const respond = useRespondToTeamInvite();
  const { user } = useAuth();
  const { isParentMode } = useParentMode();
  const [pending, setPending] = useState<{ inviteId: string; teamName: string; waiver: TeamWaiver } | null>(null);

  const doAccept = (inviteId: string, teamName: string) =>
    respond.mutate(
      { inviteId, accept: true },
      {
        onSuccess: () => toast.success(`You joined ${teamName}`),
        onError: (err) => toast.error(teamRosterErrorMessage(err)),
      },
    );

  const accept = async (inviteId: string, teamId: string, teamName: string) => {
    const req = user ? await fetchWaiverRequirement(teamId, user.id) : null;
    if (req && !req.signed) {
      setPending({ inviteId, teamName, waiver: req.waiver });
      return;
    }
    doAccept(inviteId, teamName);
  };

  if (isParentMode || !invites.data?.length) return null;

  return (
    <div className={`space-y-2 ${className}`}>
      <h3 className="inline-flex items-center gap-2 section-eyebrow text-muted-foreground">
        <Mail className="h-4 w-4" /> Team invites · {invites.data.length}
      </h3>
      {invites.data.map((inv) => (
        <div key={inv.id} className="rounded-2xl border border-lime/40 bg-lime/5 p-3">
          <div className="text-sm font-semibold">
            <Link to="/teams/$teamId" params={{ teamId: inv.teamId }} className="hover:text-lime">
              {inv.teamName}
            </Link>{" "}
            invited you as {ROLE_META[inv.role].label.toLowerCase()}
          </div>
          {inv.message && <p className="mt-1 text-xs text-muted-foreground">“{inv.message}”</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={respond.isPending}
              onClick={() => void accept(inv.id, inv.teamId ?? "", inv.teamName ?? "the team")}
              className="flex-1 rounded-full bg-lime-gradient px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60"
            >
              Accept
            </button>
            <button
              type="button"
              disabled={respond.isPending}
              onClick={() =>
                respond.mutate(
                  { inviteId: inv.id, accept: false },
                  {
                    onSuccess: () => toast.success("Invitation declined"),
                    onError: (err) => toast.error(teamRosterErrorMessage(err)),
                  },
                )
              }
              className="flex-1 rounded-full border border-border bg-surface px-3 py-2 text-xs font-bold text-muted-foreground disabled:opacity-60"
            >
              Decline
            </button>
          </div>
        </div>
      ))}
      <SignWaiverDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        waiver={pending?.waiver ?? null}
        teamName={pending?.teamName ?? ""}
        onSigned={() => pending && doAccept(pending.inviteId, pending.teamName)}
      />
    </div>
  );
}
