/**
 * Playback-time rendering for a finished reel: when each on-screen text card
 * shows, and how the transition between the AI edit's cuts plays.
 *
 * Nothing here re-encodes video — the player draws cards and transitions over
 * the original clip, so switching either is instant and costs no AI run. The
 * timing rules are plain functions so they are unit-tested without a browser;
 * `playTransitionFx` is the only part that touches the DOM.
 */

import type { ReelTransition } from "@/lib/reel-style";

export type ReelOverlay = { at: string; text: string };
export type ScheduledOverlay = { text: string; start: number; end: number };
type TimelineBeat = { t: number; label: string };

/** How long a text card stays up when nothing follows it closely. */
export const OVERLAY_HOLD_SECONDS = 2.5;
/** Cards never start closer together than this, so each one is readable. */
export const OVERLAY_MIN_GAP_SECONDS = 1.2;

/** "0:04", "1:02.5", "4s", "4.5", "@0:04 the dunk" → seconds; otherwise null. */
export function parseOverlayTime(at: string): number | null {
  const s = String(at ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@\s*/, "");
  const bare = s.match(/^(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)?$/);
  if (bare) return Number(bare[1]);
  const clock = s.match(/(?:^|\D)(\d{1,2}):(\d{2}(?:\.\d+)?)(?!\d)/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  return null;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);

/**
 * The AI sometimes anchors a card to a moment name ("the dunk") instead of a
 * timestamp; find the play-by-play beat it refers to.
 */
function matchBeat(at: string, timeline: TimelineBeat[]): number | null {
  const needle = at.trim().toLowerCase();
  if (!needle) return null;
  const direct = timeline.find((b) => {
    const label = String(b.label ?? "").toLowerCase();
    return label && (label.includes(needle) || needle.includes(label));
  });
  if (direct) return direct.t;
  const wanted = new Set(words(needle));
  if (wanted.size === 0) return null;
  const overlap = timeline.find((b) => words(String(b.label ?? "")).some((w) => wanted.has(w)));
  return overlap ? overlap.t : null;
}

/**
 * Places every card on the clip's timeline. Cards with a readable time keep it;
 * the rest are spread evenly over the clip. Each card holds until the next one
 * (or OVERLAY_HOLD_SECONDS), and cards never pile onto the same moment.
 */
export function scheduleOverlays(
  overlays: ReelOverlay[] | null | undefined,
  timeline: TimelineBeat[] = [],
  duration?: number | null,
): ScheduledOverlay[] {
  const cards = (overlays ?? [])
    .map((o) => ({ at: String(o?.at ?? ""), text: String(o?.text ?? "").trim() }))
    .filter((o) => o.text.length > 0);
  if (cards.length === 0) return [];

  const length = duration && Number.isFinite(duration) && duration > 0 ? duration : null;
  const timed = cards.map((c) => ({
    text: c.text,
    start: parseOverlayTime(c.at) ?? matchBeat(c.at, timeline),
  }));
  const unplaced = timed.filter((c) => c.start == null);
  unplaced.forEach((c, i) => {
    c.start = length
      ? (length * (i + 1)) / (unplaced.length + 1)
      : 1 + i * (OVERLAY_HOLD_SECONDS + 0.5);
  });

  const placed = timed
    .map((c) => ({ text: c.text, start: Math.max(0, Number(c.start)) }))
    .sort((a, b) => a.start - b.start);
  for (let i = 1; i < placed.length; i++) {
    placed[i].start = Math.max(placed[i].start, placed[i - 1].start + OVERLAY_MIN_GAP_SECONDS);
  }

  return placed
    .map((c, i) => {
      const next = placed[i + 1]?.start ?? Infinity;
      let end = Math.min(c.start + OVERLAY_HOLD_SECONDS, next);
      if (length) end = Math.min(end, length);
      return { text: c.text, start: round(c.start), end: round(end) };
    })
    .filter((c) => c.end > c.start);
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The card on screen at time `t`, if any. */
export function activeOverlay(scheduled: ScheduledOverlay[], t: number): ScheduledOverlay | null {
  return scheduled.find((c) => t >= c.start && t < c.end) ?? null;
}

export type TransitionFx = {
  /** Real-time seconds before a cut when the outgoing half starts. */
  exit: number;
  /** Real-time seconds the incoming half takes after the cut. */
  enter: number;
  /** Colour the veil washes to, or null when the effect moves the frame instead. */
  veil: "white" | "black" | null;
};

export const TRANSITION_FX: Record<ReelTransition, TransitionFx> = {
  cut: { exit: 0, enter: 0, veil: null },
  flash: { exit: 0.08, enter: 0.32, veil: "white" },
  fade: { exit: 0.3, enter: 0.4, veil: "black" },
  whip: { exit: 0.14, enter: 0.24, veil: null },
  zoom: { exit: 0, enter: 0.35, veil: null },
};

/** Movement-based transitions become a plain fade when reduced motion is on. */
export function effectiveTransition(kind: ReelTransition, reducedMotion: boolean): ReelTransition {
  return reducedMotion && (kind === "whip" || kind === "zoom") ? "fade" : kind;
}

/**
 * How far before a segment's end (in media seconds) the outgoing half starts.
 * Media time runs `playbackRate` times faster than the wall clock, so slow-mo
 * segments start their exit closer to the cut.
 */
export function exitLeadSeconds(kind: ReelTransition, playbackRate: number): number {
  return TRANSITION_FX[kind].exit * Math.max(0.1, playbackRate);
}

type FxKeyframes = { veil?: Keyframe[]; frame?: Keyframe[]; ms: number };

/** The keyframes for one half of a transition; empty for a hard cut. */
export function transitionKeyframes(kind: ReelTransition, phase: "exit" | "enter"): FxKeyframes {
  const fx = TRANSITION_FX[kind];
  const ms = Math.round((phase === "exit" ? fx.exit : fx.enter) * 1000);
  if (ms <= 0) return { ms: 0 };
  if (fx.veil) {
    const color = fx.veil === "white" ? "#ffffff" : "#000000";
    const peak = fx.veil === "white" ? 0.85 : 1;
    const off = { opacity: 0, backgroundColor: color };
    const on = { opacity: peak, backgroundColor: color };
    return { ms, veil: phase === "exit" ? [off, on] : [on, off] };
  }
  if (kind === "whip") {
    const rest = { transform: "translateX(0)", filter: "blur(0px)" };
    return {
      ms,
      frame:
        phase === "exit"
          ? [rest, { transform: "translateX(-8%)", filter: "blur(8px)" }]
          : [{ transform: "translateX(8%)", filter: "blur(8px)" }, rest],
    };
  }
  if (kind === "zoom") {
    return { ms, frame: [{ transform: "scale(1.15)" }, { transform: "scale(1)" }] };
  }
  return { ms: 0 };
}

/**
 * Plays one half of a transition on the veil (a colour wash over the player)
 * or the frame (the element holding the video). The outgoing half holds its
 * end state until `cancelTransitionFx` clears it at the cut, so a seek hides
 * behind the wash. Returns the running animations; a no-op where the browser
 * lacks the Web Animations API.
 */
export function playTransitionFx(
  kind: ReelTransition,
  phase: "exit" | "enter",
  els: { veil?: HTMLElement | null; frame?: HTMLElement | null },
): Animation[] {
  const keys = transitionKeyframes(kind, phase);
  if (keys.ms <= 0) return [];
  const options: KeyframeAnimationOptions = {
    duration: keys.ms,
    easing: phase === "exit" ? "ease-in" : "ease-out",
    fill: phase === "exit" ? "forwards" : "none",
  };
  const running: Animation[] = [];
  const veilEl = els.veil ?? null;
  const frameEl = els.frame ?? null;
  if (keys.veil && veilEl && typeof veilEl.animate === "function") {
    running.push(veilEl.animate(keys.veil, options));
  }
  if (keys.frame && frameEl && typeof frameEl.animate === "function") {
    running.push(frameEl.animate(keys.frame, options));
  }
  return running;
}

/** Stops every running transition animation and returns the player to rest. */
export function cancelTransitionFx(running: Animation[]) {
  for (const a of running.splice(0)) {
    try {
      a.cancel();
    } catch {
      // Already finished or detached — nothing left to undo.
    }
  }
}
