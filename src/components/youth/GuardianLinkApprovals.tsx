import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Pending = { id: string; child_user_id: string; parent_user_id: string; created_at: string };

export const linkApprovalsKey = (viewerId: string) => ["guardian-link-approvals", viewerId];

async function fetchPending(viewerId: string): Promise<Pending[]> {
  // Row security returns requests for the signed-in guardian's verified children (and the guardian's own requests, filtered out here).
  const { data, error } = await supabase
    .from("guardian_link_requests" as never)
    .select("id, child_user_id, parent_user_id, created_at")
    .eq("status", "pending")
    .neq("parent_user_id", viewerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Pending[];
}

/**
 * Guardian dashboard: someone asked to become another parent or guardian of a child who already has one. The child's
 * click on a family invitation is not enough; a current verified guardian approves or declines it here.
 */
export function GuardianLinkApprovals({
  viewerId,
  childNames,
}: {
  viewerId: string;
  /** child user id -> first name, from the dashboard's own data */
  childNames: Record<string, string>;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: linkApprovalsKey(viewerId),
    queryFn: () => fetchPending(viewerId),
  });
  const decide = useMutation({
    mutationFn: async (v: { id: string; approve: boolean }) => {
      const { error } = await supabase.rpc(
        "guardian_decide_link_request" as never,
        { _request: v.id, _approve: v.approve } as never,
      );
      if (error) throw error;
      return v.approve;
    },
    onSuccess: (approved) => {
      toast.success(approved ? "Approved. They are now linked." : "Declined. Nothing changed.");
      void qc.invalidateQueries({ queryKey: linkApprovalsKey(viewerId) });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save that decision."),
  });

  const ids = (q.data ?? []).map((r) => r.parent_user_id);
  const names = useQuery({
    queryKey: ["guardian-link-approvals-names", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data } = await supabase.rpc("visible_avatars" as never, { _ids: ids } as never);
      return Object.fromEntries(
        ((data ?? []) as unknown as { id: string; display_name: string | null }[]).map((r) => [
          r.id,
          r.display_name,
        ]),
      ) as Record<string, string | null>;
    },
  });

  const rows = q.data ?? [];
  if (q.isLoading || q.error || rows.length === 0) return null;

  return (
    <section className="mt-6" aria-labelledby="link-approvals-title">
      <h2
        id="link-approvals-title"
        className="flex items-center gap-2 font-display text-sm font-bold"
      >
        <ShieldCheck className="h-4 w-4" aria-hidden /> New guardian requests
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Someone asked to be added as a parent or guardian. They get no access unless you approve.
      </p>
      <div className="mt-2 space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="rounded-xl border border-border bg-surface p-3">
            <p className="text-sm font-semibold">
              {names.data?.[r.parent_user_id] ?? "Someone"} wants to be a guardian of{" "}
              {childNames[r.child_user_id] ?? "your child"}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: r.id, approve: true })}
                className="rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: r.id, approve: false })}
                className="rounded-full bg-muted px-3 py-1.5 text-xs font-bold text-muted-foreground disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
