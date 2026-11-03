import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchHostingApprovals,
  hostingApprovalsKey,
  usableApprovals,
  type HostingApproval,
} from "@/lib/youth-hosting-approvals";

/**
 * Shown to a 16-17 year old creating a game: pick the approval a guardian or club administrator gave them for it.
 * Nothing else about hosting changes; the database re-checks the approval when the game is published.
 */
export function YouthHostApprovalPicker({
  minorId,
  value,
  onChange,
  problem,
}: {
  minorId: string;
  value: HostingApproval | null;
  onChange: (a: HostingApproval | null) => void;
  /** Why the chosen approval can't cover this game, from approvalBlocksGame. */
  problem: string | null;
}) {
  const q = useQuery({ queryKey: hostingApprovalsKey(minorId), queryFn: fetchHostingApprovals });
  const usable = usableApprovals(q.data ?? [], minorId);

  // Pick the soonest-to-expire approval by default, and drop a choice that is no longer usable.
  useEffect(() => {
    if (q.isLoading) return;
    if (value && !usable.some((a) => a.id === value.id)) onChange(usable[0] ?? null);
    else if (!value && usable.length > 0) onChange(usable[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.isLoading, usable.map((a) => a.id).join(",")]);

  return (
    <section
      className="rounded-2xl border border-border bg-surface p-4 space-y-2"
      aria-labelledby="youth-approval-title"
      data-testid="youth-host-approval"
    >
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        <h2 id="youth-approval-title">Approval to host</h2>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-10 w-full rounded-xl" />
      ) : q.error ? (
        <div role="alert" className="text-sm">
          <p className="text-destructive">Couldn't check your approvals.</p>
          <button
            type="button"
            onClick={() => void q.refetch()}
            className="mt-1 text-xs font-semibold underline"
          >
            Try again
          </button>
        </div>
      ) : usable.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          To host a game for players under 18, a guardian or an administrator of your club has to
          approve it first. Ask them to open their dashboard and choose “Approve one game”. Games
          for ages 18 and over can't be hosted by anyone under 18.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            This approval covers one game. A game for ages 18 and over can't be approved.
          </p>
          <div className="space-y-2">
            {usable.map((a) => (
              <label
                key={a.id}
                className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm ${
                  value?.id === a.id ? "border-lime bg-lime/10" : "border-border"
                }`}
              >
                <input
                  type="radio"
                  name="hosting-approval"
                  checked={value?.id === a.id}
                  onChange={() => onChange(a)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-semibold">
                    {a.kind === "organization"
                      ? "Approved by your club"
                      : "Approved by your guardian"}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Expires {new Date(a.expires_at).toLocaleString()}
                    {a.payment_manager_id ? " · an adult manages payments" : " · free games only"}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </>
      )}
      {problem && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
