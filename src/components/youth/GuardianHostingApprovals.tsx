import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import {
  APPROVAL_VALIDITY_OPTIONS,
  approvalState,
  fetchHostingApprovals,
  hostingApprovalsKey,
  teenChildrenKey,
  grantGuardianApproval,
  revokeHostingApproval,
  type HostingApproval,
} from "@/lib/youth-hosting-approvals";

type Child = { child_user_id: string; display_name: string | null; age_cohort: string };

async function fetchTeenChildren(): Promise<Child[]> {
  const { data, error } = await supabase.rpc("guardian_children_overview" as never);
  if (error) throw error;
  return ((data ?? []) as unknown as Child[]).filter((c) => c.age_cohort === "teen_16_17");
}

const STATE_LABEL = {
  ready: "Ready to use",
  used: "Used",
  revoked: "Withdrawn",
  expired: "Expired",
} as const;

/**
 * Guardian dashboard: approve one hosted game at a time for a 16-17 year old, with or without taking on payment
 * responsibility, and withdraw approvals. An approval never makes an 18+ game possible and is single-use.
 */
export function GuardianHostingApprovals({ viewerId }: { viewerId: string }) {
  const qc = useQueryClient();
  const kids = useQuery({ queryKey: teenChildrenKey(viewerId), queryFn: fetchTeenChildren });
  const approvals = useQuery({
    queryKey: hostingApprovalsKey(viewerId),
    queryFn: fetchHostingApprovals,
  });
  const [hours, setHours] = useState<number>(168);
  const [managePayments, setManagePayments] = useState(false);

  const grant = useMutation({
    mutationFn: (minorId: string) =>
      grantGuardianApproval({ minorId, validHours: hours, managePayments }),
    onSuccess: () => {
      toast.success("Approved. They can publish one game with it.");
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

  if (kids.isLoading || approvals.isLoading) {
    return (
      <section className="mt-6" role="status" aria-label="Loading hosting approvals">
        <Skeleton className="h-24 w-full rounded-xl" />
      </section>
    );
  }
  if (kids.error || approvals.error) {
    return (
      <section
        className="mt-6 rounded-2xl border border-destructive/40 bg-surface p-4 text-sm"
        role="alert"
      >
        <p className="font-semibold text-destructive">Couldn't load hosting approvals.</p>
        <button
          type="button"
          onClick={() => {
            void kids.refetch();
            void approvals.refetch();
          }}
          className="mt-2 rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground"
        >
          Try again
        </button>
      </section>
    );
  }
  const teens = kids.data ?? [];
  if (teens.length === 0) return null; // only guardians of a 16-17 year old see this

  const mine = approvals.data ?? [];
  return (
    <section className="mt-6" aria-labelledby="hosting-approvals-title">
      <h2
        id="hosting-approvals-title"
        className="flex items-center gap-2 font-display text-sm font-bold"
      >
        <ShieldCheck className="h-4 w-4" aria-hidden /> Hosting approvals
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        A 16–17 year old can host a game that includes players under 18 only with your approval, one
        game at a time. An approval never allows an 18+ game, and it can be withdrawn at any time.
      </p>

      <div className="mt-3 grid gap-2 rounded-xl border border-border bg-surface p-3 text-xs sm:grid-cols-2">
        <label className="flex items-center justify-between gap-2">
          <span className="font-semibold">Valid for</span>
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="rounded-lg border border-border bg-background px-2 py-1.5"
            aria-label="How long the approval is valid"
          >
            {APPROVAL_VALIDITY_OPTIONS.map((o) => (
              <option key={o.hours} value={o.hours}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={managePayments}
            onChange={(e) => setManagePayments(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="font-semibold">I will manage payments</span> if this game charges a
            fee. A teen can't collect payments; you would be the only person players pay.
          </span>
        </label>
      </div>

      <div className="mt-3 space-y-3">
        {teens.map((k) => {
          const list = mine.filter((a) => a.minor_id === k.child_user_id);
          return (
            <div key={k.child_user_id} className="rounded-xl border border-border bg-surface p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-semibold">{k.display_name ?? "Your teen"}</p>
                <button
                  type="button"
                  onClick={() => grant.mutate(k.child_user_id)}
                  disabled={grant.isPending}
                  className="shrink-0 rounded-full bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50"
                >
                  {grant.isPending ? "Saving…" : "Approve one game"}
                </button>
              </div>
              {list.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">No approvals yet.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {list.map((a) => (
                    <ApprovalRow
                      key={a.id}
                      a={a}
                      onRevoke={() => revoke.mutate(a.id)}
                      busy={revoke.isPending}
                    />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ApprovalRow({
  a,
  onRevoke,
  busy,
}: {
  a: HostingApproval;
  onRevoke: () => void;
  busy: boolean;
}) {
  const state = approvalState(a);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background px-3 py-2 text-xs">
      <div className="min-w-0">
        <span className="font-semibold">{STATE_LABEL[state]}</span>
        <span className="text-muted-foreground">
          {" · "}
          {a.kind === "organization" ? "from a club administrator" : "from you"}
          {state === "ready" ? ` · expires ${new Date(a.expires_at).toLocaleString()}` : ""}
          {a.payment_manager_id ? " · payments managed by an adult" : ""}
        </span>
        {a.game_id && (
          <>
            {" · "}
            <Link
              to="/games/$gameId"
              params={{ gameId: a.game_id }}
              className="font-semibold text-primary underline"
            >
              View game
            </Link>
            {a.payment_manager_id && state !== "revoked" && (
              <>
                {" · "}
                <Link
                  to="/games/$gameId/payment-setup"
                  params={{ gameId: a.game_id }}
                  className="font-semibold text-primary underline"
                >
                  Set up payments
                </Link>
              </>
            )}
          </>
        )}
      </div>
      {(state === "ready" || state === "used") && (
        <button
          type="button"
          onClick={onRevoke}
          disabled={busy}
          className="text-xs font-semibold text-coral underline-offset-2 hover:underline disabled:opacity-50"
        >
          Withdraw
        </button>
      )}
    </li>
  );
}
