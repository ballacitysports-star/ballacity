import { createFileRoute, Link } from "@tanstack/react-router";
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
  component: SeasonPage,
});

function SeasonPage() {
  const { teamId } = Route.useParams();
  const fn = useServerFn(getTeamRosterOverview);
  const roster = useQuery({ queryKey: ["team-roster-overview", teamId], queryFn: () => fn({ data: { teamId } }) });

  const now = Date.now();
  const events = (roster.data?.events ?? [])
    .filter((e) => e.eventDate)
    .sort((a, b) => new Date(a.eventDate!).getTime() - new Date(b.eventDate!).getTime());
  const upcoming = events.filter((e) => new Date(e.eventDate!).getTime() >= now - 864e5);
  const past = events.filter((e) => new Date(e.eventDate!).getTime() < now - 864e5).reverse();

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
          <Plus className="h-3 w-3" /> Add event
        </Link>
      </div>

      {roster.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : roster.error ? (
        <p className="mt-6 text-sm text-coral">Only owners, managers and coaches can view this page.</p>
      ) : events.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No tryouts or camps yet. <Link to="/teams/$teamId/events" params={{ teamId }} className="underline">Post your first one</Link> to start planning the season.
        </p>
      ) : (
        <>
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

function SeasonRow({ teamId, event: e, past = false }: { teamId: string; event: Event; past?: boolean }) {
  const date = new Date(e.eventDate!);
  return (
    <li className={`rounded-2xl border border-border bg-surface p-3 ${past ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{e.title}</p>
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
        <Link to="/teams/$teamId/tryouts" params={{ teamId }} search={{ post: e.id }} className="text-xs font-bold text-primary underline">
          {past ? "Results" : "Check-in & score"}
        </Link>
        <Link to="/teams/$teamId/events" params={{ teamId }} className="text-xs font-bold text-muted-foreground underline">
          Edit
        </Link>
      </div>
    </li>
  );
}
