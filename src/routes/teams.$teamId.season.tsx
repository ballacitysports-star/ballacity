import { withRequireAuth } from "@/components/RequireAuth";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, CalendarDays, Plus } from "lucide-react";
import { getTeamRosterOverview } from "@/lib/tryouts.functions";

export const Route = createFileRoute("/teams/$teamId/season")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Season schedule | BallaCity" },
      { name: "description", content: "Plan your team's season: every upcoming tryout and camp with dates, sign-ups and turnout." },
      { property: "og:title", content: "Season schedule | BallaCity" },
      { property: "og:description", content: "Plan your team's season of tryouts and camps." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: withRequireAuth(SeasonPage),
});

function SeasonPage() {
  const { teamId } = Route.useParams();
  const fn = useServerFn(getTeamRosterOverview);
  const roster = useQuery({ queryKey: ["team-roster-overview", teamId], queryFn: () => fn({ data: { teamId } }) });

  const [filter, setFilter] = useState<"all" | "tryout" | "clinic">("all");
  const now = Date.now();
  const events = (roster.data?.events ?? [])
    .filter((e) => e.eventDate)
    .filter((e) => filter === "all" || e.kind === filter)
    .sort((a, b) => new Date(a.eventDate!).getTime() - new Date(b.eventDate!).getTime());
  const upcoming = events.filter((e) => new Date(e.eventDate!).getTime() >= now - 864e5);
  const past = events.filter((e) => new Date(e.eventDate!).getTime() < now - 864e5).reverse();
  const totApplied = past.reduce((s, e) => s + (e.applied ?? 0), 0);
  const totAttended = past.reduce((s, e) => s + (e.attended ?? 0), 0);
  const label = filter === "clinic" ? "camps" : filter === "tryout" ? "tryouts" : "tryouts or camps";

  return (
    <main className="page-shell max-w-3xl py-6">
      <Link to="/teams/$teamId/manage" params={{ teamId }} className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Manage team
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold">Season schedule</h1>
        <Link
          to="/teams/$teamId/events"
          params={{ teamId }}
          className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-bold text-muted-foreground"
        >
          <Plus className="h-3 w-3" /> {filter === "clinic" ? "Add camp" : "Add event"}
        </Link>
      </div>

      <div className="mt-4 flex gap-2" role="tablist">
        {(["all", "tryout", "clinic"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={filter === k}
            onClick={() => setFilter(k)}
            className={`rounded-full px-3 py-1 text-xs font-bold ${filter === k ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}
          >
            {k === "all" ? "All" : k === "tryout" ? "Tryouts" : "Camps"}
          </button>
        ))}
      </div>

      {roster.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : roster.error ? (
        <p className="mt-6 text-sm text-coral">Only owners, managers and coaches can view this page.</p>
      ) : events.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No {label} yet. <Link to="/teams/$teamId/events" params={{ teamId }} className="underline">Post your first one</Link> to start planning the season.
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Stat n={upcoming.length} l="Upcoming" />
            <Stat n={upcoming.reduce((s, e) => s + (e.applied ?? 0), 0)} l="Signed up" />
            <Stat n={totApplied ? `${Math.round((totAttended / totApplied) * 100)}%` : "—"} l="Past turnout" />
          </div>

          <h2 className="section-eyebrow mt-6 mb-2 text-muted-foreground">Upcoming ({upcoming.length})</h2>
          {upcoming.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">Nothing scheduled — add a tryout or camp to plan ahead.</p>
          ) : (
            <ul className="space-y-2">
              {upcoming.map((e) => (
                <SeasonRow key={e.id} teamId={teamId} event={e} />
              ))}
            </ul>
          )}

          {past.length > 0 && (
            <>
              <h2 className="section-eyebrow mt-6 mb-2 text-muted-foreground">Past ({past.length})</h2>
              <ul className="space-y-2">
                {past.map((e) => (
                  <SeasonRow key={e.id} teamId={teamId} event={e} past />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </main>
  );
}

type Event = NonNullable<Awaited<ReturnType<typeof getTeamRosterOverview>>["events"]>[number];

function Stat({ n, l }: { n: number | string; l: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-2">
      <p className="font-display text-lg font-bold">{n}</p>
      <p className="text-[11px] text-muted-foreground">{l}</p>
    </div>
  );
}

function SeasonRow({ teamId, event: e, past = false }: { teamId: string; event: Event; past?: boolean }) {
  const date = new Date(e.eventDate!);
  return (
    <li className={`rounded-2xl border border-border bg-surface p-3 ${past ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">
          <span className="mr-2 rounded-full bg-lime/15 px-2 py-0.5 text-[11px] font-bold text-lime">{e.kind === "clinic" ? "Camp" : "Tryout"}</span>
          {e.title}
        </p>

        <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <CalendarDays className="h-3 w-3" />
          {date.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {e.applied} applied{e.spotsMax ? ` · ${e.spotsMax} spots` : ""}
        {e.turnoutPct != null && (
          <span className="ml-1 font-semibold text-foreground">· {e.turnoutPct}% turnout ({e.attended}/{e.applied})</span>
        )}
      </p>
      <div className="mt-2 flex gap-2">
        <Link to="/teams/$teamId/tryouts" params={{ teamId }} className="text-xs font-bold text-primary underline">
          {past ? "Results" : "Check-in & score"}
        </Link>
        <Link to="/teams/$teamId/events" params={{ teamId }} className="text-xs font-bold text-muted-foreground underline">
          Edit
        </Link>
      </div>
    </li>
  );
}
