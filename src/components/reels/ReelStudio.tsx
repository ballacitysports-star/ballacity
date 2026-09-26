/**
 * Reel Studio: the player surface for the AI reel agent's output.
 *
 * - Play-by-play timeline you can tap to jump to a moment
 * - "Play the AI edit": the planned cut list rendered live in the player
 *   (segment-by-segment with per-segment pacing, joined by the athlete's
 *   chosen transition) — no video re-encoding
 * - On-screen text cards drawn over the video in the reel's overlay theme
 * - Coaching report (strengths / fix / drills) and the spoken transcript
 */

import { useEffect, useRef, useState } from "react";
import { Film, ListVideo, MessageSquareQuote, Pause, Play, Dumbbell, Type } from "lucide-react";
import { ReelOverlayCard } from "@/components/reels/ReelOverlayCard";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import {
  normalizeReelStyle,
  OVERLAY_THEME_OPTIONS,
  TRANSITION_OPTIONS,
  type ReelTransition,
} from "@/lib/reel-style";
import {
  activeOverlay,
  cancelTransitionFx,
  effectiveTransition,
  exitLeadSeconds,
  playTransitionFx,
  scheduleOverlays,
  type ReelOverlay,
} from "@/lib/reel-playback";

export type TimelineEntry = { t: number; label: string; note?: string };
export type EditSegment = { start: number; end: number; pace?: string; why?: string };
export type EditPlan = { segments: EditSegment[]; why?: string; total?: number };
export type Coaching = {
  strengths?: string[];
  notes?: string[];
  drills?: string[];
  confidence?: string;
};

const PACE_RATE: Record<string, number> = { normal: 1, slowmo: 0.5, hold: 0.35, quick: 1.5 };

function clock(t: number): string {
  const s = Math.max(0, Math.round(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ReelStudio({
  videoUrl,
  timeline = [],
  editPlan,
  coaching,
  transcript,
  overlays,
  style,
  onTransitionChange,
}: {
  videoUrl: string;
  timeline?: TimelineEntry[];
  editPlan?: EditPlan | null;
  coaching?: Coaching | null;
  transcript?: string | null;
  /** On-screen text cards (`at` is "0:04" or a moment name) drawn over the video. */
  overlays?: ReelOverlay[] | null;
  /** The reel's saved style: picks the overlay theme and the transition between cuts. */
  style?: unknown;
  /**
   * When set, the athlete can switch transitions here and the parent saves the
   * choice; resolving to `false` (save failed) puts the previous one back.
   */
  onTransitionChange?: (next: ReelTransition) => void | Promise<boolean | void>;
}) {
  const prefs = normalizeReelStyle(style);
  const reducedMotion = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const veilRef = useRef<HTMLDivElement | null>(null);
  const fxRef = useRef<Animation[]>([]);
  /** True while advancing from one planned segment to the next (not a manual jump). */
  const cutRef = useRef(false);
  const [segIndex, setSegIndex] = useState<number | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [transition, setTransition] = useState<ReelTransition>(prefs.transition);
  const [showCards, setShowCards] = useState(true);
  const [now, setNow] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const segments = editPlan?.segments ?? [];
  // Realtime row patches (like saving a transition) hand over a fresh but equal
  // edit plan; keying playback on its content keeps a patch from restarting the
  // segment that is playing.
  const segmentsKey = JSON.stringify(segments);
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  // Follow the saved style when it changes underneath (realtime patch, new draft).
  useEffect(() => setTransition(prefs.transition), [prefs.transition]);

  // Read at cut time, so switching transitions mid-edit never restarts the segment.
  const fxKind = effectiveTransition(transition, reducedMotion);
  const fxKindRef = useRef(fxKind);
  fxKindRef.current = fxKind;

  // Track the playhead for the text cards.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => setNow(video.currentTime);
    const onMeta = () => setDuration(Number.isFinite(video.duration) ? video.duration : null);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("seeked", onTime);
    video.addEventListener("loadedmetadata", onMeta);
    onMeta();
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("seeked", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
    };
  }, [videoUrl]);

  // Drive the live cut: play each planned segment in order, at its own pace,
  // with the chosen transition played over the seek between segments.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || segIndex == null) return;
    const plan = segmentsRef.current;
    const seg = plan[segIndex];
    if (!seg) {
      setSegIndex(null);
      return;
    }
    const rate = PACE_RATE[String(seg.pace ?? "normal")] ?? 1;
    const hasNext = segIndex + 1 < plan.length;
    const fromCut = cutRef.current;
    cutRef.current = false;
    // A manual jump has no transition: clear any wash still on screen.
    if (!fromCut) cancelTransitionFx(fxRef.current);

    video.playbackRate = rate;
    try {
      video.currentTime = seg.start;
    } catch {
      /* seeking before metadata — the play() below still starts it */
    }
    void video.play().catch(() => {
      cancelTransitionFx(fxRef.current);
      setSegIndex(null);
    });

    // Reveal the new segment once the seek has landed, so the jump stays hidden.
    let entered = !fromCut;
    const enter = () => {
      if (entered) return;
      entered = true;
      cancelTransitionFx(fxRef.current);
      fxRef.current = playTransitionFx(fxKindRef.current, "enter", {
        veil: veilRef.current,
        frame: frameRef.current,
      });
    };
    let fallback = 0;
    if (!entered) {
      video.addEventListener("seeked", enter, { once: true });
      fallback = window.setTimeout(enter, 300);
    }

    // rAF rather than timeupdate: timeupdate only fires ~4x a second, which
    // lands cuts and transitions visibly late.
    let exiting = false;
    let raf = 0;
    const tick = () => {
      const remaining = seg.end - video.currentTime;
      if (hasNext && !exiting && remaining <= exitLeadSeconds(fxKindRef.current, rate)) {
        exiting = true;
        // Added alongside any entrance still running on a short segment, so the
        // cut can cancel both.
        fxRef.current.push(
          ...playTransitionFx(fxKindRef.current, "exit", {
            veil: veilRef.current,
            frame: frameRef.current,
          }),
        );
      }
      if (remaining <= 0.03) {
        if (hasNext) {
          cutRef.current = true;
          setSegIndex(segIndex + 1);
        } else {
          video.pause();
          video.playbackRate = 1;
          cancelTransitionFx(fxRef.current);
          setSegIndex(null);
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(fallback);
      video.removeEventListener("seeked", enter);
    };
  }, [segIndex, segmentsKey]);

  function stopCut() {
    const video = videoRef.current;
    video?.pause();
    if (video) video.playbackRate = 1;
    cancelTransitionFx(fxRef.current);
    setSegIndex(null);
  }

  function jumpTo(t: number) {
    const video = videoRef.current;
    if (!video) return;
    setSegIndex(null);
    cancelTransitionFx(fxRef.current);
    video.playbackRate = 1;
    try {
      video.currentTime = t;
    } catch {
      /* ignore */
    }
    void video.play().catch(() => {});
  }

  async function pickTransition(next: ReelTransition) {
    const previous = transition;
    setTransition(next);
    if ((await onTransitionChange?.(next)) === false) setTransition(previous);
  }

  const playingCut = segIndex != null;
  const themeLabel =
    OVERLAY_THEME_OPTIONS.find((o) => o.value === prefs.overlayTheme)?.label ?? "";
  const transitionLabel = TRANSITION_OPTIONS.find((o) => o.value === transition)?.label ?? "";
  const cards = prefs.overlayTheme === "none" ? [] : scheduleOverlays(overlays, timeline, duration);
  const card = showCards ? activeOverlay(cards, now) : null;

  return (
    <div className="mt-3 space-y-3">
      <div className="relative overflow-hidden rounded-lg bg-black">
        <div ref={frameRef} className="relative">
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            preload="metadata"
            className="block w-full bg-black"
          />
          {card && (
            <ReelOverlayCard
              key={`${card.start}-${card.text}`}
              theme={prefs.overlayTheme}
              text={card.text}
            />
          )}
        </div>
        <div
          ref={veilRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 opacity-0"
        />
      </div>

      {cards.length > 0 && (
        <div className="flex items-center justify-between gap-2 px-1">
          <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Type className="h-3.5 w-3.5 text-lime" aria-hidden />
            {cards.length} text card{cards.length === 1 ? "" : "s"} · {themeLabel}
          </p>
          <button
            type="button"
            aria-pressed={showCards}
            onClick={() => setShowCards((v) => !v)}
            className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground"
          >
            {showCards ? "Hide text" : "Show text"}
          </button>
        </div>
      )}

      {segments.length > 0 && (
        <div className="rounded-xl border border-border bg-background/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="inline-flex items-center gap-1.5 section-eyebrow text-lime">
              <Film className="h-3.5 w-3.5" />
              AI edit · {segments.length} cuts
              {editPlan?.total ? ` · ${editPlan.total}s` : ""}
              {transitionLabel ? ` · ${transitionLabel}` : ""}
            </p>
            <button
              onClick={() => (playingCut ? stopCut() : setSegIndex(0))}
              className="inline-flex items-center gap-1 rounded-full bg-lime px-2.5 py-1 text-[11px] font-semibold text-background"
            >
              {playingCut ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              {playingCut ? "Stop" : "Play the AI edit"}
            </button>
          </div>
          {editPlan?.why && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">{editPlan.why}</p>
          )}
          {onTransitionChange && segments.length > 1 && (
            <div className="mt-2">
              <div
                className="flex flex-wrap items-center gap-1.5"
                role="group"
                aria-label="Transition between cuts"
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Transition
                </span>
                {TRANSITION_OPTIONS.map((o) => {
                  const active = o.value === transition;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      aria-pressed={active}
                      title={o.blurb}
                      onClick={() => pickTransition(o.value)}
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                        active
                          ? "border-lime bg-lime/10 text-lime"
                          : "border-border text-muted-foreground hover:border-lime/40"
                      }`}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {fxKind !== transition
                  ? "Reduced motion is on, so this plays as a fade."
                  : "Plays live between cuts — switching never re-runs the AI."}
              </p>
            </div>
          )}
          <ol className="mt-2 space-y-1">
            {segments.map((s, i) => (
              <li key={`${s.start}-${i}`}>
                <button
                  onClick={() => setSegIndex(i)}
                  className={`flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left text-[11px] ${
                    segIndex === i ? "bg-lime/15 text-lime" : "text-muted-foreground"
                  }`}
                >
                  <span className="font-mono font-semibold">
                    {clock(s.start)}–{clock(s.end)}
                  </span>
                  <span className="flex-1 break-words">
                    {s.why || "Keep this beat"}
                    {s.pace && s.pace !== "normal" ? ` · ${s.pace}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {timeline.length > 0 && (
        <div className="rounded-xl border border-border bg-background/60 p-3">
          <p className="inline-flex items-center gap-1.5 section-eyebrow text-lime">
            <ListVideo className="h-3.5 w-3.5" />
            Play-by-play
          </p>
          <ul className="mt-2 space-y-1">
            {timeline.map((e, i) => (
              <li key={`${e.t}-${i}`}>
                <button
                  onClick={() => jumpTo(e.t)}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-lime/10 hover:text-lime"
                >
                  <span className="font-mono font-semibold text-lime">{clock(e.t)}</span>
                  <span className="flex-1 break-words">
                    <span className="font-semibold text-foreground">{e.label}</span>
                    {e.note ? ` — ${e.note}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {coaching &&
        ((coaching.strengths ?? []).length > 0 ||
          (coaching.notes ?? []).length > 0 ||
          (coaching.drills ?? []).length > 0) && (
          <div className="rounded-xl border border-border bg-background/60 p-3">
            <p className="inline-flex items-center gap-1.5 section-eyebrow text-lime">
              <Dumbbell className="h-3.5 w-3.5" />
              Coaching report
            </p>
            {(
              [
                ["What's working", coaching.strengths ?? []],
                ["What to fix", coaching.notes ?? []],
                ["Drills", coaching.drills ?? []],
              ] as const
            ).map(([label, items]) =>
              items.length ? (
                <div key={label} className="mt-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {label}
                  </p>
                  <ul className="mt-0.5 space-y-0.5">
                    {items.map((it, i) => (
                      <li key={i} className="text-[11px] text-muted-foreground">
                        • {it}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
            {coaching.confidence && (
              <p className="mt-2 text-[10px] italic text-muted-foreground/80">
                {coaching.confidence}
              </p>
            )}
          </div>
        )}

      {transcript && (
        <div className="rounded-xl border border-border bg-background/60 p-3">
          <button
            onClick={() => setShowTranscript((v) => !v)}
            className="inline-flex items-center gap-1.5 section-eyebrow text-lime"
          >
            <MessageSquareQuote className="h-3.5 w-3.5" />
            {showTranscript ? "Hide transcript" : "Show transcript"}
          </button>
          {showTranscript && (
            <p className="mt-2 whitespace-pre-wrap text-[11px] text-muted-foreground">
              {transcript}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
