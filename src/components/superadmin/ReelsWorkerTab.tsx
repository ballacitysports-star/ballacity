import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmAction } from "@/components/superadmin/ConfirmAction";
import {
  superadminHideReels,
  superadminReelsWorkerStatus,
  superadminRetryReels,
} from "@/lib/superadmin-reels.functions";

const QUERY_KEY = ["superadmin-reels-worker"];

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-xl font-bold tabular-nums ${warn && value > 0 ? "text-destructive" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Highlight-reel processing health. The worker runs on a schedule behind a
 * shared secret; this tab shows the queue and lets a superadmin re-queue or
 * hide problem reels. It never calls the worker or exposes the secret.
 */
export function ReelsWorkerTab() {
  const qc = useQueryClient();
  const fetchStatus = useServerFn(superadminReelsWorkerStatus);
  const retry = useServerFn(superadminRetryReels);
  const hide = useServerFn(superadminHideReels);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<"retry" | "hide" | null>(null);

  const status = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchStatus(),
    refetchInterval: 30_000,
  });

  const run = useMutation({
    mutationFn: async ({ kind, reason }: { kind: "retry" | "hide"; reason: string }) => {
      const ids = [...selected];
      if (kind === "retry") return retry({ data: { ids, reason } });
      return hide({ data: { ids, reason } });
    },
    onSuccess: (res: any, vars) => {
      toast.success(
        vars.kind === "retry"
          ? `Re-queued ${res.requeued} reel(s)${res.skipped ? `, skipped ${res.skipped}` : ""}`
          : `Hid ${res.hidden} reel(s)`,
      );
      setSelected(new Set());
      setAction(null);
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Action failed"),
  });

  const data = status.data;
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (status.isError)
    return (
      <p className="text-sm text-muted-foreground">
        Could not load the reels worker status.{" "}
        <Button size="sm" variant="outline" onClick={() => status.refetch()}>
          Retry
        </Button>
      </p>
    );
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Processing" value={data.counts.processing} />
        <Stat label="Stuck" value={data.counts.stuck} warn />
        <Stat label="Out of attempts" value={data.counts.exhausted} warn />
        <Stat label="Failed" value={data.counts.failed} warn />
      </div>
      <p className="text-xs text-muted-foreground">
        Last worker activity:{" "}
        {data.lastActivityAt ? new Date(data.lastActivityAt).toLocaleString() : "none recorded"}. A
        reel counts as stuck after {data.limits.stuckAfterMinutes} minutes; reels fail after{" "}
        {data.limits.maxAttempts} attempts. Retry resets the attempt count; completed reels are
        never touched.
      </p>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">Needs attention</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" disabled={selected.size === 0} onClick={() => setAction("retry")}>
              Retry ({selected.size})
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={selected.size === 0}
              onClick={() => setAction("hide")}
            >
              Hide
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.problems.length === 0 ? (
            <p className="text-xs text-muted-foreground">Queue is healthy.</p>
          ) : (
            data.problems.map((r) => (
              <label key={r.id} className="flex items-start gap-3 rounded-lg border p-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selected.has(r.id)}
                  onChange={() => toggle(r.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.title}</span>
                    <Badge variant={r.problem === "failed" ? "destructive" : "secondary"}>
                      {r.problem}
                    </Badge>
                    <span className="text-muted-foreground">
                      step {r.processingStep} · {r.attempts} attempt(s)
                    </span>
                  </span>
                  {r.errorMessage ? (
                    <span className="mt-1 block break-words text-muted-foreground">
                      {r.errorMessage}
                    </span>
                  ) : null}
                </span>
              </label>
            ))
          )}
        </CardContent>
      </Card>

      <ConfirmAction
        open={action !== null}
        onOpenChange={(o) => !o && setAction(null)}
        title={action === "retry" ? "Re-queue selected reels" : "Hide selected reels"}
        description={
          action === "retry"
            ? "Resets attempts so the worker picks these up on its next run."
            : "Hides these reels from public surfaces. This can be undone from the Content tab."
        }
        requireReason
        pending={run.isPending}
        onConfirm={(reason) => action && run.mutate({ kind: action, reason })}
      />
    </div>
  );
}
