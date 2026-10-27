/**
 * Drawings on a clip: lines, angles and freehand strokes.
 *
 * Each drawing belongs to one moment (a time in seconds) and shows only on that
 * frame, unless it is marked "persist", which is how a grid line or a plumb line
 * stays up through the whole clip. They live in memory on the device and are
 * never uploaded.
 *
 * Pure and client-safe.
 */

import type { Pt } from "./geometry";

export const ANNOTATION_COLORS = {
  lime: "#a3e635",
  coral: "#fb7185",
  sky: "#38bdf8",
  yellow: "#facc15",
  white: "#f8fafc",
} as const;

export type AnnotationColor = keyof typeof ANNOTATION_COLORS;
export const COLOR_ORDER: AnnotationColor[] = ["lime", "coral", "sky", "yellow", "white"];

export type DrawingTool = "line" | "angle" | "pen";

type Base = { id: string; color: AnnotationColor; time: number; persist: boolean };

export type Annotation =
  | (Base & { kind: "line"; a: Pt; b: Pt })
  | (Base & { kind: "angle"; a: Pt; vertex: Pt; c: Pt })
  | (Base & { kind: "pen"; points: Pt[] });

/** How many taps or drag ends a tool needs before it makes a drawing. */
export function pointsNeeded(tool: Exclude<DrawingTool, "pen">): number {
  return tool === "angle" ? 3 : 2;
}

/** A stroke needs more than a dot to count. */
export const MIN_PEN_POINTS = 3;

/** Smallest movement, in 0..1 of the frame, before a pen stroke records another point. */
export const PEN_MIN_STEP = 0.004;

let counter = 0;
export function newAnnotationId(): string {
  counter += 1;
  return `ann-${Date.now().toString(36)}-${counter}`;
}

/** Which drawings show at `time`: those made on this frame, plus persistent ones. */
export function visibleAnnotations(list: Annotation[], time: number, fps: number): Annotation[] {
  const half = 0.5 / fps;
  return list.filter((a) => a.persist || Math.abs(a.time - time) <= half);
}

export function undoLast(list: Annotation[]): Annotation[] {
  return list.slice(0, -1);
}

/** Removes the drawings made on the frame at `time`; persistent ones stay. */
export function clearFrame(list: Annotation[], time: number, fps: number): Annotation[] {
  const half = 0.5 / fps;
  return list.filter((a) => a.persist || Math.abs(a.time - time) > half);
}

export function buildAnnotation(
  tool: DrawingTool,
  pts: Pt[],
  meta: { color: AnnotationColor; time: number; persist: boolean },
): Annotation | null {
  const base = { id: newAnnotationId(), ...meta };
  if (tool === "line") {
    return pts.length >= 2 ? { ...base, kind: "line", a: pts[0], b: pts[1] } : null;
  }
  if (tool === "angle") {
    return pts.length >= 3
      ? { ...base, kind: "angle", a: pts[0], vertex: pts[1], c: pts[2] }
      : null;
  }
  return pts.length >= MIN_PEN_POINTS ? { ...base, kind: "pen", points: pts } : null;
}
