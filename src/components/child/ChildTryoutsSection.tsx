import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trophy } from "lucide-react";
import { toast } from "sonner";
import type { ChildActivity, ChildTryout } from "@/lib/guardian-activity.functions";
import { cancelTryoutRsvp } from "@/lib/tryouts.functions";
import { CancelForChildDialog } from "@/components/child/CancelForChildDialog";
import { isLateCancel, lateCancelWarning } from "@/lib/cancel-window";

type Row = { t: ChildTryout; child: string; childUserId: string };

/** Upcoming and past tryouts for linked children, with score (coach notes are never shown). */
export function ChildTryoutsSection({ kids, multi }: { kids: ChildActivity[]; multi: boolean }) {
  const qc = useQueryClient();
  const cancelFn = useServerFn(cancelTryoutRsvp);
  const [target, setTarget] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);

  const now = Date.now();
  const rows: Row[] = kids.flatMap((k) =>
    k.tryouts.map((t) => ({ t, child: k.name, childUserId: k.childUserId })),
  );
  const upcoming = rows.filter((r) => !r.t.eventDate || new Date(r.t.eventDate).getTime() >= now);
  const past = rows
    .filter((r) => r.t.eventDate && new Date(r.t.eventDate).getTime() < now)
    .reverse();
  const fmt = (d: string | null) =>
    d
      ? new Date(d).toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "Date TBA";

  const run = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const r = await cancelFn({
        data: { postId: target.t.postId, onBehalfOf: target.childUserId },
      });
      if (!r.ok) throw new Error(r.error);
      toast.success("Registration cancelled.");
      setTarget(null);
      void qc.invalidateQueries({ queryKey: ["guardian-activity"] });
      void qc.invalidateQueries({ queryKey: ["tryouts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel.");
    } finally {
      setBusy(false);
    }
  };

  const Row = ({ r, canCancel }: { r: Row; canCancel: boolean }) => (
    <div className="rounded-xl border border-border bg-surface p-3">
      <Link
        to="/tryouts/$postId"
        params={{ postId: r.t.postId }}
        className="flex items-center justify-between gap-3"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{r.t.title ?? "Tryout"}</p>
          <p className="text-xs text-muted-foreground">
            {multi ? `${r.child} · ` : ""}
            {r.t.teamName} · {fmt(r.t.eventDate)}
            {r.t.location ? ` · ${r.t.location}` : ""}
          </p>
          {r.t.attended != null && (
            <p className="text-xs text-muted-foreground">
              {r.t.attended ? "Attended" : "Did not attend"}
            </p>
          )}
          {r.t.notes && <p className="mt-1 text-xs italic">Coach: {r.t.notes}</p>}
        </div>
        <span className="shrink-0 rounded-full bg-lime/15 px-2 py-0.5 text-xs font-bold text-lime">
          {r.t.score != null ? `${r.t.score}/10` : canCancel ? "Registered" : "No score shared"}
        </span>
      </Link>
      {canCancel && (
        <div className="mt-2 text-right">
          <button
            type="button"
            onClick={() => setTarget(r)}
            className="text-xs font-semibold text-coral underline-offset-2 hover:underline"
          >
            Cancel registration
          </button>
        </div>
      )}
    </div>
  );

  return (
    <section className="mt-6">
      <h2 className="flex items-center gap-2 font-display text-sm font-bold">
        <Trophy className="h-4 w-4" aria-hidden /> Tryouts
      </h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No tryout sign-ups yet.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {upcoming.length > 0 && (
            <p className="text-xs font-semibold uppercase text-muted-foreground">Upcoming</p>
          )}
          {upcoming.map((r) => (
            <Row key={r.t.rsvpId} r={r} canCancel />
          ))}
          {past.length > 0 && (
            <p className="pt-2 text-xs font-semibold uppercase text-muted-foreground">Past</p>
          )}
          {past.map((r) => (
            <Row key={r.t.rsvpId} r={r} canCancel={false} />
          ))}
        </div>
      )}
      <CancelForChildDialog
        open={!!target}
        title={`Cancel ${target?.child ?? "your child"}'s registration?`}
        description={
          target
            ? `${target.t.teamName} will be told and the spot at ${target.t.title ?? "the tryout"} opens up for someone else. If a fee was paid, ask the team about a refund.`
            : ""
        }
        lateWarning={
          target && isLateCancel(target.t.eventDate, target.t.cancelCutoffMin)
            ? lateCancelWarning(target.t.cancelCutoffMin)
            : null
        }
        busy={busy}
        onConfirm={() => void run()}
        onClose={() => setTarget(null)}
      />
    </section>
  );
}
