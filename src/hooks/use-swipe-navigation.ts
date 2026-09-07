import { useCallback, useRef, useState } from "react";
import {
  EDGE_ZONE_PX,
  isHorizontalDrag,
  isTabPath,
  resolveSwipeIntent,
  shouldIgnoreGesture,
  type SwipeIntent,
} from "@/lib/navigation-gestures";

/**
 * Pointer plumbing for the app's swipe navigation.
 *
 * Tracks one horizontal drag at a time and reports how far it has travelled so
 * the page can follow the finger, then hands the finished drag to
 * `resolveSwipeIntent` to decide whether it navigates.
 *
 * Three things keep this from fighting the rest of the UI:
 *   - touch and pen only, so a mouse can still select text and drag normally;
 *   - a direction lock, so a gesture that starts vertical stays a scroll and
 *     is never reconsidered;
 *   - an ancestor check, so carousels, sliders and form fields keep their own
 *     horizontal drags.
 */

/** Only the left edge arms a back gesture, so mid-screen drags stay free. */
function armedForRoute(pathname: string, startX: number, tabsEnabled: boolean): boolean {
  if (tabsEnabled && isTabPath(pathname)) return true;
  return startX <= EDGE_ZONE_PX;
}

function isHorizontallyScrollable(node: unknown): boolean {
  if (typeof window === "undefined") return false;
  const el = node as Element | null;
  if (!el || typeof (el as HTMLElement).scrollWidth !== "number") return false;
  const html = el as HTMLElement;
  if (html.scrollWidth <= html.clientWidth + 1) return false;
  const overflowX = window.getComputedStyle(html).overflowX;
  return overflowX === "auto" || overflowX === "scroll";
}

type Options = {
  pathname: string;
  canGoBack: boolean;
  onCommit: (intent: SwipeIntent) => void;
  /** Whether tab paging applies; false for a signed-out visitor. */
  tabsEnabled?: boolean;
  /** Skip entirely — e.g. on desktop, or while a modal owns the screen. */
  disabled?: boolean;
};

type PointerLike = {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  target: EventTarget | null;
  currentTarget: EventTarget | null;
};

export type SwipeState = {
  /** Live horizontal travel in px; 0 when no gesture is in flight. */
  dx: number;
  /** True once the drag has locked horizontal and is driving the page. */
  active: boolean;
  /** Which gesture the current drag would perform if released now. */
  intent: SwipeIntent["kind"];
};

const IDLE: SwipeState = { dx: 0, active: false, intent: "none" };

export function useSwipeNavigation({
  pathname,
  canGoBack,
  onCommit,
  tabsEnabled = true,
  disabled,
}: Options) {
  const [state, setState] = useState<SwipeState>(IDLE);

  const gesture = useRef<{
    id: number;
    startX: number;
    startY: number;
    startTime: number;
    lastX: number;
    lastTime: number;
    velocity: number;
    locked: "horizontal" | "vertical" | null;
  } | null>(null);

  const reset = useCallback(() => {
    gesture.current = null;
    setState(IDLE);
  }, []);

  const onPointerDown = useCallback(
    (event: PointerLike) => {
      if (disabled) return;
      // Mouse drags are left alone: text selection and click-drag stay normal.
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      if (gesture.current) return;
      if (!armedForRoute(pathname, event.clientX, tabsEnabled)) return;
      if (shouldIgnoreGesture(event.target as never, isHorizontallyScrollable as never)) return;

      const now = Date.now();
      gesture.current = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startTime: now,
        lastX: event.clientX,
        lastTime: now,
        velocity: 0,
        locked: null,
      };
    },
    [disabled, pathname, tabsEnabled],
  );

  const onPointerMove = useCallback(
    (event: PointerLike) => {
      const g = gesture.current;
      if (!g || g.id !== event.pointerId) return;

      const dx = event.clientX - g.startX;
      const dy = event.clientY - g.startY;

      // Decide once what kind of gesture this is, then stick to it. Revisiting
      // the choice mid-drag is what makes swipe layers feel twitchy.
      if (g.locked === null) {
        if (isHorizontalDrag(dx, dy)) {
          g.locked = "horizontal";
        } else if (Math.abs(dy) > Math.abs(dx)) {
          g.locked = "vertical";
          reset();
          return;
        } else {
          return; // Too early to tell.
        }
      }
      if (g.locked !== "horizontal") return;

      const now = Date.now();
      const elapsed = now - g.lastTime;
      if (elapsed > 0) {
        // Smoothed so one jittery frame cannot dominate the release decision.
        const instant = (event.clientX - g.lastX) / elapsed;
        g.velocity = g.velocity * 0.7 + instant * 0.3;
        g.lastX = event.clientX;
        g.lastTime = now;
      }

      const width = typeof window === "undefined" ? 0 : window.innerWidth;
      const intent = resolveSwipeIntent({
        pathname,
        startX: g.startX,
        dx,
        // Ask what a release would do at this instant, ignoring flick speed, so
        // the visual hint reflects the drag actually on screen.
        velocity: 0,
        viewportWidth: width,
        canGoBack,
        tabsEnabled,
      });

      setState({ dx, active: true, intent: intent.kind });
    },
    [canGoBack, pathname, reset, tabsEnabled],
  );

  const onPointerUp = useCallback(
    (event: PointerLike) => {
      const g = gesture.current;
      if (!g || g.id !== event.pointerId) return;

      if (g.locked === "horizontal") {
        const dx = event.clientX - g.startX;
        const width = typeof window === "undefined" ? 0 : window.innerWidth;
        const intent = resolveSwipeIntent({
          pathname,
          startX: g.startX,
          dx,
          velocity: g.velocity,
          viewportWidth: width,
          canGoBack,
          tabsEnabled,
        });
        if (intent.kind !== "none") {
          reset();
          onCommit(intent);
          return;
        }
      }
      reset();
    },
    [canGoBack, onCommit, pathname, reset, tabsEnabled],
  );

  return {
    state,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: reset,
    },
  };
}
