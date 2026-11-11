import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Settings2, ClipboardList } from "lucide-react";
import { withRequireAuth } from "@/components/RequireAuth";
import { pageHead } from "@/lib/seo";
import { ROLE_LABEL, useCoachedTeams } from "@/lib/coach-identity";

// P2-2: one private place for everyone who coaches, manages or owns teams. Only the
// signed-in person's own teams are listed; this page is not public and not in Discover.
export const Route = createFileRoute("/coach")({
  head: () =>
    pageHead({
      title: "Teams you coach — BallaCity",
      description: "Every team you coach, manage or own, in one place.",
      noindex: true,
    }),
  ssr: false,
  component: withRequireAuth(CoachHome),
});

function CoachHome() {
  const teams = useCoachedTeams();

  return (
    <div className="page-shell-prose space-y-5 pb-24 pt-4">
      <Link
        to="/profile"
        className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Me
      </Link>
      <header>
        <h1 className="page-title">Teams you coach</h1>
        <p className="page-subtitle">
          Every team you coach, manage or own. Only you can see this list.
        </p>
      </header>

      {teams.isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : teams.isError ? (
        <p className="text-sm text-muted-foreground">Could not load your teams. Try again.</p>
      ) : (teams.data ?? []).length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-5 text-center">
          <ClipboardList className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-semibold">You don't coach a team yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            When a team makes you a coach or manager, it shows up here.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {(teams.data ?? []).map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3"
            >
              <Link to="/teams/$teamId" params={{ teamId: t.id }} className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{t.name}</span>
                <span className="block text-xs text-muted-foreground">{ROLE_LABEL[t.role]}</span>
              </Link>
              <Link
                to="/teams/$teamId/manage"
                params={{ teamId: t.id }}
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-lime px-3 py-1.5 text-xs font-bold text-primary-foreground"
              >
                <Settings2 className="h-3.5 w-3.5" /> Manage
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
