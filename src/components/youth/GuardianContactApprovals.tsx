import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";

type Awaiting = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  message: string | null;
  kind: string;
  created_at: string;
};

export const contactApprovalsKey = (viewerId: string) => ["guardian-contact-approvals", viewerId];

async function fetchAwaiting(): Promise<Awaiting[]> {
  // Row security returns only requests whose sender is the signed-in guardian's verified child.
  const { data, error } = await supabase
    .from("availability_contact_requests" as never)
    .select("id, from_user_id, to_user_id, message, kind, created_at")
    .eq("status", "awaiting_guardian")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Awaiting[];
}

/**
 * Guardian dashboard: a child's request to contact another player waits here. Nothing reaches the other person, and no
 * conversation can open, until a verified guardian approves it. Declining withdraws it.
 */
export function GuardianContactApprovals({
  viewerId,
  childNames,
}: {
  viewerId: string;
  /** child user id -> first name, from the dashboard's own data */
  childNames: Record<string, string>;
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: contactApprovalsKey(viewerId), queryFn: fetchAwaiting });
  const decide = useMutation({
    mutationFn: async (v: { id: string; approve: boolean }) => {
      const { error } = await supabase.rpc(
        "guardian_decide_contact_request" as never,
        {
          _request: v.id,
          _approve: v.approve,
        } as never,
      );
      if (error) throw error;
      return v.approve;
    },
    onSuccess: (approved) => {
      toast.success(approved ? "Approved. The request was sent." : "Declined. Nothing was sent.");
      void qc.invalidateQueries({ queryKey: contactApprovalsKey(viewerId) });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save that decision."),
  });

  if (q.isLoading) return <Skeleton className="mt-6 h-16 w-full rounded-xl" />;
  const rows = q.data ?? [];
  if (q.error || rows.length === 0) return null;

  return (
    <section className="mt-6" aria-labelledby="contact-approvals-title">
      <h2
        id="contact-approvals-title"
        className="flex items-center gap-2 font-display text-sm font-bold"
      >
        <MessageSquare className="h-4 w-4" aria-hidden /> Contact requests waiting for you
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Your child asked to contact another player. Nothing is sent, and no chat opens, unless you
        approve.
      </p>
      <div className="mt-2 space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="rounded-xl border border-border bg-surface p-3">
            <p className="text-sm font-semibold">
              {childNames[r.from_user_id] ?? "Your child"} wants to{" "}
              {r.kind === "invite" ? "invite a player to a game" : "message a player"}
            </p>
            {r.message && <p className="mt-1 text-xs text-muted-foreground">“{r.message}”</p>}
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
