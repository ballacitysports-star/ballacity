import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  APPROVAL_VALIDITY_OPTIONS,
  approvalState,
  fetchHostingApprovals,
  hostingApprovalsKey,
  grantOrgApproval,
  revokeHostingApproval,
} from "@/lib/youth-hosting-approvals";

type Member = { user_id: string; name: string };

/**
 * Organization admins: approve one game at a time for a member to run under the organization, and withdraw
 * approvals. The page never shows or asks for anyone's age. The server decides who can be approved and gives the
 * same refusal for every reason, so this cannot be used to find out a member's age.
 */
export function OrgYouthHostingApprovals({
  orgId,
  members,
  viewerId,
}: {
  orgId: string;
  members: Member[];
  viewerId: string | null;
}) {
  const qc = useQueryClient();
  const approvals = useQuery({
    queryKey: hostingApprovalsKey(viewerId),
    queryFn: fetchHostingApprovals,
  });
  const [memberId, setMemberId] = useState("");
  const [hours, setHours] = useState(168);
  const [managePayments, setManagePayments] = useState(false);
  const names = new Map(members.map((m) => [m.user_id, m.name]));

  const grant = useMutation({
    mutationFn: () =>
      grantOrgApproval({ minorId: memberId, orgId, validHours: hours, managePayments }),
    onSuccess: () => {
      toast.success("Approved. They can publish one game under this organization.");
      setMemberId("");
      void qc.invalidateQueries({ queryKey: hostingApprovalsKey(viewerId) });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save that approval."),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeHostingApproval(id),
    onSuccess: () => {
      toast.success("Approval withdrawn. New sign-ups to that game are closed.");
      void qc.invalidateQueries({ queryKey: hostingApprovalsKey(viewerId) });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Couldn't withdraw that approval."),
  });

  const mine = (approvals.data ?? []).filter(
    (a) => a.org_id === orgId && a.approver_id === viewerId,
  );

  return (
    <section
      className="rounded-2xl border border-border bg-surface p-4 space-y-3"
      aria-labelledby="org-youth-hosting-title"
    >
      <h2
        id="org-youth-hosting-title"
        className="text-xs uppercase tracking-wider font-bold text-muted-foreground"
      >
        Youth hosting approvals
      </h2>
      <p className="text-xs text-muted-foreground">
        Members aged 16–17 can run a game for players under 18 under this organization only with
        your approval, one game at a time. You become the adult responsible for it. You can't
        approve an 18+ game for a minor.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs">
          <span className="mb-1 block font-semibold">Member</span>
          <select
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm"
          >
            <option value="">Choose a member…</option>
            {members
              .filter((m) => m.user_id !== viewerId)
              .map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-semibold">Valid for</span>
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm"
          >
            {APPROVAL_VALIDITY_OPTIONS.map((o) => (
              <option key={o.hours} value={o.hours}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          checked={managePayments}
          onChange={(e) => setManagePayments(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="font-semibold">I will manage payments</span> if this game charges a fee.
          A member under 18 can't collect payments.
        </span>
      </label>
      <button
        type="button"
        disabled={!memberId || grant.isPending}
        onClick={() => grant.mutate()}
        className="w-full rounded-full bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground disabled:opacity-50 sm:w-auto"
      >
        {grant.isPending ? "Saving…" : "Approve one game"}
      </button>

      {approvals.isLoading ? (
        <Skeleton className="h-12 w-full rounded-xl" />
      ) : approvals.error ? (
        <div role="alert" className="text-xs text-destructive">
          Couldn't load approvals.{" "}
          <button type="button" className="underline" onClick={() => void approvals.refetch()}>
            Try again
          </button>
        </div>
      ) : mine.length === 0 ? (
        <p className="text-xs text-muted-foreground">No approvals yet.</p>
      ) : (
        <ul className="space-y-2">
          {mine.map((a) => {
            const state = approvalState(a);
            return (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-background px-3 py-2 text-xs"
              >
                <span className="min-w-0 truncate">
                  <span className="font-semibold">{names.get(a.minor_id) ?? "Member"}</span>
                  {" · "}
                  {state === "ready"
                    ? "Ready"
                    : state === "used"
                      ? "Used"
                      : state === "revoked"
                        ? "Withdrawn"
                        : "Expired"}
                  {a.payment_manager_id ? " · you manage payments" : ""}
                </span>
                {(state === "ready" || state === "used") && (
                  <button
                    type="button"
                    onClick={() => revoke.mutate(a.id)}
                    disabled={revoke.isPending}
                    className="shrink-0 font-semibold text-coral underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    Withdraw
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
