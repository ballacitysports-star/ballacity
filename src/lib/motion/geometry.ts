/**
 * Geometry for drawing on a video.
 *
 * Drawings are stored as points in the video's own frame, 0..1 in each
 * direction, so they stay on the same spot of the picture when the window is
 * resized, the phone is rotated, or the same drawing is painted onto a
 * full-size export. Angles are measured in the video's real pixel shape, not the
 * stretched 0..1 square, otherwise a 16:9 clip would misreport every angle.
 *
 * Pure and client-safe.
 */

export type Pt = { x: number; y: number };
export type Size = { w: number; h: number };
export type Rect = { x: number; y: number; w: number; h: number };

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);

/** Where a video of size `video` sits inside a `box` when it is shown with object-fit: contain. */
export function containRect(box: Size, video: Size): Rect {
  if (!(box.w > 0) || !(box.h > 0) || !(video.w > 0) || !(video.h > 0)) {
    return { x: 0, y: 0, w: Math.max(box.w, 0), h: Math.max(box.h, 0) };
  }
  const scale = Math.min(box.w / video.w, box.h / video.h);
  const w = video.w * scale;
  const h = video.h * scale;
  return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
}

/** A point on screen (pixels in the box) to a point in the video frame, kept inside it. */
export function toNormalized(px: Pt, rect: Rect): Pt {
  if (!(rect.w > 0) || !(rect.h > 0)) return { x: 0, y: 0 };
  return { x: clamp01((px.x - rect.x) / rect.w), y: clamp01((px.y - rect.y) / rect.h) };
}

export function fromNormalized(p: Pt, rect: Rect): Pt {
  return { x: rect.x + p.x * rect.w, y: rect.y + p.y * rect.h };
}

function toVideoPixels(p: Pt, size: Size): Pt {
  return { x: p.x * size.w, y: p.y * size.h };
}

/** The angle at `vertex` between the rays to `a` and `c`, in degrees (0..180). */
export function angleAtVertex(a: Pt, vertex: Pt, c: Pt, size: Size): number {
  const A = toVideoPixels(a, size);
  const B = toVideoPixels(vertex, size);
  const C = toVideoPixels(c, size);
  const v1 = { x: A.x - B.x, y: A.y - B.y };
  const v2 = { x: C.x - B.x, y: C.y - B.y };
  const m1 = Math.hypot(v1.x, v1.y);
  const m2 = Math.hypot(v2.x, v2.y);
  if (m1 === 0 || m2 === 0) return 0;
  const cos = Math.min(Math.max((v1.x * v2.x + v1.y * v2.y) / (m1 * m2), -1), 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * How far a line tilts from horizontal, in degrees (-90..90). Positive means it
 * rises to the right, the way people read a slope on screen.
 */
export function lineAngleFromHorizontal(a: Pt, b: Pt, size: Size): number {
  const A = toVideoPixels(a, size);
  const B = toVideoPixels(b, size);
  let dx = B.x - A.x;
  let dy = A.y - B.y; // screen y grows downward
  if (dx === 0 && dy === 0) return 0;
  if (dx < 0) {
    dx = -dx;
    dy = -dy;
  }
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

export function distance(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
