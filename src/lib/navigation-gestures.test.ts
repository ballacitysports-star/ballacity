import { describe, expect, it } from "vitest";
import {
  adjacentTab,
  isHorizontalDrag,
  isTabPath,
  NO_SWIPE_ATTR,
  resolveSwipeIntent,
  shouldCommitSwipe,
  shouldIgnoreGesture,
  TABS,
  PARENT_TABS,
  tabIndexForPath,
} from "./navigation-gestures";

/** Minimal stand-in for a DOM node, enough for the ancestor walk. */
type TestNode = {
  tagName: string;
  getAttribute: (name: string) => string | null;
  hasAttribute: (name: string) => boolean;
  parentElement: TestNode | null;
};

function el(
  props: {
    tagName?: string;
    attrs?: Record<string, string>;
    parent?: TestNode | null;
  } = {},
): TestNode {
  const attrs = props.attrs ?? {};
  return {
    tagName: props.tagName ?? "DIV",
    getAttribute: (name: string) => attrs[name] ?? null,
    hasAttribute: (name: string) => name in attrs,
    parentElement: props.parent ?? null,
  };
}

describe("tab resolution", () => {
  it("maps each tab's own path to itself", () => {
    for (const tab of TABS) {
      expect(TABS[tabIndexForPath(tab.to)]?.to).toBe(tab.to);
    }
  });

  it("treats / and /pickup as the feed tab", () => {
    expect(TABS[tabIndexForPath("/")]?.to).toBe("/feed");
    expect(TABS[tabIndexForPath("/pickup")]?.to).toBe("/feed");
  });

  it("folds discover and trainers into the players tab", () => {
    expect(TABS[tabIndexForPath("/discover")]?.to).toBe("/players");
    expect(TABS[tabIndexForPath("/trainers")]?.to).toBe("/players");
  });

  it("does not treat a detail route as a tab", () => {
    expect(tabIndexForPath("/games/abc")).toBe(-1);
    expect(isTabPath("/games/abc")).toBe(false);
    expect(isTabPath("/settings")).toBe(false);
  });

  it("uses family destinations in Parent Mode", () => {
    expect(PARENT_TABS.map((tab) => tab.to)).toEqual([
      "/feed",
      "/players",
      "/teams",
      "/guardian",
      "/parent",
      "/notifications",
    ]);
    expect(PARENT_TABS[tabIndexForPath("/guardian", PARENT_TABS)]?.to).toBe("/guardian");
    expect(PARENT_TABS[tabIndexForPath("/parent/consent/abc", PARENT_TABS)]?.to).toBe("/parent");
  });
});

describe("adjacentTab", () => {
  it("steps forward when the finger travels left", () => {
    expect(adjacentTab("/feed", "left")).toBe("/players");
    expect(adjacentTab("/players", "left")).toBe("/teams");
  });

  it("steps backward when the finger travels right", () => {
    expect(adjacentTab("/teams", "right")).toBe("/players");
  });

  it("stops at both ends rather than wrapping", () => {
    expect(adjacentTab(TABS[0]!.to, "right")).toBeNull();
    expect(adjacentTab(TABS[TABS.length - 1]!.to, "left")).toBeNull();
  });

  it("returns null for a route that is not a tab", () => {
    expect(adjacentTab("/games/abc", "left")).toBeNull();
  });

  it("steps through guardian destinations in Parent Mode", () => {
    expect(adjacentTab("/teams", "left", PARENT_TABS)).toBe("/guardian");
    expect(adjacentTab("/guardian", "left", PARENT_TABS)).toBe("/parent");
  });
});

describe("isHorizontalDrag", () => {
  it("ignores drags too short to be intentional", () => {
    expect(isHorizontalDrag(4, 0)).toBe(false);
  });

  it("accepts a clearly sideways drag", () => {
    expect(isHorizontalDrag(60, 10)).toBe(true);
    expect(isHorizontalDrag(-60, 10)).toBe(true);
  });

  it("rejects a drag that is mostly vertical, so scrolling still works", () => {
    expect(isHorizontalDrag(30, 40)).toBe(false);
    expect(isHorizontalDrag(20, 100)).toBe(false);
  });

  it("rejects a diagonal that is not decisively horizontal", () => {
    expect(isHorizontalDrag(30, 25)).toBe(false);
  });
});

describe("shouldCommitSwipe", () => {
  const width = 400;

  it("commits a slow drag that crossed enough of the screen", () => {
    expect(shouldCommitSwipe(200, 0.01, width)).toBe(true);
  });

  it("does not commit a slow drag that barely moved", () => {
    expect(shouldCommitSwipe(40, 0.01, width)).toBe(false);
  });

  it("commits a short but fast flick", () => {
    expect(shouldCommitSwipe(30, 1.2, width)).toBe(true);
  });

  it("ignores a fast flick that never really moved", () => {
    expect(shouldCommitSwipe(3, 2, width)).toBe(false);
  });

  it("treats direction as irrelevant", () => {
    expect(shouldCommitSwipe(-200, 0.01, width)).toBe(true);
  });
});

describe("shouldIgnoreGesture", () => {
  it("passes over ordinary containers", () => {
    expect(shouldIgnoreGesture(el({ parent: el() }))).toBe(false);
  });

  it("blocks form controls so typing and dragging a field are safe", () => {
    expect(shouldIgnoreGesture(el({ tagName: "INPUT" }))).toBe(true);
    expect(shouldIgnoreGesture(el({ tagName: "TEXTAREA" }))).toBe(true);
    expect(shouldIgnoreGesture(el({ tagName: "SELECT" }))).toBe(true);
  });

  it("blocks a control nested below the gesture target", () => {
    const input = el({ tagName: "INPUT" });
    expect(shouldIgnoreGesture(el({ parent: input }))).toBe(true);
  });

  it("honours an explicit opt-out anywhere up the tree", () => {
    const optedOut = el({ attrs: { [NO_SWIPE_ATTR]: "" } });
    expect(shouldIgnoreGesture(el({ parent: el({ parent: optedOut }) }))).toBe(true);
  });

  it("blocks contenteditable and sliders", () => {
    expect(shouldIgnoreGesture(el({ attrs: { contenteditable: "true" } }))).toBe(true);
    expect(shouldIgnoreGesture(el({ attrs: { role: "slider" } }))).toBe(true);
  });

  it("blocks anything that scrolls horizontally on its own", () => {
    const carousel = el();
    expect(shouldIgnoreGesture(el({ parent: carousel }), (n) => n === carousel)).toBe(true);
  });

  it("handles a missing target", () => {
    expect(shouldIgnoreGesture(null)).toBe(false);
    expect(shouldIgnoreGesture(undefined)).toBe(false);
  });

  it("terminates on a cyclic tree instead of hanging", () => {
    const a: TestNode = el();
    a.parentElement = a;
    expect(shouldIgnoreGesture(a)).toBe(false);
  });
});

describe("resolveSwipeIntent", () => {
  const base = { velocity: 0, viewportWidth: 400, canGoBack: true };

  it("pages to the next tab when dragging left on a tab route", () => {
    const intent = resolveSwipeIntent({ ...base, pathname: "/feed", startX: 200, dx: -200 });
    expect(intent).toEqual({ kind: "tab", to: "/players" });
  });

  it("pages to the previous tab when dragging right on a tab route", () => {
    const intent = resolveSwipeIntent({ ...base, pathname: "/teams", startX: 200, dx: 200 });
    expect(intent).toEqual({ kind: "tab", to: "/players" });
  });

  it("does nothing at the first tab dragging right", () => {
    const intent = resolveSwipeIntent({ ...base, pathname: "/feed", startX: 200, dx: 200 });
    expect(intent).toEqual({ kind: "none" });
  });

  it("goes back on an edge drag from a detail route", () => {
    const intent = resolveSwipeIntent({ ...base, pathname: "/games/abc", startX: 8, dx: 200 });
    expect(intent).toEqual({ kind: "back" });
  });

  it("ignores a rightward drag that began away from the edge", () => {
    const intent = resolveSwipeIntent({ ...base, pathname: "/games/abc", startX: 180, dx: 200 });
    expect(intent).toEqual({ kind: "none" });
  });

  it("ignores a leftward drag on a detail route", () => {
    const intent = resolveSwipeIntent({ ...base, pathname: "/games/abc", startX: 8, dx: -200 });
    expect(intent).toEqual({ kind: "none" });
  });

  it("does not go back when there is no history to pop", () => {
    const intent = resolveSwipeIntent({
      ...base,
      pathname: "/games/abc",
      startX: 8,
      dx: 200,
      canGoBack: false,
    });
    expect(intent).toEqual({ kind: "none" });
  });

  it("does nothing when the drag never met the commit threshold", () => {
    const intent = resolveSwipeIntent({ ...base, pathname: "/feed", startX: 200, dx: -20 });
    expect(intent).toEqual({ kind: "none" });
  });

  it("does not page tabs for a signed-out visitor on the landing page", () => {
    // "/" is the marketing page when signed out, so a swipe must not carry
    // them into /players and straight to the auth wall.
    const intent = resolveSwipeIntent({
      ...base,
      pathname: "/",
      startX: 200,
      dx: -200,
      tabsEnabled: false,
    });
    expect(intent).toEqual({ kind: "none" });
  });

  it("still allows the back gesture when tab paging is off", () => {
    const intent = resolveSwipeIntent({
      ...base,
      pathname: "/feed",
      startX: 8,
      dx: 200,
      tabsEnabled: false,
    });
    expect(intent).toEqual({ kind: "back" });
  });

  it("commits a flick that was fast but short", () => {
    const intent = resolveSwipeIntent({
      ...base,
      pathname: "/feed",
      startX: 200,
      dx: -30,
      velocity: -1.5,
    });
    expect(intent).toEqual({ kind: "tab", to: "/players" });
  });
});
