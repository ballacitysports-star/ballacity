import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Waiting = { child_user_id: string; team_id: string; team_name: string | null };

export const teamReapprovalsKey = (viewerId: string) => ["guardian-team-reapprovals", viewerId];

/**
 * Guardian dashboard: a team membership approved by someone who is no longer the child's verified guardian (after a guardian change)
 * stops counting for team messaging. A current verified guardian re-approves it here, in place (SEC-7); the database checks the
 * guardian link, records it in the family activity log and notifies the child's guardians.
 */
export function GuardianTeamReapprovals({
  viewerId,
  childNames,
}: {
  viewerId: string;
  /** child user id -> first name, from the dashboard's own data */
  childNames: Record<string, string>;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: teamReapprovalsKey(viewerId),
    queryFn: async (): Promise<Waiting[]> => {
      const { data, error } = await supabase.rpc("guardian_team_reapprovals" as never);
      if (error) throw error;
      return (data ?? []) as unknown as Waiting[];
    },
  });
  const approve = useMutation({
    mutationFn: async (v: { teamId: string; childId: string }) => {
      const { error } = await supabase.rpc(
        "guardian_reapprove_team_membership" as never,
        { _team: v.teamId, _child: v.childId } as never,
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Approved. Team messages work again.");
      void qc.invalidateQueries({ queryKey: teamReapprovalsKey(viewerId) });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save that approval."),
  });

  const rows = q.data ?? [];
  if (q.isLoading || q.error || rows.length === 0) return null;

  return (
    <section className="mt-6" aria-labelledby="team-reapprovals-title">
      <h2
        id="team-reapprovals-title"
        className="flex items-center gap-2 font-display text-sm font-bold"
      >
        <Users className="h-4 w-4" aria-hidden /> Teams waiting for your approval
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        These memberships were approved by a previous guardian. Coaches and teammates cannot message
        your player through the team until you approve.
      </p>
      <div className="mt-2 space-y-2">
        {rows.map((r) => (
          <div
            key={`${r.child_user_id}:${r.team_id}`}
            className="rounded-xl border border-border bg-surface p-3"
          >
            <p className="text-sm font-semibold">
              {childNames[r.child_user_id] ?? "Your player"} · {r.team_name ?? "Team"}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={approve.isPending}
                onClick={() => approve.mutate({ teamId: r.team_id, childId: r.child_user_id })}
                className="rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
              >
                Approve
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
