// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DistanceSlider } from "./DistanceSlider";

beforeAll(() => {
  // Radix measures the thumb; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

/** True when the element or anything above it inside the render is faded with an opacity class. */
function faded(el: Element | null, root: Element): boolean {
  for (let n = el; n && n !== root.parentElement; n = n.parentElement) {
    if (/(^|\s)opacity-/.test(n.getAttribute("class") ?? "")) return true;
  }
  return false;
}

describe("DistanceSlider", () => {
  it("shows the current limit when enabled", () => {
    render(<DistanceSlider valueMi={null} onChange={vi.fn()} unit="mi" />);
    expect(screen.getByText("Any distance")).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Distance" }).hasAttribute("data-disabled")).toBe(
      false,
    );
  });

  it("when disabled, says the filter is off and keeps every label at full contrast", () => {
    const { container } = render(
      <DistanceSlider valueMi={null} onChange={vi.fn()} unit="mi" disabled />,
    );
    const root = container.firstElementChild!;
    expect(root.getAttribute("aria-disabled")).toBe("true");

    // Faded to 50% the 10px muted stop labels read 2.5:1; at full opacity they read 6.7:1.
    const value = screen.getByText("Distance filter off");
    const any = screen.getByText("Any");
    for (const label of [value, any]) expect(faded(label, root)).toBe(false);

    // Only the track and thumb fade, and the control is disabled.
    const slider = screen.getByRole("slider", { name: "Distance" });
    expect(slider.hasAttribute("data-disabled")).toBe(true);
    expect(faded(slider, root)).toBe(true);
  });
});
