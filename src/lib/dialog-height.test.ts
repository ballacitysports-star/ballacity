import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A dialog must never be taller than the screen it opens on.
 *
 * Both primitives centre their content with `top-[50%]` and
 * `translate-y-[-50%]`. With no height cap, anything taller than the viewport
 * spills off the top and the bottom at once — and Radix locks scrolling on the
 * page behind, so the part above the fold cannot be reached by any means. In
 * landscape on a phone (~375px tall) a header, a body and a row of buttons is
 * already past that.
 *
 * 25 of the app's 38 dialogs set no height of their own, so this lives on the
 * primitives rather than at the call sites. That makes it one line standing in
 * for 25 screens — easy to drop in a refactor and invisible when missing,
 * which is why it is pinned here.
 */

const PRIMITIVES = ["dialog", "alert-dialog"] as const;

function source(name: string): string {
  return readFileSync(new URL(`../components/ui/${name}.tsx`, import.meta.url), "utf8");
}

/**
 * The base class string the *Content* element passes to cn(), before the
 * caller's. Anchored on the Content element rather than the first cn() in the
 * file, which belongs to the Overlay and carries none of this.
 */
function baseClasses(name: string): string {
  const src = source(name);
  const component = name === "dialog" ? "DialogPrimitive.Content" : "AlertDialogPrimitive.Content";
  const at = src.indexOf(`<${component}`);
  expect(at, `${name}: <${component}> not found`).toBeGreaterThan(-1);
  const cnAt = src.indexOf("className={cn(", at);
  expect(cnAt, `${name}: no cn() on ${component}`).toBeGreaterThan(-1);
  const quoted = /"([^"]+)"/.exec(src.slice(cnAt));
  expect(quoted, `${name}: no base class string found`).not.toBeNull();
  return quoted![1];
}

describe("dialog primitives cap their height", () => {
  it.each(PRIMITIVES)("%s caps to the viewport", (name) => {
    // dvh, not vh: on mobile Safari vh is the *largest* viewport height, which
    // stays wrong while the URL bar is showing — the exact case this guards.
    expect(baseClasses(name)).toMatch(/max-h-\[calc\(100dvh-[^\]]+\)\]/);
  });

  it.each(PRIMITIVES)("%s makes the overflow reachable", (name) => {
    // A cap without a scroll container just clips the content instead.
    expect(baseClasses(name)).toMatch(/overflow-y-auto/);
  });

  it.each(PRIMITIVES)("%s still centres, which is what makes the cap necessary", (name) => {
    const base = baseClasses(name);
    expect(base).toContain("top-[50%]");
    expect(base).toContain("translate-y-[-50%]");
  });

  it("lets a call site override the cap, via tailwind-merge", () => {
    // Thirteen dialogs pass their own max-h-*. cn() must resolve the conflict
    // in the caller's favour, or this change would silently override them.
    const utils = readFileSync(new URL("./utils.ts", import.meta.url), "utf8");
    expect(utils).toMatch(/twMerge/);
  });
});
