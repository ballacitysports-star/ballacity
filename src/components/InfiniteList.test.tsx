// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InfiniteList } from "./InfiniteList";

type Observed = { callback: IntersectionObserverCallback; disconnect: ReturnType<typeof vi.fn> };
let observers: Observed[] = [];

beforeEach(() => {
  observers = [];
  class FakeObserver {
    disconnect = vi.fn();
    constructor(callback: IntersectionObserverCallback) {
      observers.push({ callback, disconnect: this.disconnect });
    }
    observe() {}
    unobserve() {}
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  // Run animation frames synchronously so the reveal can be asserted directly.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const items = Array.from({ length: 14 }, (_, i) => `item-${i + 1}`);
const list = (props: Partial<Parameters<typeof InfiniteList<string>>[0]> = {}) => (
  <InfiniteList
    items={items}
    pageSize={6}
    keyFor={(x) => x}
    renderItem={(x) => <span>{x}</span>}
    {...props}
  />
);

/** The newest observer reports the sentinel entering view. */
function scrollToSentinel() {
  const last = observers[observers.length - 1];
  act(() => {
    last.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as never);
  });
}

describe("InfiniteList", () => {
  it("shows the first page and how many remain", () => {
    render(list());
    expect(screen.getByText("item-6")).toBeTruthy();
    expect(screen.queryByText("item-7")).toBeNull();
    expect(screen.getByText("Showing 6 of 14")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load 6 more" })).toBeTruthy();
  });

  it("the Load more button reveals the next page, and the last page is partial", () => {
    render(list());
    fireEvent.click(screen.getByRole("button", { name: "Load 6 more" }));
    expect(screen.getByText("item-12")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load 2 more" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load 2 more" }));
    expect(screen.getByText("item-14")).toBeTruthy();
    // Everything shown: no button, no counter, no sentinel.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/Showing/)).toBeNull();
  });

  it("scrolling the sentinel into view loads the next page", () => {
    render(list());
    scrollToSentinel();
    expect(screen.getByText("item-12")).toBeTruthy();
    expect(screen.getByText("Showing 12 of 14")).toBeTruthy();
  });

  it("stops observing once everything is shown", () => {
    render(list({ items: items.slice(0, 7) }));
    scrollToSentinel();
    expect(screen.getByText("item-7")).toBeTruthy();
    expect(observers.every((o) => o.disconnect.mock.calls.length > 0)).toBe(true);
  });

  it("shows the empty state for no items", () => {
    render(list({ items: [], emptyState: <p>Nothing here yet</p> }));
    expect(screen.getByText("Nothing here yet")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("starts again from the first page when the reset key changes", () => {
    const { rerender } = render(list({ resetKey: "all" }));
    fireEvent.click(screen.getByRole("button", { name: "Load 6 more" }));
    expect(screen.getByText("item-12")).toBeTruthy();
    rerender(list({ resetKey: "following" }));
    expect(screen.queryByText("item-7")).toBeNull();
    expect(screen.getByText("Showing 6 of 14")).toBeTruthy();
  });

  it("never shows more than there are", () => {
    render(list({ items: items.slice(0, 3) }));
    expect(screen.getByText("item-3")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
