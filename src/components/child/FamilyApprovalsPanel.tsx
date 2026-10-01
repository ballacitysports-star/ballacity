import { Link, useRouterState } from "@tanstack/react-router";
import { BellRing, Clock } from "lucide-react";
import { toast } from "sonner";
import { useFamilyApprovals, type FamilyApproval } from "@/lib/family-approvals";
import { useGuardianApproveTeamInvite, teamRosterErrorMessage } from "@/lib/team-roster";
import { guardianApproveJoinRequest } from "@/lib/payments";
import { useSignTeamWaiver, teamWaiverErrorMessage } from "@/lib/team-waivers";

/** The inline Approve / Decline / Sign row for an item that carries one. */
function ApprovalAction({ approval }: { approval: FamilyApproval }) {
  const action = approval.approveAction!;
  const approveInvite = useGuardianApproveTeamInvite();
  const signWaiver = useSignTeamWaiver(action.teamId ?? "");

  if (action.kind === "team_invite") {
    return (
      <div className="mt-2 flex gap-2">
        <button
          onClick={() =>
            approveInvite.mutate(
              { inviteId: action.id, approve: true },
              {
                onSuccess: () => toast.success("Invite approved"),
                onError: (e) => toast.error(teamRosterErrorMessage(e)),
              },
            )
          }
          disabled={approveInvite.isPending}
          className="rounded-full bg-lime-gradient px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
        >
          Approve
        </button>
        <button
          onClick={() =>
            approveInvite.mutate(
              { inviteId: action.id, approve: false },
              {
                onSuccess: () => toast.success("Invite declined"),
                onError: (e) => toast.error(teamRosterErrorMessage(e)),
              },
            )
          }
          disabled={approveInvite.isPending}
          className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-bold disabled:opacity-50"
        >
          Decline
        </button>
      </div>
    );
  }

  if (action.kind === "join_request") {
    return (
      <div className="mt-2 flex gap-2">
        <button
          onClick={async () => {
            try {
              await guardianApproveJoinRequest(action.id, true);
              toast.success("Request approved");
            } catch (e) {
              toast.error(teamRosterErrorMessage(e));
            }
          }}
          className="rounded-full bg-lime-gradient px-3 py-1.5 text-xs font-bold text-primary-foreground"
        >
          Approve
        </button>
        <button
          onClick={async () => {
            try {
              await guardianApproveJoinRequest(action.id, false);
              toast.success("Request declined");
            } catch (e) {
              toast.error(teamRosterErrorMessage(e));
            }
          }}
          className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-bold"
        >
          Decline
        </button>
      </div>
    );
  }

  // waiver — a single deliberate button, labeled as the attestation itself,
  // the same one-click-after-reading-the-label convention players.add.tsx's
  // own guardian-attests checkbox already uses.
  return (
    <button
      onClick={() =>
        signWaiver.mutate(
          { waiverId: action.id, onBehalfOf: approval.childUserId ?? undefined, attested: true },
          {
            onSuccess: () => toast.success("Waiver signed"),
            onError: (e) => toast.error(teamWaiverErrorMessage(e)),
          },
        )
      }
      disabled={signWaiver.isPending || !approval.childUserId}
      className="mt-2 rounded-full bg-lime-gradient px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
    >
      Sign on their behalf
    </button>
  );
}

/**
 * One shared place where every guardian-facing approval shows up, whatever
 * feature raised it — consent, family invitations, data requests, or a
 * child's pending team invite, game request or team waiver.
 */
export function FamilyApprovalsPanel() {
  const { approvals, actionNeeded, isLoading } = useFamilyApprovals();
  // The panel lives on /parent, and several items point there because that is
  // where they lead from a notification. Rendering "Review consent" as a link
  // to the page you are already reading is a dead end, so drop it here.
  const here = useRouterState({ select: (s) => s.location.pathname });
  if (isLoading || approvals.length === 0) return null;

  return (
    <section className="mt-4 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        {actionNeeded.length > 0 ? (
          <BellRing className="h-4 w-4 text-primary" aria-hidden />
        ) : (
          <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
        )}
        <h2 className="text-sm font-bold">
          {actionNeeded.length > 0
            ? `${actionNeeded.length} thing${actionNeeded.length === 1 ? "" : "s"} need you`
            : "Waiting on others"}
        </h2>
      </div>

      <ul className="mt-3 space-y-2">
        {approvals.map((a) => (
          <li
            key={a.id}
            className={`rounded-xl border p-3 text-xs ${
              a.urgency === "action_needed"
                ? "border-primary/40 bg-primary/5"
                : "border-border bg-background"
            }`}
          >
            <div className="text-sm font-semibold capitalize">{a.title}</div>
            <p className="mt-1 text-muted-foreground">{a.detail}</p>
            {a.approveAction ? (
              <ApprovalAction approval={a} />
            ) : a.actionLabel && a.actionTo && a.actionTo !== here ? (
              <Link
                to={a.actionTo}
                className="mt-2 inline-block font-semibold text-primary underline"
              >
                {a.actionLabel}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
