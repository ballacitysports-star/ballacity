/**
 * Keeps the floating Help button clear of bars pinned to the bottom of the screen.
 *
 * The button sits just above the bottom nav. A fixed bottom bar (the game page's join bar, a
 * trainer's Message/Book bar) sits in the same strip, so the button used to cover the bar's left
 * edge. Only non-form pages opt in: on a form, lifting the button would put it over the scrolling
 * fields, so the create/edit wizards hide it instead (launcher.ts). A bar opts in with `ref={clearOfHelpLauncher}`: while it is
 * mounted and visible, its height above the bottom of the viewport is published as the
 * `--help-launcher-clearance` CSS variable on <html>, and the `.help-launcher` rule in styles.css
 * lifts the button above it. When the bar unmounts the variable is removed and the button drops
 * back to its usual place.
 *
 * A CSS variable rather than shared React state: the bars and the button live in different parts
 * of the tree (route content and the root), and the button never needs to re-render to move.
 */

export const HELP_LAUNCHER_CLEARANCE_VAR = "--help-launcher-clearance";

/** Each mounted bar and its distance (px) from the bottom of the viewport to its top edge. */
const bars = new Map<HTMLElement, number>();

function publish() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const highest = Math.max(0, ...bars.values());
  if (highest > 0) root.style.setProperty(HELP_LAUNCHER_CLEARANCE_VAR, `${Math.ceil(highest)}px`);
  else root.style.removeProperty(HELP_LAUNCHER_CLEARANCE_VAR);
}

function measure(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  // A hidden bar (display: none, or not laid out yet) has no box and needs no room.
  const clearance = rect.height > 0 ? Math.max(0, window.innerHeight - rect.top) : 0;
  bars.set(el, clearance);
  publish();
}

/**
 * Ref callback for a fixed bottom bar: `<div ref={clearOfHelpLauncher} className="fixed …">`.
 * Stable (module-level), and uses React 19's ref cleanup to unregister the bar.
 */
export function clearOfHelpLauncher(el: HTMLElement | null): (() => void) | undefined {
  if (!el || typeof window === "undefined") return undefined;
  const update = () => measure(el);
  update();
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
  observer?.observe(el);
  window.addEventListener("resize", update);
  return () => {
    observer?.disconnect();
    window.removeEventListener("resize", update);
    bars.delete(el);
    publish();
  };
}
