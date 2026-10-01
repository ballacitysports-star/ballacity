import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import {
  ROLE_META,
  teamRosterErrorMessage,
  useMyTeamInvites,
  useRespondToTeamInvite,
} from "@/lib/team-roster";
import { useSignTeamWaiver, teamWaiverErrorMessage } from "@/lib/team-waivers";

/**
 * Pending team invitations for the signed-in player.
 *
 * Renders nothing when there are none, so it can sit at the top of any feed or
 * notifications surface without leaving an empty card behind.
 */
export function TeamInvitesInbox({ className = "" }: { className?: string }) {
  const invites = useMyTeamInvites();
  const respond = useRespondToTeamInvite();
  // Which invite's Accept most recently hit WAIVER_REQUIRED, if any — swaps
  // that one card's Accept button for a "sign, then join" affordance instead
  // of just leaving the user with a toast and nothing to do about it.
  const [waiverNeededFor, setWaiverNeededFor] = useState<string | null>(null);
  const signWaiver = useSignTeamWaiver(
    invites.data?.find((i) => i.id === waiverNeededFor)?.teamId ?? "",
  );

  if (!invites.data?.length) return null;

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
          {waiverNeededFor === inv.id ? (
            <p className="mt-2 text-xs font-medium text-coral">
              This team requires a signed waiver before you can join.
            </p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={respond.isPending || signWaiver.isPending}
              onClick={() => {
                if (waiverNeededFor === inv.id) {
                  signWaiver.mutate(
                    { waiverId: inv.id },
                    {
                      onError: (err) => toast.error(teamWaiverErrorMessage(err)),
                      onSuccess: () =>
                        respond.mutate(
                          { inviteId: inv.id, accept: true },
                          {
                            onSuccess: () => {
                              setWaiverNeededFor(null);
                              toast.success(`You joined ${inv.teamName}`);
                            },
                            onError: (err) => toast.error(teamRosterErrorMessage(err)),
                          },
                        ),
                    },
                  );
                  return;
                }
                respond.mutate(
                  { inviteId: inv.id, accept: true },
                  {
                    onSuccess: () => toast.success(`You joined ${inv.teamName}`),
                    onError: (err) => {
                      const msg = err instanceof Error ? err.message : String(err);
                      if (msg.includes("WAIVER_REQUIRED")) setWaiverNeededFor(inv.id);
                      toast.error(teamRosterErrorMessage(err));
                    },
                  },
                );
              }}
              className="flex-1 rounded-full bg-lime-gradient px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-60"
            >
              {waiverNeededFor === inv.id ? "Sign waiver & join" : "Accept"}
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
    </div>
  );
}
