// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useVisualViewport } from "./use-visual-viewport";

class FakeViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
}

afterEach(() => {
  // @ts-expect-error test cleanup
  delete window.visualViewport;
});

describe("useVisualViewport", () => {
  it("is null where the browser has no visual viewport", () => {
    const { result } = renderHook(() => useVisualViewport());
    expect(result.current).toBeNull();
  });

  it("reports the visible height and notices the keyboard opening and closing", () => {
    const vv = new FakeViewport();
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    const { result } = renderHook(() => useVisualViewport());
    expect(result.current).toEqual({ height: 800, offsetTop: 0, keyboardOpen: false });

    act(() => {
      vv.height = 480;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toEqual({ height: 480, offsetTop: 0, keyboardOpen: true });

    act(() => {
      vv.height = 800;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(result.current?.keyboardOpen).toBe(false);
  });
});
