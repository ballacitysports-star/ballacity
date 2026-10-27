/**
 * A kinogram is one movement laid out as a row of evenly spaced stills, the
 * classic way to show a swing, a jump or a sprint start on a single image.
 *
 * Pure and client-safe.
 */

import { frameIndexAt, lastFrameIndex, timeForFrame } from "./frames";

export const KINOGRAM_COUNTS = [4, 6, 8, 10] as const;
export type KinogramCount = (typeof KINOGRAM_COUNTS)[number];

/** `count` moments from `start` to `end` inclusive, each on a frame of its own. */
export function kinogramTimes(
  start: number,
  end: number,
  count: number,
  fps: number,
  duration: number,
): number[] {
  const n = Math.max(1, Math.floor(count));
  const last = lastFrameIndex(duration, fps);
  const first = Math.min(frameIndexAt(Math.max(start, 0), fps), last);
  const final = Math.min(Math.max(frameIndexAt(Math.max(end, 0), fps), first), last);
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const frac = n === 1 ? 0 : i / (n - 1);
    out.push(timeForFrame(Math.round(first + (final - first) * frac), fps));
  }
  return out;
}

export type KinogramLayout = {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  gap: number;
  width: number;
  height: number;
};

export function kinogramLayout(
  count: number,
  video: { w: number; h: number },
  cellW = 480,
  gap = 8,
): KinogramLayout {
  const n = Math.max(1, Math.floor(count));
  // Balanced rows with no lonely last still: one row up to three, 2x2 for four, then two rows.
  const cols = n <= 3 ? n : n === 4 ? 2 : Math.ceil(n / 2);
  const rows = Math.ceil(n / cols);
  const aspect = video.w > 0 && video.h > 0 ? video.h / video.w : 9 / 16;
  const cellH = Math.round(cellW * aspect);
  return {
    cols,
    rows,
    cellW,
    cellH,
    gap,
    width: cols * cellW + (cols + 1) * gap,
    height: rows * cellH + (rows + 1) * gap,
  };
}

/** Where cell `i` goes on the sheet. */
export function kinogramCell(layout: KinogramLayout, i: number): { x: number; y: number } {
  const col = i % layout.cols;
  const row = Math.floor(i / layout.cols);
  return {
    x: layout.gap + col * (layout.cellW + layout.gap),
    y: layout.gap + row * (layout.cellH + layout.gap),
  };
}
