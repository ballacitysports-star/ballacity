import { Link } from "@tanstack/react-router";
import { Trophy } from "lucide-react";
import type { ChildActivity } from "@/lib/guardian-activity.functions";

/** Upcoming and past tryouts for linked children, with score (coach notes are never shown). */
export function ChildTryoutsSection({ kids, multi }: { kids: ChildActivity[]; multi: boolean }) {
  const now = Date.now();
  const rows = kids.flatMap((k) => k.tryouts.map((t) => ({ t, child: k.name })));
  const upcoming = rows.filter((r) => !r.t.eventDate || new Date(r.t.eventDate).getTime() >= now);
  const past = rows.filter((r) => r.t.eventDate && new Date(r.t.eventDate).getTime() < now).reverse();
  const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Date TBA";

  const Row = ({ r }: { r: (typeof rows)[number] }) => (
    <Link to="/tryouts/$postId" params={{ postId: r.t.postId }} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{r.t.title ?? "Tryout"}</p>
        <p className="text-xs text-muted-foreground">
          {multi ? `${r.child} · ` : ""}{r.t.teamName} · {fmt(r.t.eventDate)}{r.t.location ? ` · ${r.t.location}` : ""}
        </p>
        {r.t.attended != null && (
          <p className="text-xs text-muted-foreground">{r.t.attended ? "Attended" : "Did not attend"}</p>
        )}
        {r.t.notes && <p className="mt-1 text-xs italic">Coach: {r.t.notes}</p>}
      </div>
      <span className="shrink-0 rounded-full bg-lime/15 px-2 py-0.5 text-xs font-bold text-lime">
        {r.t.score != null ? `${r.t.score}/10` : "No score shared"}
      </span>
    </Link>
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
          {upcoming.length > 0 && <p className="text-xs font-semibold uppercase text-muted-foreground">Upcoming</p>}
          {upcoming.map((r) => <Row key={r.t.rsvpId} r={r} />)}
          {past.length > 0 && <p className="pt-2 text-xs font-semibold uppercase text-muted-foreground">Past</p>}
          {past.map((r) => <Row key={r.t.rsvpId} r={r} />)}
        </div>
      )}
    </section>
  );
}
