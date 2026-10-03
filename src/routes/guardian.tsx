import { ParentPortalSections } from "@/components/child/ParentPortalSections";
import { ChildTryoutsSection } from "@/components/child/ChildTryoutsSection";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CalendarDays, ShieldCheck, Users } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { listChildrenActivity, type ChildGame } from "@/lib/guardian-activity.functions";

export const Route = createFileRoute("/guardian")({
  head: () => ({
    meta: [
      { title: "Guardian Dashboard — BallaCity" },
      { name: "description", content: "Your linked children's teams, upcoming games and recent activity." },
      { property: "og:title", content: "Guardian Dashboard — BallaCity" },
      { property: "og:description", content: "Your children's teams and game activity in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: GuardianDashboard,
});

function fmt(d: string) {
  return new Date(d).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function GameRow({ g, child }: { g: ChildGame; child?: string }) {
  return (
    <Link
      to="/games/$gameId"
      params={{ gameId: g.gameId }}
      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{g.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {child ? `${child} · ` : ""}
          {fmt(g.date)}
          {g.location ? ` · ${g.location}` : ""}
        </p>
      </div>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
          g.status === "joined" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
        }`}
      >
        {g.status === "joined" ? "Going" : "Requested"}
      </span>
    </Link>
  );
}

function GuardianDashboard() {
  const { user, loading } = useAuth() as { user: unknown; loading?: boolean };
  const fetchActivity = useServerFn(listChildrenActivity);
  const q = useQuery({
    queryKey: ["guardian-activity"],
    queryFn: () => fetchActivity(),
    enabled: !!user,
  });
  const [sel, setSel] = useState<string | "all">("all");

  if (!user && !loading) {
    return (
      <main className="page-shell-content pt-10 text-center">
        <p className="text-sm text-muted-foreground">Sign in to see your children's activity.</p>
        <Link to="/auth" className="mt-3 inline-block rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground">
          Sign in
        </Link>
      </main>
    );
  }

  const kids = q.data ?? [];
  const shown = sel === "all" ? kids : kids.filter((k) => k.childUserId === sel);
  const upcoming = shown
    .flatMap((k) => k.upcoming.map((g) => ({ g, child: k.name })))
    .sort((a, b) => a.g.date.localeCompare(b.g.date));
  const recent = shown
    .flatMap((k) => k.recent.map((g) => ({ g, child: k.name })))
    .sort((a, b) => b.g.date.localeCompare(a.g.date));
  const teams = shown.flatMap((k) => k.teams.map((t) => ({ t, child: k.name })));
  const multi = sel === "all" && kids.length > 1;

  return (
    <main className="page-shell-content pt-6 pb-24">
      <div className="flex items-center gap-2 text-primary">
        <ShieldCheck className="h-5 w-5" aria-hidden />
        <span className="section-eyebrow">Guardian Dashboard</span>
      </div>
      <h1 className="mt-2 page-title">Your kids' activity</h1>
      <p className="mt-2 page-subtitle">Invites, waivers, team updates and games for the children linked to your account.</p>
      <Link to="/parent" className="mt-2 inline-block text-xs font-semibold text-primary underline">
        Settings, approvals and safety → Parent Center
      </Link>

      {q.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : q.error ? (
        <p className="mt-6 text-sm text-destructive">Couldn't load activity. Try again shortly.</p>
      ) : kids.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-4 text-sm">
          <p className="font-semibold">No linked children yet</p>
          <Link to="/parent" className="mt-2 inline-block text-xs font-semibold text-primary underline">
            Add or link a child in the Parent Center
          </Link>
        </div>
      ) : (
        <>
          {kids.length > 1 && (
            <div className="mt-5 flex gap-2 overflow-x-auto">
              {[{ id: "all", name: "All" }, ...kids.map((k) => ({ id: k.childUserId, name: k.name }))].map((o) => (
                <button
                  key={o.id}
                  onClick={() => setSel(o.id)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${
                    sel === o.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {o.name}
                </button>
              ))}
            </div>
          )}

          <section className="mt-6">
            <h2 className="flex items-center gap-2 font-display text-sm font-bold">
              <CalendarDays className="h-4 w-4" aria-hidden /> Upcoming games
            </h2>
            <div className="mt-2 space-y-2">
              {upcoming.length === 0 ? (
                <p className="text-xs text-muted-foreground">No upcoming games.</p>
              ) : (
                upcoming.map(({ g, child }) => <GameRow key={child + g.gameId} g={g} child={multi ? child : undefined} />)
              )}
            </div>
          </section>

          <section className="mt-6">
            <h2 className="flex items-center gap-2 font-display text-sm font-bold">
              <Users className="h-4 w-4" aria-hidden /> Teams
            </h2>
            <div className="mt-2 space-y-2">
              {teams.length === 0 ? (
                <p className="text-xs text-muted-foreground">Not on a team yet.</p>
              ) : (
                teams.map(({ t, child }) => (
                  <Link
                    key={child + t.teamId}
                    to="/teams/$teamId"
                    params={{ teamId: t.teamId }}
                    className="block rounded-xl border border-border bg-surface p-3"
                  >
                    <p className="text-sm font-semibold">{t.name}</p>
                    <p className="text-xs capitalize text-muted-foreground">
                      {multi ? `${child} · ` : ""}
                      {t.role}
                      {t.jersey != null ? ` · #${t.jersey}` : ""}
                      {t.position ? ` · ${t.position}` : ""}
                    </p>
                  </Link>
                ))
              )}
            </div>
          </section>

          <ChildTryoutsSection kids={shown} multi={multi} />
          <ParentPortalSections kids={shown} multi={multi} onSigned={() => q.refetch()} />

          <section className="mt-6">
            <h2 className="font-display text-sm font-bold">Recent games</h2>
            <div className="mt-2 space-y-2">
              {recent.length === 0 ? (
                <p className="text-xs text-muted-foreground">No past games yet.</p>
              ) : (
                recent.map(({ g, child }) => <GameRow key={child + g.gameId} g={g} child={multi ? child : undefined} />)
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
