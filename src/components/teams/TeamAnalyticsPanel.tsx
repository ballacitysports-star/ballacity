/**
 * Coach view of Pro Analytics for one team, from athletes who chose to share.
 * Staff only (checked in the database on every read). A team average appears only
 * once at least three athletes share, so it can't point at one person.
 */

import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Lock } from "lucide-react";
import { ANALYTICS_RATING_KEYS, ANALYTICS_RATING_LABELS } from "@/lib/reel-analytics";
import { MIN_TEAM_SUMMARY_ATHLETES } from "@/lib/coach-analytics";
import { getCoachAnalyticsEnabled, getTeamAnalytics } from "@/lib/coach-analytics.functions";

function Delta({ n }: { n: number | null }) {
  if (n == null || n === 0) return null;
  return (
    <span className={`text-[11px] font-bold tabular-nums ${n > 0 ? "text-lime" : "text-coral"}`}>
      {n > 0 ? `+${n}` : n}
    </span>
  );
}

export function TeamAnalyticsPanel({ teamId }: { teamId: string }) {
  const enabledFn = useServerFn(getCoachAnalyticsEnabled);
  const viewFn = useServerFn(getTeamAnalytics);
  const { data: on, isLoading: l1 } = useQuery({
    queryKey: ["coach-analytics-enabled"],
    queryFn: () => enabledFn(),
    staleTime: 60_000,
  });
  const { data, isLoading: l2 } = useQuery({
    queryKey: ["team-analytics", teamId],
    queryFn: () => viewFn({ data: { teamId } }),
    enabled: on?.enabled === true,
    staleTime: 30_000,
    retry: false,
  });

  if (l1 || (on?.enabled && l2)) {
    return <Loader2 className="mx-auto mt-6 h-5 w-5 animate-spin text-muted-foreground" />;
  }
  if (on?.enabled !== true) {
    return <p className="text-sm text-muted-foreground">Team analytics aren&apos;t available yet.</p>;
  }
  if (!data || !data.allowed) {
    return <p className="text-sm text-muted-foreground">Only this team&apos;s coaching staff can see this.</p>;
  }
  if (data.sharing === 0) {
    return (
      <div className="text-center">
        <Lock className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden />
        <p className="mt-2 text-sm font-semibold">No one is sharing analytics with this team yet</p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
          Players choose to share. Adults and 16–17s turn it on themselves on their Reels page; a
          parent turns it on for ages 13–15. Nothing is shown until they do.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {data.sharing} {data.sharing === 1 ? "player is" : "players are"} sharing their Pro
        Analytics with you. AI estimates from their clips, not official evaluations. Please keep
        this to coaching.
      </p>

      {data.summary ? (
        <section className="rounded-2xl border border-border bg-surface p-4" aria-label="Team summary">
          <p className="micro-label text-lime">Team summary · {data.summary.athletes} players</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {ANALYTICS_RATING_KEYS.map((k) => (
              <div key={k} className="rounded-xl bg-background p-2 text-center">
                <dt className="text-[10px] text-muted-foreground">{ANALYTICS_RATING_LABELS[k].split(" ")[0]}</dt>
                <dd className="font-display text-lg font-black tabular-nums">{data.summary!.average[k]}</dd>
              </div>
            ))}
          </dl>
          {data.summary.commonFixes.length > 0 && (
            <p className="mt-3 text-xs">
              <span className="font-semibold">Common focus areas: </span>
              {data.summary.commonFixes.map((c) => `${c.area} (${c.athletes} players)`).join(", ")}
            </p>
          )}
        </section>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          A team summary appears once at least {MIN_TEAM_SUMMARY_ATHLETES} players share, so it
          can&apos;t point at one person.
        </p>
      )}

      <ul className="space-y-2">
        {data.rows.map((r) => (
          <li key={r.userId} className="rounded-xl border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-semibold">{r.name}</span>
              {r.latest ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-display text-lg font-black tabular-nums">{r.latest.overall}</span>
                  <Delta n={r.overallChange} />
                </span>
              ) : (
                <span className="text-[11px] text-muted-foreground">No analysed reel yet</span>
              )}
            </div>
            {r.latest && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {ANALYTICS_RATING_KEYS.filter((k) => k !== "overall")
                  .map((k) => `${ANALYTICS_RATING_LABELS[k].split(" ")[0]} ${r.latest![k]}`)
                  .join(" · ")}
                {" · "}
                {r.reelCount} {r.reelCount === 1 ? "reel" : "reels"}
              </p>
            )}
            {r.recurringFixes.length > 0 && (
              <p className="mt-1 text-xs">
                <span className="font-semibold">Keeps coming up: </span>
                {r.recurringFixes.map((c) => c.area).join(", ")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
