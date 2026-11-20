import { act } from "@testing-library/react";
import { vi } from "vitest";

/**
 * jsdom has no CSS animations, so Radix Presence unmounts a closing dialog at
 * once. In the browser the content stays mounted for its 200ms exit animation
 * (the closed-state animation classes in ui/dialog.tsx). This stub gives every
 * element with a `data-state` an animation name that follows that state, so a
 * closing dialog stays on screen until `endDialogExit()` fires `animationend`,
 * and a test can check what is shown during the fade.
 *
 * Call it before rendering; undo it with `vi.restoreAllMocks()` and `vi.unstubAllGlobals()`.
 */
export function holdDialogExitAnimation() {
  // Radix matches the animationend event with CSS.escape, which jsdom lacks.
  if (typeof globalThis.CSS?.escape !== "function") {
    vi.stubGlobal("CSS", { ...globalThis.CSS, escape: (s: string) => s });
  }
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
    const styles = real(el, pseudo);
    if (!(el instanceof Element) || !el.hasAttribute("data-state")) return styles;
    return new Proxy(styles, {
      get(target, prop) {
        if (prop === "animationName") {
          return el.getAttribute("data-state") === "closed" ? "exit" : "enter";
        }
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  });
}

/** Ends the exit animation of every closing element, so Radix unmounts it. */
export function endDialogExit() {
  act(() => {
    for (const el of Array.from(document.querySelectorAll('[data-state="closed"]'))) {
      const ev = new Event("animationend", { bubbles: false });
      Object.defineProperty(ev, "animationName", { value: "exit" });
      el.dispatchEvent(ev);
    }
  });
}
