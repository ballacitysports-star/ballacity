import * as React from "react";

export type Point = { x: number; y: number };

type Params = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  scale: number;
  setScale: (v: number) => void;
  offset: Point;
  setOffset: (p: Point) => void;
  minScale: number;
  maxScale: number;
  /** Hard bounds for the offset at a given scale. */
  clamp: (x: number, y: number, s: number) => Point;
  enabled?: boolean;
};

/** How far past the hard bound a drag is allowed to rubber-band. */
const RUBBER_LIMIT = 90;
/** Zoom factor applied by a double-tap when the view is at minimum scale. */
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 24;

function rubber(delta: number, limit = RUBBER_LIMIT) {
  // Asymptotic resistance — the further you pull, the less it moves.
  const sign = delta < 0 ? -1 : 1;
  const d = Math.abs(delta);
  return sign * (1 - 1 / (d / limit + 1)) * limit;
}

/**
 * Facebook-style pan / pinch / double-tap gestures for the crop surface.
 *
 * Panning past the edge rubber-bands and springs back on release, pinching
 * anchors on the gesture's focal point, and `interacting` is true while a
 * gesture is in flight so callers can reveal the rule-of-thirds grid.
 */
export function useCropGestures({
  containerRef,
  scale,
  setScale,
  offset,
  setOffset,
  minScale,
  maxScale,
  clamp,
  enabled = true,
}: Params) {
  const [interacting, setInteracting] = React.useState(false);
  const [springing, setSpringing] = React.useState(false);
  const pointersRef = React.useRef<Map<number, Point>>(new Map());
  const rafRef = React.useRef<number | null>(null);
  const lastTapRef = React.useRef<{ t: number; x: number; y: number } | null>(null);
  const movedRef = React.useRef(false);
  const gestureRef = React.useRef({
    mode: "none" as "none" | "pan" | "pinch",
    startOffset: { x: 0, y: 0 } as Point,
    startScale: 1,
    startCenter: { x: 0, y: 0 } as Point,
    startDist: 0,
  });

  // Latest values, so the imperative handlers never read stale state.
  const latest = React.useRef({ scale, offset, minScale, maxScale, clamp });
  latest.current = { scale, offset, minScale, maxScale, clamp };

  React.useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const center = React.useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, [containerRef]);

  /** Animate the offset back inside the hard bounds after an over-drag. */
  const springBack = React.useCallback(() => {
    const { offset: from, scale: s, clamp: cl } = latest.current;
    const to = cl(from.x, from.y, s);
    if (Math.abs(to.x - from.x) < 0.5 && Math.abs(to.y - from.y) < 0.5) {
      setOffset(to);
      return;
    }
    setSpringing(true);
    const start = performance.now();
    const dur = 260;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      setOffset({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else {
        rafRef.current = null;
        setSpringing(false);
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }, [setOffset]);

  /** Zoom keeping the point under (cx, cy) fixed on screen. */
  const zoomAround = React.useCallback(
    (nextScale: number, cx: number, cy: number) => {
      const { scale: s, offset: o, minScale: mn, maxScale: mx, clamp: cl } = latest.current;
      const next = Math.max(mn, Math.min(mx, nextScale));
      const c = center();
      if (!c) {
        setScale(next);
        return;
      }
      const focalX = (cx - c.x - o.x) / s;
      const focalY = (cy - c.y - o.y) / s;
      setScale(next);
      setOffset(cl(cx - c.x - focalX * next, cy - c.y - focalY * next, next));
    },
    [center, setOffset, setScale],
  );

  const startGesture = React.useCallback(() => {
    const pts = Array.from(pointersRef.current.values());
    const { scale: s, offset: o } = latest.current;
    if (pts.length === 1) {
      gestureRef.current = {
        mode: "pan",
        startOffset: { ...o },
        startScale: s,
        startCenter: { ...pts[0] },
        startDist: 0,
      };
    } else if (pts.length >= 2) {
      const [a, b] = pts;
      gestureRef.current = {
        mode: "pinch",
        startOffset: { ...o },
        startScale: s,
        startCenter: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      };
    } else {
      gestureRef.current.mode = "none";
    }
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!enabled) return;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setSpringing(false);
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    movedRef.current = false;
    setInteracting(true);
    startGesture();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!enabled) return;
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gestureRef.current;
    const pts = Array.from(pointersRef.current.values());
    const { scale: s, clamp: cl } = latest.current;

    if (g.mode === "pan" && pts.length === 1) {
      const dx = pts[0].x - g.startCenter.x;
      const dy = pts[0].y - g.startCenter.y;
      if (Math.hypot(dx, dy) > 4) movedRef.current = true;
      const raw = { x: g.startOffset.x + dx, y: g.startOffset.y + dy };
      const hard = cl(raw.x, raw.y, s);
      // Allow a damped overshoot past the hard bound (springs back on release).
      setOffset({
        x: hard.x + rubber(raw.x - hard.x),
        y: hard.y + rubber(raw.y - hard.y),
      });
    } else if (g.mode === "pinch" && pts.length >= 2) {
      movedRef.current = true;
      const [a, b] = pts;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const nextScale = Math.max(
        latest.current.minScale,
        Math.min(latest.current.maxScale, g.startScale * (dist / g.startDist)),
      );
      const c = center();
      if (c) {
        const focalX = (g.startCenter.x - c.x - g.startOffset.x) / g.startScale;
        const focalY = (g.startCenter.y - c.y - g.startOffset.y) / g.startScale;
        setScale(nextScale);
        setOffset(cl(cx - c.x - focalX * nextScale, cy - c.y - focalY * nextScale, nextScale));
      } else {
        setScale(nextScale);
      }
    }
  };

  const maybeDoubleTap = (e: React.PointerEvent) => {
    if (movedRef.current) return;
    const now = performance.now();
    const prev = lastTapRef.current;
    lastTapRef.current = { t: now, x: e.clientX, y: e.clientY };
    if (
      prev &&
      now - prev.t < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_SLOP
    ) {
      lastTapRef.current = null;
      const { scale: s, minScale: mn, maxScale: mx } = latest.current;
      const zoomedIn = s > mn * 1.05;
      if (zoomedIn) {
        setScale(mn);
        setOffset({ x: 0, y: 0 });
      } else {
        zoomAround(Math.min(mx, mn * DOUBLE_TAP_ZOOM), e.clientX, e.clientY);
      }
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    if (!enabled) return;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    const wasTracked = pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size === 0) {
      gestureRef.current.mode = "none";
      setInteracting(false);
      if (wasTracked && e.type === "pointerup") maybeDoubleTap(e);
      springBack();
    } else {
      startGesture();
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!enabled) return;
    e.preventDefault();
    const { scale: s } = latest.current;
    zoomAround(s * (1 + -e.deltaY * 0.0015), e.clientX, e.clientY);
  };

  return {
    interacting,
    /** True while the spring-back animation runs — skip CSS transitions then. */
    springing,
    zoomAround,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
      onPointerLeave: endPointer,
      onWheel,
    },
  };
}
