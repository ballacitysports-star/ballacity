/**
 * Shared logic for the app's swipe navigation.
 *
 * Two gestures live here, both modelled on the iOS/Instagram behaviour:
 *
 *   - Swipe back: an edge drag from the left of a detail route pulls the page
 *     off to the right and pops history, the way a native back gesture does.
 *   - Swipe between tabs: a horizontal drag anywhere on a tab route moves to
 *     the neighbouring tab, in the same order the bottom bar shows.
 *
 * The decision-making is kept pure so it can be unit-tested without a browser;
 * the pointer plumbing that feeds it lives in use-swipe-navigation.
 */

/** A primary tab, in bottom-bar order. `match` mirrors BottomNav's active rule. */
export type TabDef = {
  to: string;
  label: string;
  match: (pathname: string) => boolean;
  /** False for a tab that is an action, not a place: swiping never pages into or out of it. */
  pageable?: boolean;
};

/**
 * The bottom bar renders these in order and the swipe gesture steps through
 * the pageable ones, so the two can never disagree about what "next tab" means.
 *
 * Players, Teams, Trainers and Gyms are one Discover tab (see DiscoverTabs).
 * Messages and alerts share the Inbox tab. Hosting a game is the Host button on Home.
 */
export const TABS: TabDef[] = [
  {
    to: "/feed",
    label: "Home",
    match: (p) => p === "/feed" || p === "/" || p === "/pickup",
  },
  {
    to: "/players",
    label: "Discover",
    match: (p) =>
      p.startsWith("/players") ||
      p.startsWith("/discover") ||
      p.startsWith("/trainers") ||
      p.startsWith("/teams") ||
      p === "/orgs" ||
      p.startsWith("/orgs/"),
  },
  {
    to: "/highlights",
    label: "Reels",
    match: (p) => p === "/highlights" || p.startsWith("/highlights/") || p === "/reels",
  },
  {
    to: "/messages",
    label: "Inbox",
    match: (p) => p.startsWith("/notifications") || p.startsWith("/messages"),
  },
  {
    to: "/profile",
    label: "Me",
    match: (p) => p.startsWith("/profile"),
  },
];

/** Guardians use the same bar; Kids and Parent Center are reached from Me. */
export const PARENT_TABS: TabDef[] = TABS;

export function tabsForMode(_parentMode = false): TabDef[] {
  return TABS;
}

/** Index of the tab owning `pathname`, or -1 when the route is not a tab. */
export function tabIndexForPath(pathname: string, tabs: TabDef[] = TABS): number {
  return tabs.findIndex((t) => t.match(pathname));
}

export function isTabPath(pathname: string, tabs: TabDef[] = TABS): boolean {
  // An action tab (Host) is a form, not a page to swipe away from: it keeps the edge back gesture.
  return (
    tabIndexForPath(
      pathname,
      tabs.filter((t) => t.pageable !== false),
    ) !== -1
  );
}

/**
 * The tab reached by swiping `direction`, or null at the ends of the bar.
 *
 * Direction is the finger's travel: dragging left ("left") advances to the
 * next tab, the way a horizontally paged surface behaves.
 */
export function adjacentTab(
  pathname: string,
  direction: "left" | "right",
  tabs: TabDef[] = TABS,
): string | null {
  const paged = tabs.filter((t) => t.pageable !== false);
  const index = tabIndexForPath(pathname, paged);
  if (index === -1) return null;
  const next = direction === "left" ? index + 1 : index - 1;
  if (next < 0 || next >= paged.length) return null;
  return paged[next]?.to ?? null;
}

/** How far from the left edge a drag must start to count as a back gesture. */
export const EDGE_ZONE_PX = 28;

/** Below this the drag is treated as a tap, not a swipe. */
export const MIN_SWIPE_PX = 10;

/**
 * A drag counts as horizontal only if it is clearly more sideways than
 * vertical. Without this, the gesture fights the page's vertical scrolling.
 */
export const DIRECTION_LOCK_RATIO = 1.5;

export function isHorizontalDrag(dx: number, dy: number): boolean {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < MIN_SWIPE_PX) return false;
  return ax > ay * DIRECTION_LOCK_RATIO;
}

/** Fraction of the viewport a drag must cross to commit on distance alone. */
export const COMMIT_DISTANCE_RATIO = 0.4;

/** px/ms past which a short-but-fast flick commits anyway. */
export const COMMIT_VELOCITY = 0.5;

/**
 * Whether a finished drag should navigate. Distance carries a slow,
 * deliberate drag; velocity carries a quick flick that never travelled far.
 */
export function shouldCommitSwipe(
  distancePx: number,
  velocityPxPerMs: number,
  viewportWidthPx: number,
): boolean {
  const distance = Math.abs(distancePx);
  const velocity = Math.abs(velocityPxPerMs);
  if (viewportWidthPx > 0 && distance > viewportWidthPx * COMMIT_DISTANCE_RATIO) return true;
  return velocity > COMMIT_VELOCITY && distance >= MIN_SWIPE_PX;
}

/** Opt an element (and its subtree) out of swipe navigation. */
export const NO_SWIPE_ATTR = "data-no-swipe";

/**
 * Elements that own horizontal dragging themselves, or where a stray
 * navigation would lose the user's work.
 */
const INTERACTIVE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "VIDEO", "CANVAS"]);

type MinimalElement = {
  tagName?: string;
  getAttribute?: (name: string) => string | null;
  hasAttribute?: (name: string) => boolean;
  parentElement?: MinimalElement | null;
  scrollWidth?: number;
  clientWidth?: number;
};

/**
 * Walk up from the gesture's target looking for a reason not to navigate:
 * a form control, an explicit opt-out, a slider, or anything that scrolls
 * horizontally on its own (a carousel, a code block, a wide table).
 *
 * `isHorizontallyScrollable` is injected because it needs computed styles,
 * which only the DOM can supply — this keeps the walk itself testable.
 */
export function shouldIgnoreGesture(
  target: MinimalElement | null | undefined,
  isHorizontallyScrollable: (el: MinimalElement) => boolean = () => false,
): boolean {
  let node: MinimalElement | null | undefined = target;
  let depth = 0;
  // Bounded so a malformed tree can never spin here.
  while (node && depth < 40) {
    const tag = node.tagName?.toUpperCase();
    if (tag && INTERACTIVE_TAGS.has(tag)) return true;
    if (node.hasAttribute?.(NO_SWIPE_ATTR)) return true;
    if (node.getAttribute?.("contenteditable") === "true") return true;
    const role = node.getAttribute?.("role");
    if (role === "slider" || role === "tablist") return true;
    if (isHorizontallyScrollable(node)) return true;
    node = node.parentElement;
    depth += 1;
  }
  return false;
}

export type SwipeIntent = { kind: "back" } | { kind: "tab"; to: string } | { kind: "none" };

/**
 * Turn a completed horizontal drag into what should happen.
 *
 * On a detail route only the left edge is armed, so mid-screen horizontal
 * drags stay available to whatever is under the finger. On a tab route the
 * whole surface pages between tabs.
 */
export function resolveSwipeIntent(input: {
  pathname: string;
  startX: number;
  dx: number;
  velocity: number;
  viewportWidth: number;
  canGoBack: boolean;
  /**
   * Whether tab paging applies at all. False for a signed-out visitor, for
   * whom "/" is the marketing page rather than the Home tab and the tab bar
   * is not on screen.
   */
  tabsEnabled?: boolean;
  tabs?: TabDef[];
}): SwipeIntent {
  const {
    pathname,
    startX,
    dx,
    velocity,
    viewportWidth,
    canGoBack,
    tabsEnabled = true,
    tabs = TABS,
  } = input;
  if (!shouldCommitSwipe(dx, velocity, viewportWidth)) return { kind: "none" };

  if (tabsEnabled && isTabPath(pathname, tabs)) {
    const to = adjacentTab(pathname, dx < 0 ? "left" : "right", tabs);
    return to ? { kind: "tab", to } : { kind: "none" };
  }

  // Otherwise treat it as a detail route: a rightward drag that began at the
  // left edge means "back".
  if (dx > 0 && startX <= EDGE_ZONE_PX && canGoBack) return { kind: "back" };
  return { kind: "none" };
}
