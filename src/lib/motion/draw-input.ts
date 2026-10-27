/**
 * Turning pointer events into drawings.
 *
 * Two ways of drawing a line or angle both work, because coaches use mice and
 * thumbs: drag from one end to the other, or tap each point in turn. An angle is
 * three points (an arm, the joint, the other arm), so it can be a drag for the
 * first two plus a tap for the third. A pen stroke is a drag.
 *
 * Pure: no DOM. Positions are 0..1 in the video frame (see geometry.ts).
 */

import {
  MIN_PEN_POINTS,
  PEN_MIN_STEP,
  newAnnotationId,
  pointsNeeded,
  type Annotation,
  type AnnotationColor,
  type DrawingTool,
} from "./annotations";
import { distance, type Pt } from "./geometry";

/** Movement (as a share of the frame) below which a press and release counts as a tap. */
export const DRAG_THRESHOLD = 0.02;

export type DrawState = {
  tool: DrawingTool;
  pts: Pt[];
  /** Where the pointer is now, for the live preview. */
  cursor: Pt | null;
  /** True between pressing down and letting go. */
  pressed: boolean;
  /** Where the current press began. */
  pressStart: Pt | null;
};

export type DrawResult = { state: DrawState; done: Pt[] | null };

export const emptyDraw = (tool: DrawingTool): DrawState => ({
  tool,
  pts: [],
  cursor: null,
  pressed: false,
  pressStart: null,
});

export function pointerDown(s: DrawState, p: Pt): DrawResult {
  if (s.tool === "pen") {
    return { state: { ...s, pts: [p], cursor: p, pressed: true, pressStart: p }, done: null };
  }
  const need = pointsNeeded(s.tool);
  if (s.pts.length === 0) {
    return { state: { ...s, pts: [p], cursor: p, pressed: true, pressStart: p }, done: null };
  }
  // A later tap adds the next point.
  const pts = [...s.pts, p];
  if (pts.length >= need) return { state: emptyDraw(s.tool), done: pts.slice(0, need) };
  return { state: { ...s, pts, cursor: p, pressed: false, pressStart: null }, done: null };
}

export function pointerMove(s: DrawState, p: Pt): DrawState {
  if (s.tool === "pen") {
    if (!s.pressed) return { ...s, cursor: p };
    const last = s.pts[s.pts.length - 1];
    if (last && distance(last, p) < PEN_MIN_STEP) return { ...s, cursor: p };
    return { ...s, pts: [...s.pts, p], cursor: p };
  }
  return { ...s, cursor: p };
}

export function pointerUp(s: DrawState, p: Pt): DrawResult {
  if (s.tool === "pen") {
    if (!s.pressed) return { state: s, done: null };
    const pts = s.pts.length > 1 || !s.pts[0] ? s.pts : [s.pts[0]];
    const done = pts.length >= MIN_PEN_POINTS ? pts : null;
    return { state: emptyDraw("pen"), done };
  }
  if (!s.pressed) return { state: s, done: null };
  const need = pointsNeeded(s.tool);
  const dragged = s.pressStart ? distance(s.pressStart, p) > DRAG_THRESHOLD : false;
  if (!dragged) {
    // A tap: keep the first point and wait for the next tap.
    return { state: { ...s, pressed: false, pressStart: null, cursor: p }, done: null };
  }
  const pts = [...s.pts, p];
  if (pts.length >= need) return { state: emptyDraw(s.tool), done: pts.slice(0, need) };
  return { state: { ...s, pts, cursor: p, pressed: false, pressStart: null }, done: null };
}

/** The in-progress drawing to show under the finger: points so far, plus the cursor. */
export function previewPoints(s: DrawState): Pt[] {
  if (s.tool === "pen") return s.pts;
  if (s.pts.length === 0) return [];
  return s.cursor ? [...s.pts, s.cursor] : s.pts;
}

/**
 * What to paint while a drawing is still being made: a line once there are two
 * points (even if the angle is only half done), the angle itself at three, and
 * a stroke as soon as the pen has moved.
 */
export function previewAnnotation(
  tool: DrawingTool,
  pts: Pt[],
  meta: { color: AnnotationColor; time: number },
): Annotation | null {
  const base = { id: newAnnotationId(), persist: false, ...meta };
  if (tool === "pen") return pts.length >= 2 ? { ...base, kind: "pen", points: pts } : null;
  if (tool === "angle" && pts.length >= 3) {
    return { ...base, kind: "angle", a: pts[0], vertex: pts[1], c: pts[2] };
  }
  return pts.length >= 2 ? { ...base, kind: "line", a: pts[0], b: pts[1] } : null;
}
