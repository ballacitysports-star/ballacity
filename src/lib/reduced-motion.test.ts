import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * P3-5: every animate-* class follows the system "reduce motion" setting.
 *
 * An animate-* class in src passes when it is
 *   - motion-safe: (it only runs when the viewer has not asked for less motion),
 *   - switched off by the reduced-motion block in styles.css, or
 *   - allowlisted below, with its reason.
 * Anything else keeps moving for someone who asked it not to, and fails here.
 *
 * Tailwind scans src, this file included, for class names, so the fixtures
 * below use classes the app already has, names Tailwind cannot build
 * (animate-wobble), or are split in two; anything else would add a real rule
 * to the app's CSS.
 */

/** animate-* utilities, by the name after `animate-`, that keep running under reduced motion. */
const ALLOWED = new Map([
  ["spin", "an activity indicator: a spinner that stops reads as a hung page"],
  ["none", "not an animation: it removes one"],
]);

const REDUCED_MOTION = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g;
const RULE = /([^{}]+)\{([^{}]*)\}/g;
const ANIMATION_NONE = /(?:^|;)\s*animation(?:-name)?\s*:\s*none\s*(?:!important\s*)?(?:;|$)/;

/**
 * Selectors that top-level `@media (prefers-reduced-motion: reduce)` blocks set
 * `animation: none` on. Only top-level blocks count: inside @layer utilities,
 * Tailwind's state variants (`data-[state=open]:animate-in`) out-rank an
 * attribute selector, so a block there would not switch them off.
 */
function switchedOffSelectors(css: string): string[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors: string[] = [];
  for (const m of src.matchAll(REDUCED_MOTION)) {
    const before = src.slice(0, m.index);
    if (before.split("{").length !== before.split("}").length) continue; // nested
    const start = m.index + m[0].length;
    let end = start;
    for (let depth = 1; depth > 0 && end < src.length; end++) {
      if (src[end] === "{") depth++;
      else if (src[end] === "}") depth--;
    }
    for (const [, list, declarations] of src.slice(start, end - 1).matchAll(RULE)) {
      if (ANIMATION_NONE.test(declarations)) {
        selectors.push(...list.split(",").map((s) => s.trim()));
      }
    }
  }
  return selectors;
}

/**
 * Whether an element whose class attribute is `classes` matches one of the
 * selectors. Only the two forms the block uses are understood, `.name` and
 * `[class*="text"]`; any other throws, so a new kind of selector there means
 * teaching this test first. (No DOM: the gstack pregate runs this file under
 * `bun test`, which has none.)
 */
function switchedOff(classes: string, selectors: string[]): boolean {
  return selectors.some((selector) => {
    const contains = /^\[class\*=(["'])(.+)\1\]$/.exec(selector);
    if (contains) return classes.includes(contains[2]);
    const name = /^\.([\w-]+)$/.exec(selector);
    if (name) return classes.split(/\s+/).includes(name[1]);
    throw new Error(`reduced-motion.test.ts cannot match the selector ${selector}`);
  });
}

/**
 * animate-* classes with their variants, such as `data-[state=open]:animate-in`.
 * A class starts after whitespace or a quote, so `tw-animate-css` and an
 * arbitrary animation-delay property are not one.
 */
const ANIMATE_CLASS = /(?<![^\s"'`])((?:[^\s"'`]*:)?)(animate-(?:\[[^\]\s]*\]|[\w-]*\w))/g;

type AnimateClass = { token: string; variants: string[]; utility: string; line: number };

function animateClasses(source: string): AnimateClass[] {
  return [...source.matchAll(ANIMATE_CLASS)].map((m) => ({
    token: m[1] + m[2],
    variants: m[1].split(":").slice(0, -1),
    utility: m[2],
    line: source.slice(0, m.index).split("\n").length,
  }));
}

function passes(c: AnimateClass, selectors: string[]): boolean {
  return (
    c.variants.includes("motion-safe") ||
    ALLOWED.has(c.utility.slice("animate-".length)) ||
    switchedOff(c.token, selectors)
  );
}

/** App source files under `dir`; tests are left out, they render nothing. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.[cm]?[jt]sx?$/.test(name) && !/\.(test|spec)\./.test(name) ? [p] : [];
  });
}

describe("reduced motion (P3-5)", () => {
  const off = switchedOffSelectors(readFileSync("src/styles.css", "utf8"));

  it("switches animations off in a top-level block of styles.css, outside @layer", () => {
    expect(off.length, "No top-level reduced-motion block sets `animation: none`.").toBeGreaterThan(
      0,
    );
  });

  it("switches off the shared components' animations in every state they use", () => {
    const shared = [
      "data-[state=open]:animate-in", // dialogs, sheets, popovers, menus, selects
      "data-[state=closed]:animate-out",
      "animate-in", // tooltip
      "data-[motion^=from-]:animate-in", // navigation menu
      "data-[state=open]:animate-accordion-down",
      "data-[state=closed]:animate-accordion-up",
      "animate-pulse", // skeletons, live dots
      "animate-caret-blink", // one-time-code caret
    ];
    expect(shared.filter((c) => !switchedOff(c, off))).toEqual([]);
  });

  it("keeps the spinner turning", () => {
    expect(switchedOff("h-4 w-4 animate-spin", off)).toBe(false);
  });

  it("leaves no animate-* class in src that ignores the setting", () => {
    const offenders = sourceFiles("src").flatMap((file) =>
      animateClasses(readFileSync(file, "utf8"))
        .filter((c) => !passes(c, off))
        .map((c) => `${file}:${c.line} ${c.token}`),
    );
    expect(
      offenders,
      "These keep animating under reduced motion. Prefix them with motion-safe:, " +
        "switch the utility off in the reduced-motion block in styles.css, or " +
        "allowlist it in this test with the reason it must keep moving.",
    ).toEqual([]);
  });
});

describe("the animate-* scan", () => {
  it("reads classes with their variants and skips look-alikes", () => {
    const source = [
      '@import "tw-animate-css";',
      '<span className="h-2 animate-pulse motion-safe:[animation-delay:-0.3s]" />',
      "<div className={`x ${open ? 'data-[state=open]:animate-in' : \"\"}`} />",
      '<i className="md:motion-safe:animate-' + '[wobble_1s_infinite]" />',
    ].join("\n");
    expect(animateClasses(source).map(({ token, line }) => [token, line])).toEqual([
      ["animate-pulse", 2],
      ["data-[state=open]:animate-in", 3],
      ["md:motion-safe:animate-" + "[wobble_1s_infinite]", 4],
    ]);
  });

  it("passes motion-safe:, switched-off and allowlisted classes, and nothing else", () => {
    const selectors = ['[class*="animate-wobble"]'];
    const verdict = (source: string) => passes(animateClasses(source)[0]!, selectors);
    expect(verdict('"motion-safe:animate-jiggle"')).toBe(true);
    expect(verdict('"data-[state=closed]:animate-wobble"')).toBe(true);
    expect(verdict('"animate-spin"')).toBe(true);
    expect(verdict('"animate-jiggle"')).toBe(false);
    expect(verdict('"motion-reduce:animate-jiggle"')).toBe(false);
    expect(verdict('"animate-' + '[jiggle_1s_infinite]"')).toBe(false);
    expect(() => switchedOff("animate-jiggle", [":is(.x)"])).toThrow(/cannot match/);
  });

  it("only counts a block outside @layer", () => {
    const rule =
      "@media (prefers-reduced-motion: reduce) { .a, [class*='animate-x'] { animation: none; } }";
    expect(switchedOffSelectors(rule)).toEqual([".a", "[class*='animate-x']"]);
    expect(switchedOffSelectors(`@layer utilities { ${rule} }`)).toEqual([]);
    expect(
      switchedOffSelectors("@media (prefers-reduced-motion: reduce) { .a { opacity: 1; } }"),
    ).toEqual([]);
  });
});
