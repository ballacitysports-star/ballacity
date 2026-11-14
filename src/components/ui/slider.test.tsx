// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Slider } from "./slider";

beforeAll(() => {
  // Radix measures the thumb; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

describe("Slider", () => {
  it("names the role=slider element, not the wrapper around it", () => {
    render(<Slider value={[25]} min={0} max={100} aria-label="Distance radius" />);

    const slider = screen.getByRole("slider", { name: "Distance radius" });
    expect(slider.getAttribute("aria-valuenow")).toBe("25");
    // Exactly one element carries the name: the wrapper does not repeat it.
    expect(document.querySelectorAll('[aria-label="Distance radius"]')).toHaveLength(1);
  });

  it("forwards aria-labelledby and aria-valuetext to the thumb", () => {
    render(
      <>
        <span id="radius-label">Radius</span>
        <Slider
          value={[3]}
          min={0}
          max={10}
          aria-labelledby="radius-label"
          aria-valuetext="Within 3 mi"
        />
      </>,
    );

    const slider = screen.getByRole("slider", { name: "Radius" });
    expect(slider.getAttribute("aria-valuetext")).toBe("Within 3 mi");
  });
});
