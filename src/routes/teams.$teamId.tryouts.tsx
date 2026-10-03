import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ShieldCheck, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/UserAvatar";
import { getTeamRosterOverview, getTryoutResults, saveTryoutEvaluation } from "@/lib/tryouts.functions";

export const Route = createFileRoute("/teams/$teamId/tryouts")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Tryout schedule & results | BallaCity" },
      { name: "description", content: "Run your team's tryouts: track attendance, score and rank applicants." },
      { property: "og:title", content: "Tryout schedule & results | BallaCity" },
      { property: "og:description", content: "Track tryout attendance and rank applicants." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TryoutResultsPage,
});

function TryoutResultsPage() {
  const { teamId } = Route.useParams();
  const rosterFn = useServerFn(getTeamRosterOverview);
  const roster = useQuery({ queryKey: ["team-roster-overview", teamId], queryFn: () => rosterFn({ data: { teamId } }) });
  const [postId, setPostId] = useState<string | null>(null);

  const events = (roster.data?.events ?? [])
    .filter((e) => e.eventDate)
    .sort((a, b) => new Date(a.eventDate!).getTime() - new Date(b.eventDate!).getTime());
  useEffect(() => {
    if (!postId && events.length) {
      const next = events.find((e) => new Date(e.eventDate!).getTime() >= Date.now() - 864e5) ?? events[events.length - 1];
      setPostId(next.id);
    }
  }, [events.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="page-shell max-w-3xl py-6">
      <Link to="/teams/$teamId/manage" params={{ teamId }} className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Manage team
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold">Tryout schedule &amp; results</h1>
        <Link to="/teams/$teamId/season" params={{ teamId }} className="rounded-full border border-border px-3 py-1 text-xs font-bold text-muted-foreground">
          Season
        </Link>
      </div>

      {roster.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : roster.error ? (
        <p className="mt-6 text-sm text-coral">Only owners, managers and coaches can view this page.</p>
      ) : events.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No tryouts yet. <Link to="/teams/$teamId/events" params={{ teamId }} className="underline">Post one</Link>.
        </p>
      ) : (
        <>
          <h2 className="section-eyebrow mt-6 mb-2 text-muted-foreground">Schedule</h2>
          <ul className="flex gap-2 overflow-x-auto pb-2">
            {events.map((e) => {
              const past = new Date(e.eventDate!).getTime() < Date.now();
              const going = e.rsvps.filter((r) => r.status === "registered").length;
              return (
                <li key={e.id}>
                  <button
                    onClick={() => setPostId(e.id)}
                    className={`min-w-44 rounded-2xl border p-3 text-left ${postId === e.id ? "border-primary bg-primary/10" : "border-border bg-surface"}`}
                  >
                    <p className="text-xs text-muted-foreground">{new Date(e.eventDate!).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{past ? " · done" : ""}</p>
                    <p className="text-sm font-semibold">{e.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {going} applied
                      {e.turnoutPct != null && <span className="font-semibold text-foreground"> · {e.turnoutPct}% turnout</span>}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
          {postId && <Results teamId={teamId} postId={postId} />}
        </>
      )}
    </main>
  );
}

type Row = Awaited<ReturnType<typeof getTryoutResults>>[number];

function Results({ teamId, postId }: { teamId: string; postId: string }) {
  const fn = useServerFn(getTryoutResults);
  const q = useQuery({ queryKey: ["tryout-results", postId], queryFn: () => fn({ data: { teamId, postId } }) });
  const [view, setView] = useState<"checkin" | "rank">("checkin");
  if (q.isLoading) return <p className="mt-4 text-sm text-muted-foreground">Loading applicants…</p>;
  if (q.error || !q.data) return <p className="mt-4 text-sm text-coral">Couldn't load applicants.</p>;
  const rows = q.data;
  const attended = rows.filter((r) => r.attended).length;
  const ranked = [...rows].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || Number(b.attended) - Number(a.attended));

  return (
    <section className="mt-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {attended}/{rows.length} attended
          {rows.length > 0 && <span className="font-semibold text-foreground"> · {Math.round((attended / rows.length) * 100)}% turnout</span>}
        </p>
        <div className="flex gap-1">
          <Button size="sm" variant={view === "checkin" ? "default" : "outline"} onClick={() => setView("checkin")}>Check-in &amp; score</Button>
          <Button size="sm" variant={view === "rank" ? "default" : "outline"} onClick={() => setView("rank")}><Trophy className="mr-1 h-4 w-4" />Rankings</Button>
          <Link to="/teams/$teamId/roster" params={{ teamId }} className="inline-flex items-center rounded-md border border-border px-3 text-xs font-bold text-muted-foreground">Roster</Link>
          <Link to="/teams/$teamId/invite-parent" params={{ teamId }} className="inline-flex items-center rounded-md border border-border px-3 text-xs font-bold text-muted-foreground">Invite parent</Link>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No applicants yet.</p>
      ) : view === "checkin" ? (
        <ul className="space-y-2">{rows.map((r) => <EvalRow key={r.rsvpId} row={r} teamId={teamId} postId={postId} />)}</ul>
      ) : (
        <ol className="space-y-2">
          {ranked.map((r, i) => (
            <li key={r.rsvpId} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3">
              <span className="w-6 text-center font-display text-lg font-bold">{r.score != null ? i + 1 : "–"}</span>
              <UserAvatar avatarUrl={r.avatar} name={r.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{r.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[r.birthYear ? `Born ${r.birthYear}` : null, r.position || null, r.attended ? "Attended" : "No-show", r.notes || null].filter(Boolean).join(" · ")}
                </p>
              </div>
              <span className="text-lg font-extrabold">{r.score ?? "—"}<span className="text-xs text-muted-foreground">/10</span></span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function EvalRow({ row, teamId, postId }: { row: Row; teamId: string; postId: string }) {
  const qc = useQueryClient();
  const save = useServerFn(saveTryoutEvaluation);
  const [notes, setNotes] = useState(row.notes);
  const persist = async (patch: Partial<Pick<Row, "attended" | "score" | "notes">>) => {
    const next = { attended: row.attended, score: row.score, notes, ...patch };
    const r = await save({ data: { teamId, postId, rsvpId: row.rsvpId, ...next } });
    if (!r.ok) return toast.error(r.error);
    qc.invalidateQueries({ queryKey: ["tryout-results", postId] });
  };
  return (
    <li className="rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-center gap-3">
        <Checkbox checked={row.attended} onCheckedChange={(v) => persist({ attended: v === true })} aria-label={`${row.name} attended`} />
        <UserAvatar avatarUrl={row.avatar} name={row.name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{row.name}</p>
          <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            {row.byGuardian && <span className="inline-flex items-center gap-0.5 text-lime"><ShieldCheck className="h-3 w-3" />Parent applied</span>}
            {!row.isMember && <span>New prospect</span>}
          </p>
        </div>
        <select
          aria-label={`Score for ${row.name}`}
          className="rounded-md border border-input bg-background p-1.5 text-sm"
          value={row.score ?? ""}
          onChange={(e) => persist({ score: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Score</option>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <Textarea
        className="mt-2 min-h-0 text-sm"
        rows={1}
        maxLength={1000}
        placeholder="Coach notes (private to staff)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== row.notes && persist({ notes })}
      />
    </li>
  );
}
