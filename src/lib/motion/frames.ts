/**
 * Frame arithmetic for stepping through a video one frame at a time.
 *
 * A browser can seek to any time but cannot say how many frames a second a clip
 * has, so every function here takes the frame rate as an argument. Frame times
 * land in the MIDDLE of a frame, not on its edge: seeking to an exact boundary
 * can show the previous frame, which makes a single step look like it did
 * nothing or skipped one.
 *
 * Pure and client-safe.
 */

/** Rates phones, action cameras and broadcast video commonly use. */
export const COMMON_FPS = [24, 25, 30, 48, 50, 60, 90, 100, 120, 144, 200, 240] as const;

export const DEFAULT_FPS = 30;

/** The playback speeds offered for slow-motion review. */
export const PLAYBACK_SPEEDS = [0.1, 0.25, 0.5, 1] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

const SNAP_TOLERANCE = 0.04;

/**
 * Snaps a measured rate to the nearest common one when it is within 4%, so
 * NTSC rates (29.97, 59.94, 239.76) become 30, 60 and 240. Returns null when the
 * number is not a believable frame rate or sits between common rates.
 */
export function snapFps(estimate: number): number | null {
  if (!Number.isFinite(estimate) || estimate < 5 || estimate > 480) return null;
  let best: number | null = null;
  let bestGap = Infinity;
  for (const rate of COMMON_FPS) {
    const gap = Math.abs(estimate - rate) / rate;
    if (gap <= SNAP_TOLERANCE && gap < bestGap) {
      best = rate;
      bestGap = gap;
    }
  }
  return best;
}

export function frameDuration(fps: number): number {
  return 1 / fps;
}

/** The frame (0-based) that is on screen at `time`. */
export function frameIndexAt(time: number, fps: number): number {
  if (!Number.isFinite(time) || time <= 0) return 0;
  // The nudge keeps 0.1s at 30fps on frame 3, not 2, despite float error.
  return Math.floor(time * fps + 1e-6);
}

/** Time to seek to so that frame `index` is the one shown. */
export function timeForFrame(index: number, fps: number): number {
  return (Math.max(0, index) + 0.5) / fps;
}

export function lastFrameIndex(duration: number, fps: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.ceil(duration * fps - 1e-6) - 1);
}

/** Moves `frames` frames (negative = back), staying inside the clip. */
export function stepTime(time: number, frames: number, fps: number, duration: number): number {
  const target = frameIndexAt(time, fps) + Math.trunc(frames);
  const clamped = Math.min(Math.max(target, 0), lastFrameIndex(duration, fps));
  return timeForFrame(clamped, fps);
}

/** m:ss.cc, for the time readout. */
export function formatClock(time: number): string {
  const t = Number.isFinite(time) && time > 0 ? time : 0;
  const minutes = Math.floor(t / 60);
  const seconds = t - minutes * 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, "0")}`;
}

/** 1-based frame number, the way people count frames on a coaching screen. */
export function frameNumber(time: number, fps: number): number {
  return frameIndexAt(time, fps) + 1;
}

/** A loop range that is inside the clip and at least one frame long, or null. */
export function normalizeLoop(
  start: number | null,
  end: number | null,
  duration: number,
  fps: number,
): { start: number; end: number } | null {
  if (start == null || end == null) return null;
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(duration > 0)) return null;
  const a = Math.min(start, end);
  const b = Math.max(start, end);
  const lo = Math.min(Math.max(a, 0), duration);
  const hi = Math.min(Math.max(b, 0), duration);
  if (hi - lo < 1 / fps) return null;
  return { start: lo, end: hi };
}
