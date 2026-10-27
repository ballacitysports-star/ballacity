/**
 * Paints drawings onto a canvas: on screen over the playing video, and again,
 * larger, when a frame or kinogram is saved. One routine for both so what you see
 * is what you export.
 *
 * Client-only (needs a 2D canvas context); logic is kept here, not in the
 * component, so it can be tested with a recording stub.
 */

import { ANNOTATION_COLORS, type Annotation } from "./annotations";
import {
  angleAtVertex,
  fromNormalized,
  lineAngleFromHorizontal,
  type Pt,
  type Rect,
  type Size,
} from "./geometry";

/** The slice of CanvasRenderingContext2D this file uses, so tests can pass a stand-in. */
export type Ctx2D = Pick<
  CanvasRenderingContext2D,
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "stroke"
  | "arc"
  | "fill"
  | "fillRect"
  | "fillText"
  | "measureText"
  | "save"
  | "restore"
> & {
  strokeStyle: CanvasRenderingContext2D["strokeStyle"];
  fillStyle: CanvasRenderingContext2D["fillStyle"];
  lineWidth: number;
  lineCap: CanvasRenderingContext2D["lineCap"];
  lineJoin: CanvasRenderingContext2D["lineJoin"];
  font: string;
  textBaseline: CanvasRenderingContext2D["textBaseline"];
  textAlign: CanvasRenderingContext2D["textAlign"];
};

/** Stroke width and label size grow with the picture, so exports look like the screen. */
export function strokeWidthFor(rectWidth: number): number {
  return Math.max(2, rectWidth / 240);
}

export function labelSizeFor(rectWidth: number): number {
  return Math.max(12, rectWidth / 34);
}

function label(ctx: Ctx2D, text: string, at: Pt, size: number) {
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const w = ctx.measureText(text).width + size * 0.9;
  const h = size * 1.5;
  ctx.fillStyle = "rgba(0,0,0,0.72)";
  ctx.fillRect(at.x - w / 2, at.y - h / 2, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, at.x, at.y);
}

function handle(ctx: Ctx2D, p: Pt, r: number, color: string) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/** `rect` is where the video sits on the canvas, in canvas pixels; `size` is the video's own size. */
export function paintAnnotation(ctx: Ctx2D, a: Annotation, rect: Rect, size: Size): void {
  if (!(rect.w > 0) || !(rect.h > 0)) return;
  const color = ANNOTATION_COLORS[a.color];
  const lw = strokeWidthFor(rect.w);
  const text = labelSizeFor(rect.w);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (a.kind === "pen") {
    const pts = a.points.map((p) => fromNormalized(p, rect));
    if (pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
  } else if (a.kind === "line") {
    const p = fromNormalized(a.a, rect);
    const q = fromNormalized(a.b, rect);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
    handle(ctx, p, lw * 1.6, color);
    handle(ctx, q, lw * 1.6, color);
    const tilt = lineAngleFromHorizontal(a.a, a.b, size);
    label(
      ctx,
      `${Math.abs(tilt).toFixed(1)}°`,
      { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 - text },
      text,
    );
  } else {
    const p = fromNormalized(a.a, rect);
    const v = fromNormalized(a.vertex, rect);
    const q = fromNormalized(a.c, rect);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(v.x, v.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
    handle(ctx, p, lw * 1.4, color);
    handle(ctx, v, lw * 1.9, color);
    handle(ctx, q, lw * 1.4, color);
    // A small arc between the two arms, and the angle in degrees beside it.
    const a1 = Math.atan2(p.y - v.y, p.x - v.x);
    const a2 = Math.atan2(q.y - v.y, q.x - v.x);
    const radius = Math.max(
      lw * 5,
      Math.min(Math.hypot(p.x - v.x, p.y - v.y), Math.hypot(q.x - v.x, q.y - v.y)) * 0.28,
    );
    let delta = a2 - a1;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    ctx.beginPath();
    ctx.arc(v.x, v.y, radius, a1, a1 + delta, delta < 0);
    ctx.stroke();
    const mid = a1 + delta / 2;
    const deg = angleAtVertex(a.a, a.vertex, a.c, size);
    label(
      ctx,
      `${deg.toFixed(1)}°`,
      {
        x: v.x + Math.cos(mid) * (radius + text * 1.6),
        y: v.y + Math.sin(mid) * (radius + text * 1.6),
      },
      text,
    );
  }
  ctx.restore();
}

export function paintAnnotations(ctx: Ctx2D, list: Annotation[], rect: Rect, size: Size): void {
  for (const a of list) paintAnnotation(ctx, a, rect, size);
}
