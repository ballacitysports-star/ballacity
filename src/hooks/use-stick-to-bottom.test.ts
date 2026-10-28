// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { NEAR_BOTTOM_PX, isNearBottom, useStickToBottom } from "./use-stick-to-bottom";

function scroller(metrics: { scrollHeight: number; clientHeight: number }) {
  const el = document.createElement("div");
  let top = 0;
  Object.defineProperty(el, "scrollHeight", { get: () => metrics.scrollHeight });
  Object.defineProperty(el, "clientHeight", { get: () => metrics.clientHeight });
  Object.defineProperty(el, "scrollTop", { get: () => top, set: (v: number) => (top = v) });
  return el;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("isNearBottom", () => {
  it("is true within the threshold of the end and false further up", () => {
    expect(isNearBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 })).toBe(true);
    expect(
      isNearBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 - NEAR_BOTTOM_PX }),
    ).toBe(false);
  });
});

describe("useStickToBottom", () => {
  it("starts at the newest message and follows new ones while the reader is at the bottom", async () => {
    const metrics = { scrollHeight: 1000, clientHeight: 400 };
    const el = scroller(metrics);
    const { result } = renderHook(() => useStickToBottom());
    act(() => result.current.ref(el));
    expect(el.scrollTop).toBe(1000);

    metrics.scrollHeight = 1200;
    el.appendChild(document.createElement("div")); // a new message
    await tick();
    expect(el.scrollTop).toBe(1200);
  });

  it("leaves the reader alone once they have scrolled up", async () => {
    const metrics = { scrollHeight: 1000, clientHeight: 400 };
    const el = scroller(metrics);
    const { result } = renderHook(() => useStickToBottom());
    act(() => result.current.ref(el));

    el.scrollTop = 100; // reading older messages
    el.dispatchEvent(new Event("scroll"));
    metrics.scrollHeight = 1200;
    el.appendChild(document.createElement("div"));
    await tick();
    expect(el.scrollTop).toBe(100);
  });

  it("pinNow brings the list to the bottom even after scrolling up", () => {
    const metrics = { scrollHeight: 1000, clientHeight: 400 };
    const el = scroller(metrics);
    const { result } = renderHook(() => useStickToBottom());
    act(() => result.current.ref(el));
    el.scrollTop = 100;
    el.dispatchEvent(new Event("scroll"));
    act(() => result.current.pinNow());
    expect(el.scrollTop).toBe(1000);
  });
});
