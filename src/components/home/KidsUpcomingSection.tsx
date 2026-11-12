import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, ChevronRight } from "lucide-react";
import { useParentMode } from "@/hooks/use-parent-mode";
import { listChildrenActivity } from "@/lib/guardian-activity.functions";
import { formatWhen } from "@/lib/format";
import { KID_GAME_STATUS_LABEL, nextKidsGames } from "@/lib/kids-upcoming";

/**
 * Parent Home (P1-8): the children's next games, under the parent's approvals.
 * It reads the same guardian-scoped activity the Parent Center shows (same query
 * key, so the two share one cache) and renders nothing for anyone who is not in
 * parent mode, while loading, or when no game is coming up.
 */
export function KidsUpcomingSection({ className = "" }: { className?: string }) {
  const { isParentMode } = useParentMode();
  return isParentMode ? <KidsUpcoming className={className} /> : null;
}

function KidsUpcoming({ className }: { className: string }) {
  const fetchActivity = useServerFn(listChildrenActivity);
  const q = useQuery({
    queryKey: ["guardian-activity"],
    queryFn: () => fetchActivity(),
    staleTime: 60_000,
  });
  const kids = q.data ?? [];
  const next = nextKidsGames(kids, Date.now());
  if (next.length === 0) return null;
  const multi = kids.length > 1;
  return (
    <section aria-label="Your kids' next games" className={className}>
      <h2 className="section-eyebrow mb-2 text-muted-foreground">Your kids&apos; next games</h2>
      <ul className="space-y-2">
        {next.map(({ game, child, childUserId }) => (
          <li key={`${childUserId}:${game.gameId}`}>
            <Link
              to="/games/$gameId"
              params={{ gameId: game.gameId }}
              className="flex min-h-11 items-center gap-3 rounded-2xl border border-border bg-surface p-3"
            >
              <CalendarDays className="h-5 w-5 shrink-0 text-lime" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{game.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {multi ? `${child} · ` : ""}
                  {formatWhen(game.date)}
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                {KID_GAME_STATUS_LABEL[game.status]}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <Link
        to="/parent"
        className="mt-2 inline-flex min-h-11 items-center text-xs font-semibold text-lime"
      >
        Everything in the Parent Center
      </Link>
    </section>
  );
}
