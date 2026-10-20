import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus, Star, ShieldCheck } from "lucide-react";
import { trustLabel, type Reputation } from "@/lib/reviews";

function Stars({ value, size = 12 }: { value: number; size?: number }) {
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

function badgeAriaLabel(rep: Reputation): string {
  return rep.count > 0
    ? `Open reviews. Trust score ${rep.trustScore}, ${rep.avg.toFixed(1)} out of 5 from ${rep.count} review${rep.count === 1 ? "" : "s"}.`
    : "Open reviews. No reviews yet.";
}

export function ReputationBadge({
  rep,
  compact = false,
  onClick,
  ariaLabel,
}: {
  rep: Reputation;
  compact?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const TrendIcon =
    rep.recentTrend === "up" ? TrendingUp : rep.recentTrend === "down" ? TrendingDown : Minus;
  const trendColor =
    rep.recentTrend === "up"
      ? "text-lime"
      : rep.recentTrend === "down"
        ? "text-coral"
        : "text-muted-foreground";

  if (compact) {
    const Component = onClick ? motion.button : motion.div;
    return (
      <Component
        type={onClick ? "button" : undefined}
        onClick={onClick}
        aria-label={onClick ? (ariaLabel ?? badgeAriaLabel(rep)) : undefined}
        aria-haspopup={onClick ? "dialog" : undefined}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className={`flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 text-left transition-all hover:border-lime/40 ${onClick ? "cursor-pointer" : ""}`}
      >
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lime/15 font-display text-sm font-bold text-lime">
          {trustLabel(rep)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`text-[10px] font-bold ${rep.level.color}`}>
              {rep.level.emoji} {rep.level.name}
            </span>
            <Stars value={rep.avg} size={10} />
            <span className="text-[10px] text-muted-foreground">{rep.avg.toFixed(1)}</span>
          </div>
          {rep.topStrengths.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {rep.topStrengths.slice(0, 2).map((s) => (
                <span
                  key={s.key}
                  className="rounded-full border border-lime/30 bg-lime/10 px-1.5 py-0.5 text-[9px] font-bold text-lime"
                >
                  {s.label} · {s.avg.toFixed(1)}
                </span>
              ))}
            </div>
          )}
        </div>
        <TrendIcon className={`h-3.5 w-3.5 shrink-0 ${trendColor}`} />
      </Component>
    );
  }

  const Component = onClick ? motion.button : motion.div;
  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-label={onClick ? (ariaLabel ?? badgeAriaLabel(rep)) : undefined}
      aria-haspopup={onClick ? "dialog" : undefined}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border border-border bg-surface p-4 text-left transition-all hover:border-lime/40 ${onClick ? "cursor-pointer" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-lime/15 font-display text-lg font-bold text-lime">
            {trustLabel(rep)}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className={`text-xs font-bold ${rep.level.color}`}>
                {rep.level.emoji} {rep.level.name}
              </span>
              {rep.verifiedShare >= 0.8 && rep.count > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-lime/15 px-1.5 py-0.5 text-[9px] font-bold text-lime">
                  <ShieldCheck className="h-2.5 w-2.5" /> Verified
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <Stars value={rep.avg} size={12} />
              <span className="text-xs text-muted-foreground">
                {rep.avg.toFixed(1)} · {rep.count} review{rep.count === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </div>
        <div className={`inline-flex items-center gap-1 text-[11px] font-semibold ${trendColor}`}>
          <TrendIcon className="h-3.5 w-3.5" />
          {rep.recentTrend === "up"
            ? "Trending up"
            : rep.recentTrend === "down"
              ? "Cooling"
              : "Steady"}
        </div>
      </div>

      {rep.topStrengths.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {rep.topStrengths.map((s) => (
            <span
              key={s.key}
              className="rounded-full border border-lime/40 bg-lime/10 px-2.5 py-1 text-[11px] font-bold text-lime"
            >
              {s.label} · {s.avg.toFixed(1)}
            </span>
          ))}
        </div>
      )}

      {rep.count > 0 && (
        <p className="mt-2 text-xs text-foreground/80 leading-snug">{rep.aiSummary}</p>
      )}
    </Component>
  );
}
