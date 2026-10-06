/**
 * Pro Analytics panel inside Reel Studio: 0–100 ratings (radar + bars),
 * timestamped biomechanics cues that seek the player, playstyle archetype with
 * style comps, and a scout report the athlete can copy as a text card.
 *
 * Reads `highlight_reels.ai_advanced_analytics`, shaped by `@/lib/reel-analytics`.
 */

import { useState } from "react";
import { Activity, Check, ClipboardCopy, Sparkles, Target } from "lucide-react";
import { toast } from "sonner";
import {
  ANALYTICS_RATING_KEYS,
  ANALYTICS_RATING_LABELS,
  scoutCardText,
  type AdvancedAnalytics,
} from "@/lib/reel-analytics";

function clock(t: number): string {
  const s = Math.max(0, Math.round(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Pentagon radar of the four sub-ratings plus overall. */
function Radar({ analytics }: { analytics: AdvancedAnalytics }) {
  const size = 132;
  const c = size / 2;
  const r = c - 18;
  const keys = ANALYTICS_RATING_KEYS;
  const point = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / keys.length;
    return [c + Math.cos(a) * r * (v / 100), c + Math.sin(a) * r * (v / 100)] as const;
  };
  const ring = (v: number) => keys.map((_, i) => point(i, v).join(",")).join(" ");
  const shape = keys.map((k, i) => point(i, analytics.ratings[k]).join(",")).join(" ");
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="h-32 w-32 shrink-0 text-lime"
      role="img"
      aria-label={keys
        .map((k) => `${ANALYTICS_RATING_LABELS[k]} ${analytics.ratings[k]}`)
        .join(", ")}
    >
      {[25, 50, 75, 100].map((v) => (
        <polygon key={v} points={ring(v)} fill="none" className="stroke-border" strokeWidth={1} />
      ))}
      <polygon
        points={shape}
        fill="currentColor"
        fillOpacity={0.25}
        stroke="currentColor"
        strokeWidth={1.5}
      />
      {keys.map((k, i) => {
        const [x, y] = point(i, 118);
        return (
          <text
            key={k}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-muted-foreground text-[8px] font-semibold uppercase"
          >
            {k === "iq" ? "IQ" : k.slice(0, 4)}
          </text>
        );
      })}
    </svg>
  );
}

export function ReelProAnalytics({
  analytics,
  title,
  onSeek,
}: {
  analytics: AdvancedAnalytics;
  title: string;
  onSeek: (t: number) => void;
}) {
  const [copied, setCopied] = useState(false);
  const scout = analytics.scout;

  async function copyCard() {
    try {
      await navigator.clipboard.writeText(scoutCardText(analytics, title));
      setCopied(true);
      toast.success("Scout card copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy the scout card");
    }
  }

  return (
    <div className="rounded-xl border border-border bg-background/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 section-eyebrow text-lime">
          <Activity className="h-3.5 w-3.5" />
          Pro analytics
        </p>
        <button
          onClick={copyCard}
          className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:text-lime"
        >
          {copied ? <Check className="h-3 w-3" /> : <ClipboardCopy className="h-3 w-3" />}
          Scout card
        </button>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <Radar analytics={analytics} />
        <div className="min-w-0 flex-1 space-y-1.5">
          {ANALYTICS_RATING_KEYS.map((k) => (
            <div key={k}>
              <div className="flex items-baseline justify-between text-[10px]">
                <span
                  className={
                    k === "overall" ? "font-semibold text-foreground" : "text-muted-foreground"
                  }
                >
                  {ANALYTICS_RATING_LABELS[k]}
                </span>
                <span className="font-mono font-semibold text-lime">{analytics.ratings[k]}</span>
              </div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-lime"
                  style={{ width: `${analytics.ratings[k]}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {(analytics.archetype || analytics.comps.length > 0) && (
        <div className="mt-3">
          <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            Style DNA
          </p>
          {analytics.archetype && (
            <p className="mt-0.5 text-[12px] font-semibold text-foreground">{analytics.archetype}</p>
          )}
          {analytics.comps.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {analytics.comps.map((c) => (
                <li
                  key={c.name}
                  title={c.why}
                  className="rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-semibold text-lime"
                >
                  Plays like {c.name} · {c.match}% style match
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {analytics.biomechanics.length > 0 && (
        <div className="mt-3">
          <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Target className="h-3 w-3" />
            Biomechanics · tap to jump
          </p>
          <ul className="mt-1 space-y-1">
            {analytics.biomechanics.map((c, i) => (
              <li key={`${c.t}-${i}`}>
                <button
                  onClick={() => onSeek(c.t)}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-lime/10 hover:text-lime"
                >
                  <span className="font-mono font-semibold text-lime">{clock(c.t)}</span>
                  <span className="flex-1 break-words">
                    <span
                      className={`mr-1 rounded px-1 text-[9px] font-semibold uppercase ${
                        c.kind === "strength"
                          ? "bg-lime/15 text-lime"
                          : "bg-amber-500/15 text-amber-500"
                      }`}
                    >
                      {c.kind === "strength" ? "Keep" : "Fix"}
                    </span>
                    <span className="font-semibold text-foreground">{c.area}</span> — {c.cue}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {scout && (
        <div className="mt-3 rounded-lg border border-lime/40 bg-lime/5 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Scout report
            </p>
            <span className="rounded-full bg-lime px-2 py-0.5 text-[10px] font-semibold text-background">
              {scout.tier}
            </span>
          </div>
          {scout.quote && (
            <p className="mt-1.5 text-[11px] italic text-foreground">“{scout.quote}”</p>
          )}
          {scout.strengths.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {scout.strengths.map((s, i) => (
                <li key={i} className="text-[11px] text-muted-foreground">
                  • {s}
                </li>
              ))}
            </ul>
          )}
          {scout.drills.length > 0 && (
            <div className="mt-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                High-impact drills
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {scout.drills.map((d, i) => (
                  <li key={i} className="text-[11px] text-muted-foreground">
                    • {d}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <p className="mt-2 text-[10px] italic text-muted-foreground/80">
        AI estimate from one clip, not an official evaluation.
        {analytics.confidence ? ` ${analytics.confidence}` : ""}
      </p>
    </div>
  );
}
