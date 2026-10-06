import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Award, Clock, MapPin, Shield, Trophy } from "lucide-react";
import { VenueBadge } from "@/components/venue/VenueBadge";
import { formatGameWhen } from "@/lib/format";
import { getPlayerPassport, type PlayerPassport } from "@/lib/player-passport.functions";

/**
 * Athlete passport on `/players/$userId`: the teams a player is on, verified
 * tryout / camp attendance and the public runs they've joined. Privacy is
 * enforced by `getPlayerPassport`; this only renders what comes back.
 */
export function PlayerPassportSection({ userId, enabled }: { userId: string; enabled: boolean }) {
  const fetchPassport = useServerFn(getPlayerPassport);
  const q = useQuery({
    queryKey: ["player-passport", userId],
    queryFn: () => fetchPassport({ data: { userId } }),
    enabled,
    staleTime: 60_000,
  });
  if (!q.data) return null;
  return <PlayerPassportView passport={q.data} />;
}

export function PlayerPassportView({ passport }: { passport: PlayerPassport }) {
  const { teams, accolades, upcomingRuns } = passport;
  if (teams.length === 0 && accolades.length === 0 && upcomingRuns.length === 0) return null;

  return (
    <section className="mt-6 space-y-4" aria-label="Athlete passport">
      {teams.length > 0 && (
        <div>
          <h2 className="section-eyebrow mb-2 flex items-center gap-1.5 text-muted-foreground">
            <Shield className="h-4 w-4" /> Teams
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {teams.map((t) => (
              <Link
                key={t.id}
                to={t.kind === "coach" ? "/trainers/$trainerId" : "/teams/$teamId"}
                params={t.kind === "coach" ? { trainerId: t.id } : { teamId: t.id }}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-surface px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-lime/60 hover:text-lime"
              >
                <span aria-hidden>{t.avatar || "🏅"}</span>
                <span className="max-w-[160px] truncate">{t.name}</span>
                <span className="micro-label text-muted-foreground">{t.role}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {accolades.length > 0 && (
        <div>
          <h2 className="section-eyebrow mb-2 flex items-center gap-1.5 text-muted-foreground">
            <Trophy className="h-4 w-4" /> Tryouts &amp; camps
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {accolades.map((a) => (
              <Link
                key={a.postId}
                to="/tryouts/$postId"
                params={{ postId: a.postId }}
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-500 hover:border-amber-500/60"
              >
                <Award className="h-3.5 w-3.5" />
                <span className="max-w-[220px] truncate">
                  Attended {a.title}
                  {a.teamName ? ` · ${a.teamName}` : ""}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {upcomingRuns.length > 0 && (
        <div>
          <h2 className="section-eyebrow mb-2 flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-4 w-4" /> Upcoming runs
          </h2>
          <ul className="space-y-2">
            {upcomingRuns.map((g) => (
              <li
                key={g.id}
                className="flex items-center gap-3 rounded-xl border border-border/50 bg-surface p-3"
              >
                <Link
                  to="/games/$gameId"
                  params={{ gameId: g.id }}
                  className="min-w-0 flex-1 hover:opacity-80"
                >
                  <div className="truncate font-display text-sm font-bold">{g.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
                    <span suppressHydrationWarning>{formatGameWhen({ date: g.date })}</span>
                    {g.location && (
                      <span className="inline-flex min-w-0 items-center gap-1 truncate">
                        <MapPin className="h-3 w-3" /> {g.location}
                      </span>
                    )}
                  </div>
                </Link>
                {g.orgId && <VenueBadge orgId={g.orgId} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
