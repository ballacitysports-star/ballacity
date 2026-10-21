import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Award, Clock, Flame, MapPin, Shield, Sparkles, Trophy } from "lucide-react";
import type { AthleteProgress } from "@/lib/athlete-xp";
import { VenueBadge } from "@/components/venue/VenueBadge";
import { formatGameWhen } from "@/lib/format";
import { OrgAvatarMark, isImageUrl } from "@/components/OrgAvatarMark";
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
  const { teams, accolades, upcomingRuns, progress } = passport;
  if (teams.length === 0 && accolades.length === 0 && upcomingRuns.length === 0 && !progress)
    return null;

  return (
    <section className="mt-6 space-y-4" aria-label="Athlete passport">
      {progress && <AthleteLevelCard progress={progress} />}
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
                <span
                  aria-hidden
                  className={isImageUrl(t.avatar) ? "h-4 w-4 overflow-hidden rounded" : undefined}
                >
                  <OrgAvatarMark avatar={t.avatar} fallback="🏅" />
                </span>
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

const TIER_TONE: Record<AthleteProgress["reliabilityTier"], string> = {
  Elite: "border-lime/50 bg-lime/15 text-lime",
  Reliable: "border-lime/30 bg-lime/10 text-lime",
  Steady: "border-border bg-surface text-foreground",
  "Needs work": "border-coral/40 bg-coral/10 text-coral",
  New: "border-border bg-surface text-muted-foreground",
};

export function AthleteLevelCard({ progress: p }: { progress: AthleteProgress }) {
  const pct = Math.round((p.levelXp / p.nextLevelXp) * 100);
  return (
    <div className="rounded-2xl border border-border bg-surface p-4" aria-label="Athlete level">
      <div className="flex items-center gap-3">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-lime-gradient text-primary-foreground glow-lime">
          <div className="text-center leading-none">
            <div className="text-[9px] font-bold uppercase">Lvl</div>
            <div className="font-display text-xl font-black">{p.level}</div>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-1 font-semibold">
              <Sparkles className="h-3.5 w-3.5 text-lime" /> {p.xp.toLocaleString()} XP
            </span>
            <span className="text-muted-foreground tabular-nums">
              {p.nextLevelXp - p.levelXp} XP to Lvl {p.level + 1}
            </span>
          </div>
          <div
            className="mt-1.5 h-2 overflow-hidden rounded-full bg-background"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progress to next level"
          >
            <div className="h-full rounded-full bg-lime" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span
              className={`rounded-full border px-2 py-0.5 font-bold ${TIER_TONE[p.reliabilityTier]}`}
            >
              {p.reliabilityTier}
              {p.reliability != null ? ` · ${p.reliability}% reliable` : " · reliability pending"}
            </span>
            <span className="text-muted-foreground">{p.gamesPlayed} games played</span>
          </div>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-background p-3">
          <dt className="text-[11px] text-muted-foreground">Total Runs Completed</dt>
          <dd className="font-display text-lg font-black tabular-nums">{p.totalRunsCompleted}</dd>
        </div>
        <div className="rounded-xl bg-background p-3">
          <dt className="text-[11px] text-muted-foreground">Current Streak</dt>
          <dd className="inline-flex items-center gap-1 font-display text-lg font-black tabular-nums">
            <Flame className="h-4 w-4 text-coral" /> {p.currentStreak}
          </dd>
        </div>
      </dl>

      {p.badges.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Unlocked badges">
          {p.badges.map((b) => (
            <li
              key={b.id}
              title={b.hint}
              className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2.5 py-1 text-xs font-semibold"
            >
              <span aria-hidden>{b.emoji}</span> {b.label}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[10px] text-muted-foreground">
        +100 XP per attended run · +150 per hosted game · +200 per verified tryout. No-shows lower
        reliability.
      </p>
    </div>
  );
}
