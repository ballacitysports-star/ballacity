// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { act, cleanup, render } from "@testing-library/react";
import { clearOfHelpLauncher, HELP_LAUNCHER_CLEARANCE_VAR } from "./launcher-clearance";

const clearance = () =>
  document.documentElement.style.getPropertyValue(HELP_LAUNCHER_CLEARANCE_VAR);

/** jsdom has no layout: give every element the box a fixed bottom bar would have. */
function layout(box: { top: number; height: number }) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        ...box,
        bottom: box.top + box.height,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: 0,
      }) as DOMRect,
  );
}

function Bar() {
  return <div ref={clearOfHelpLauncher}>Join game</div>;
}

beforeEach(() => {
  window.innerHeight = 800;
  document.documentElement.style.removeProperty(HELP_LAUNCHER_CLEARANCE_VAR);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("clearOfHelpLauncher", () => {
  it("publishes a fixed bottom bar's height above the viewport bottom while it is mounted", () => {
    // A bar whose top edge is 180px above the bottom of an 800px viewport.
    layout({ top: 620, height: 84 });
    const { unmount } = render(<Bar />);
    expect(clearance()).toBe("180px");

    unmount();
    expect(clearance()).toBe("");
  });

  it("re-measures when the window resizes", () => {
    layout({ top: 620, height: 84 });
    render(<Bar />);
    window.innerHeight = 900;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(clearance()).toBe("280px");
  });

  it("asks for no room for a bar that is not laid out (hidden)", () => {
    layout({ top: 0, height: 0 });
    render(<Bar />);
    expect(clearance()).toBe("");
  });

  it("keeps the highest of two bars, and the other's room after one goes", () => {
    layout({ top: 620, height: 84 });
    const first = render(<Bar />);
    layout({ top: 500, height: 84 });
    const second = render(<Bar />);
    expect(clearance()).toBe("300px");
    second.unmount();
    expect(clearance()).toBe("180px");
    first.unmount();
    expect(clearance()).toBe("");
  });
});

describe(".help-launcher rule", () => {
  it("sits above the bottom nav and safe area, and above any bar that asked for clearance", () => {
    const css = readFileSync("src/styles.css", "utf8").replace(/\s+/g, " ");
    expect(css).toContain(
      ".help-launcher { bottom: max( calc(5rem + env(safe-area-inset-bottom)), calc(var(--help-launcher-clearance, 0px) + 0.5rem) ); }",
    );
  });
});
