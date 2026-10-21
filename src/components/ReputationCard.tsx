import { motion } from "framer-motion";
import { Sparkles, TrendingUp, TrendingDown, Minus, ShieldCheck, Star } from "lucide-react";
import type { Reputation } from "@/lib/reviews";
import type { ReputationInsight } from "@/lib/reviews-db";

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          style={{ width: size, height: size }}
          className={i <= Math.round(value) ? "fill-lime text-lime" : "text-muted-foreground/40"}
        />
      ))}
    </div>
  );
}

export function ReputationCard({
  rep,
  insight,
  onRefreshInsight,
  refreshing,
}: {
  rep: Reputation;
  /** AI-written summary; falls back to the templated line when absent. */
  insight?: ReputationInsight | null;
  /** Provided only to the profile's owner. */
  onRefreshInsight?: () => void;
  refreshing?: boolean;
}) {
  const TrendIcon =
    rep.recentTrend === "up" ? TrendingUp : rep.recentTrend === "down" ? TrendingDown : Minus;
  const trendColor =
    rep.recentTrend === "up"
      ? "text-lime"
      : rep.recentTrend === "down"
        ? "text-coral"
        : "text-muted-foreground";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border border-border bg-gradient-to-br from-surface to-background p-4 overflow-hidden relative"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="micro-label text-muted-foreground">Reputation</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-4xl font-bold leading-none">{rep.trustScore}</span>
            <span className="text-xs text-muted-foreground">/ 100 trust</span>
            {rep.count > 0 && rep.provisional && (
              <span
                className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase text-muted-foreground"
                title="Not enough recent, verified reviews yet — this score will settle as more come in."
              >
                Provisional
              </span>
            )}
          </div>
          <div
            className={`mt-1.5 inline-flex items-center gap-1 text-sm font-bold ${rep.level.color}`}
          >
            <span className="text-lg leading-none">{rep.level.emoji}</span> {rep.level.name}
          </div>
        </div>
        <div className="text-right">
          <Stars value={rep.avg} size={16} />
          <div className="mt-0.5 text-xs text-muted-foreground">
            {rep.avg.toFixed(1)} · {rep.count} review{rep.count === 1 ? "" : "s"}
          </div>
          <div
            className={`mt-1 inline-flex items-center gap-1 text-[11px] font-semibold ${trendColor}`}
          >
            <TrendIcon className="h-3 w-3" />
            {rep.recentTrend === "up"
              ? "Trending up"
              : rep.recentTrend === "down"
                ? "Cooling"
                : "Steady"}
          </div>
        </div>
      </div>

      {/* Trust score progress */}
      <div className="mt-3 h-1.5 rounded-full bg-secondary overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${rep.trustScore}%` }}
          transition={{ duration: 0.9 }}
          className="h-full bg-lime-gradient"
        />
      </div>

      {/* Social proof badges */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {rep.verifiedShare >= 0.8 && rep.count > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime">
            <ShieldCheck className="h-3 w-3" /> Verified participation
          </span>
        )}
        {rep.recentTrend === "up" && (
          <span className="rounded-full bg-coral/15 px-2 py-0.5 text-[10px] font-bold text-coral">
            ⬆ Most Improved
          </span>
        )}
        {rep.count >= 10 && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold">
            🏆 Top of season
          </span>
        )}
      </div>

      {/* AI summary */}
      <div className="mt-4 rounded-2xl border border-lime/20 bg-lime/5 p-3">
        <div className="flex items-center gap-1.5 micro-label text-lime">
          <Sparkles className="h-3 w-3" /> AI insight
          {onRefreshInsight && rep.count > 0 && (
            <button
              type="button"
              onClick={onRefreshInsight}
              disabled={refreshing}
              className="ml-auto text-[10px] font-bold text-muted-foreground hover:text-lime disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-foreground/90 leading-snug">
          {insight?.summary ?? rep.aiSummary}
        </p>
        {insight && (insight.strengths.length > 0 || insight.growth.length > 0) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {insight.strengths.map((t) => (
              <span
                key={`s-${t}`}
                className="rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime"
              >
                ▲ {t}
              </span>
            ))}
            {insight.growth.map((t) => (
              <span
                key={`g-${t}`}
                className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground"
              >
                ◎ {t}
              </span>
            ))}
          </div>
        )}
        {insight && (
          <p className="mt-2 text-[10px] text-muted-foreground">
            Written by AI from {insight.reviewCount} public review
            {insight.reviewCount === 1 ? "" : "s"}.
          </p>
        )}
      </div>

      {/* Top strengths */}
      {rep.topStrengths.length > 0 && (
        <div className="mt-4">
          <div className="micro-label text-muted-foreground mb-2">Top strengths</div>
          <div className="flex flex-wrap gap-1.5">
            {rep.topStrengths.map((s) => (
              <span
                key={s.key}
                className="rounded-full border border-lime/40 bg-lime/10 px-2.5 py-1 text-[11px] font-bold text-lime"
              >
                {s.label} · {s.avg.toFixed(1)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Criteria breakdown bars */}
      {rep.criteriaAverages.some((c) => c.avg > 0) && (
        <div className="mt-4">
          <div className="micro-label text-muted-foreground mb-2">Breakdown</div>
          <div className="grid grid-cols-1 gap-1.5">
            {rep.criteriaAverages.map((c) => (
              <div key={c.key} className="grid grid-cols-[1fr_auto] items-center gap-2">
                <div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-foreground/80">{c.label}</span>
                    <span className="font-display font-bold text-lime">
                      {c.avg ? c.avg.toFixed(1) : "—"}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1 rounded-full bg-secondary overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(c.avg / 5) * 100}%` }}
                      transition={{ duration: 0.6 }}
                      className="h-full bg-lime-gradient"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
