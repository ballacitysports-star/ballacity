/**
 * "Your progress": Pro Analytics ratings across the athlete's reels, newest against
 * oldest. Built from analytics already stored on each reel, so it costs nothing extra
 * and shows nothing until there are at least two analysed reels in the same sport.
 * Family clips are left out: they are a parent's private clips of a child, not this
 * athlete's own reels.
 */

import { useMemo } from "react";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { ANALYTICS_RATING_LABELS, type AdvancedAnalytics } from "@/lib/reel-analytics";
import { buildReelTrends, type RatingTrend } from "@/lib/reel-trends";

type ProgressReel = {
  id: string;
  title: string;
  created_at: string;
  status: string;
  is_draft?: boolean | null;
  subject_child_id?: string | null;
  ai_advanced_analytics?: AdvancedAnalytics | null;
};

function Spark({ points }: { points: number[] }) {
  const w = 72;
  const h = 22;
  const step = points.length > 1 ? w / (points.length - 1) : 0;
  const d = points
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)} ${(h - (v / 100) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="shrink-0 text-lime">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Change({ change }: { change: number | null }) {
  if (change == null) return null;
  const Icon = change > 0 ? ArrowUp : change < 0 ? ArrowDown : ArrowRight;
  const tone = change > 0 ? "text-lime" : change < 0 ? "text-coral" : "text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold tabular-nums ${tone}`}>
      <Icon className="h-3 w-3" aria-hidden />
      {change > 0 ? `+${change}` : change}
    </span>
  );
}

function Row({ r }: { r: RatingTrend }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-xs">{ANALYTICS_RATING_LABELS[r.key]}</span>
      <Spark points={r.points.map((p) => p.value)} />
      <span className="w-7 text-right font-display text-sm font-black tabular-nums">{r.latest}</span>
      <span className="w-10 text-right">
        <Change change={r.change} />
      </span>
    </li>
  );
}

export function ReelProgress({ reels }: { reels: ProgressReel[] }) {
  const trends = useMemo(
    () =>
      buildReelTrends(
        reels
          .filter((r) => r.status === "completed" && !r.is_draft && !r.subject_child_id)
          .map((r) => ({
            id: r.id,
            title: r.title,
            created_at: r.created_at,
            analytics: r.ai_advanced_analytics,
          })),
      ),
    [reels],
  );
  if (!trends) return null;
  return (
    <section className="mb-4 rounded-2xl border border-border bg-surface p-4" aria-label="Your progress">
      <p className="micro-label text-lime">Your progress</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {trends.reelCount} analysed {trends.sport ? `${trends.sport} ` : ""}reels, oldest to newest.
        Change compares your latest reels with your first.
      </p>
      <ul className="mt-2 divide-y divide-border/50">
        {trends.ratings.map((r) => (
          <Row key={r.key} r={r} />
        ))}
      </ul>
      {(trends.recurringFixes.length > 0 || trends.recurringStrengths.length > 0) && (
        <div className="mt-3 space-y-1 text-xs">
          {trends.recurringFixes.length > 0 && (
            <p>
              <span className="font-semibold">Keeps coming up: </span>
              {trends.recurringFixes.map((c) => `${c.area} (${c.reels} reels)`).join(", ")}
            </p>
          )}
          {trends.recurringStrengths.length > 0 && (
            <p>
              <span className="font-semibold">Consistent strengths: </span>
              {trends.recurringStrengths.map((c) => `${c.area} (${c.reels} reels)`).join(", ")}
            </p>
          )}
        </div>
      )}
      <p className="mt-3 text-[10px] text-muted-foreground">
        AI estimates from your clips, not official evaluations. Different angles and distances can
        move a score.
      </p>
    </section>
  );
}
