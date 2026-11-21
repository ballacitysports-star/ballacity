import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * P3-5: the app's CSS animations follow the system "reduce motion" setting.
 *
 * An animate-* class in src passes when it is
 *   - motion-safe: (it only runs when the viewer has not asked for less motion),
 *   - switched off by the reduced-motion block in styles.css, or
 *   - allowlisted below, with its reason.
 * Two kinds pass only some of those ways. An important class (Tailwind's `!`
 * modifier, before the utility or at its end) is a layered !important
 * animation, which beats the block's `animation: none`, so it has to be
 * motion-safe:. A form the block is not written for, anything but a theme name
 * or an [arbitrary value] (a custom property in parentheses, say), has to be
 * motion-safe: or allowlisted.
 *
 * A rule in styles.css itself that starts an animation passes when the block
 * lists its selector (and the rule is neither !important nor an unlayered rule
 * below the block, either of which still wins), when it sits under
 * `prefers-reduced-motion: no-preference`, or when it is allowlisted below,
 * with its reason.
 *
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

/** Rules in styles.css, by selector, whose animation keeps running under reduced motion. None yet. */
const ALLOWED_RULES = new Map<string, string>();

const REDUCED_MOTION = /^@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)$/;
const MOTION_SAFE =
  /^@(?:media\s*\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)|variant\s+motion-safe)$/;
const ANIMATION_NONE = /(?:^|;)\s*animation(?:-name)?\s*:\s*none\s*(?:!important\s*)?(?:;|$)/;

type CssBlock = {
  /** The text before its `{`: a selector list or an at-rule. */
  prelude: string;
  /** Its own declarations, not those of the blocks nested in it. */
  declarations: string;
  /** The preludes of the blocks around it, outermost first. */
  parents: string[];
  /** Where its `{` is, to tell which of two blocks comes later. */
  offset: number;
};

/**
 * Every block in `css`, nested ones included, in source order. Just enough CSS
 * for styles.css: comments are dropped, and a brace inside a string would
 * mislead it, so unbalanced braces throw rather than read on.
 */
function cssBlocks(css: string): CssBlock[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks: CssBlock[] = [];
  const open: CssBlock[] = [];
  let from = 0;
  for (const m of src.matchAll(/[{};]/g)) {
    const text = src.slice(from, m.index).trim();
    from = m.index + 1;
    if (m[0] === "{") {
      const parents = open.map((b) => b.prelude);
      const block = { prelude: text, declarations: "", parents, offset: m.index };
      blocks.push(block);
      open.push(block);
      continue;
    }
    const current = open.at(-1); // none for a top-level statement such as @import
    if (current && text) current.declarations += `${text};`;
    if (m[0] === "}" && !open.pop()) throw new Error("reduced-motion.test.ts: a } closes no block");
  }
  if (open.length > 0) throw new Error("reduced-motion.test.ts: a { is never closed");
  return blocks;
}

/** The selectors in a selector list, with their whitespace evened out. */
function selectorsOf(prelude: string): string[] {
  return prelude.split(",").map((s) => s.replace(/\s+/g, " ").trim());
}

/**
 * Rules that sit directly in a top-level `@media (prefers-reduced-motion:
 * reduce)` block and set `animation: none`. Only top-level blocks count: inside
 * @layer utilities, Tailwind's state variants (`data-[state=open]:animate-in`)
 * out-rank an attribute selector, so a block there would not switch them off.
 */
function switchOffRules(blocks: CssBlock[]): CssBlock[] {
  return blocks.filter(
    (b) =>
      b.parents.length === 1 &&
      REDUCED_MOTION.test(b.parents[0]) &&
      ANIMATION_NONE.test(b.declarations),
  );
}

/** Selectors that the top-level reduced-motion blocks of `css` set `animation: none` on. */
function switchedOffSelectors(css: string): string[] {
  return switchOffRules(cssBlocks(css)).flatMap((b) => selectorsOf(b.prelude));
}

/** What `declarations` sets `animation` and `animation-name` to. */
function animationValues(declarations: string): string[] {
  return declarations.split(";").flatMap((d) => {
    const m = /^\s*animation(?:-name)?\s*:([\s\S]*)$/i.exec(d);
    return m ? [m[1].trim()] : [];
  });
}

type AnimationRule = { selector: string; stopped: boolean };

/**
 * Each selector of a rule in `css` that starts an animation, outside its
 * top-level reduced-motion blocks, and whether those blocks stop it. They stop
 * it when they list the same selector, unless the rule is !important (that
 * beats `animation: none`) or is unlayered and comes after them (that wins on
 * order). A rule under `prefers-reduced-motion: no-preference` is left out: it
 * never runs with reduced motion.
 */
function animationRules(css: string): AnimationRule[] {
  const blocks = cssBlocks(css);
  const off = switchOffRules(blocks);
  return blocks.flatMap((b) => {
    const around = [...b.parents, b.prelude];
    if (REDUCED_MOTION.test(b.parents[0] ?? "") || around.some((p) => MOTION_SAFE.test(p))) {
      return [];
    }
    const values = animationValues(b.declarations).filter(
      (v) => !/^none(?:\s*!\s*important)?$/i.test(v),
    );
    if (values.length === 0) return [];
    const important = values.some((v) => /!\s*important$/i.test(v));
    const layered = around.some((p) => /^@(?:layer|utility)\b/.test(p));
    return selectorsOf(b.prelude).map((selector) => ({
      selector,
      stopped:
        !important &&
        off.some(
          (o) => selectorsOf(o.prelude).includes(selector) && (layered || o.offset > b.offset),
        ),
    }));
  });
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
 * arbitrary animation-delay property are not one. It runs to the next
 * whitespace or quote, so every form is read, the important ones and the ones
 * the block is not written for included (see the scan's tests below).
 */
const ANIMATE_CLASS = /(?<![^\s"'`])((?:[^\s"'`]*:)?)(!?)(animate-[^\s"'`]*)/g;

/** A theme name (`pulse`, `accordion-down`) or an arbitrary value (`[wobble_1s]`). */
const READABLE = /^(?:[\w-]*\w|\[[^\]]*\])$/;

type AnimateClass = {
  token: string;
  variants: string[];
  /** Tailwind's important modifier: `!` before the utility, or at the end. */
  important: boolean;
  /** The utility without the modifier, such as `animate-pulse`. */
  utility: string;
  line: number;
};

function animateClasses(source: string): AnimateClass[] {
  return [...source.matchAll(ANIMATE_CLASS)].map((m) => {
    const [, prefix, bang, rest] = m;
    const trailing = rest.endsWith("!");
    return {
      token: prefix + bang + rest,
      variants: prefix.split(":").slice(0, -1),
      important: bang === "!" || trailing,
      utility: trailing ? rest.slice(0, -1) : rest,
      line: source.slice(0, m.index).split("\n").length,
    };
  });
}

function passes(c: AnimateClass, selectors: string[], allowed = ALLOWED): boolean {
  if (c.variants.includes("motion-safe")) return true;
  if (c.important) return false; // a layered !important animation beats the block
  const name = c.utility.slice("animate-".length);
  if (allowed.has(name)) return true;
  return READABLE.test(name) && switchedOff(c.token, selectors);
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
  const css = readFileSync("src/styles.css", "utf8");
  const off = switchedOffSelectors(css);

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
        "allowlist it in this test with the reason it must keep moving. An important " +
        "class (a ! before the utility or at its end) beats the block, so only " +
        "motion-safe: fixes it; a form other than a theme name or an [arbitrary value] " +
        "needs motion-safe: or the allowlist.",
    ).toEqual([]);
  });

  it("switches off every animation that styles.css itself starts, or allowlists it", () => {
    const rules = animationRules(css);
    expect(
      rules.length,
      "The scan found no animation in styles.css. If they moved to another file, scan that one too.",
    ).toBeGreaterThan(0);
    expect(
      rules.filter((r) => !r.stopped && !ALLOWED_RULES.has(r.selector)).map((r) => r.selector),
      "These rules in styles.css keep animating under reduced motion. List the selector in " +
        "the reduced-motion block (an !important rule, or an unlayered one below the block, " +
        "still wins there), put the rule under @media (prefers-reduced-motion: no-preference), " +
        "or allowlist it in this test with the reason it must keep moving.",
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
      '<b className="md:!animate-wobble animate-wobble! animate-' + '(--wiggle)" />',
    ].join("\n");
    expect(animateClasses(source).map(({ token, line }) => [token, line])).toEqual([
      ["animate-pulse", 2],
      ["data-[state=open]:animate-in", 3],
      ["md:motion-safe:animate-" + "[wobble_1s_infinite]", 4],
      ["md:!animate-wobble", 5],
      ["animate-wobble!", 5],
      ["animate-" + "(--wiggle)", 5],
    ]);
  });

  it("passes motion-safe:, switched-off and allowlisted classes, and nothing else", () => {
    const selectors = ['[class*="animate-wobble"]'];
    const verdict = (source: string, allowed = ALLOWED) =>
      passes(animateClasses(source)[0]!, selectors, allowed);
    expect(verdict('"motion-safe:animate-jiggle"')).toBe(true);
    expect(verdict('"data-[state=closed]:animate-wobble"')).toBe(true);
    expect(verdict('"animate-spin"')).toBe(true);
    expect(verdict('"animate-jiggle"')).toBe(false);
    expect(verdict('"motion-reduce:animate-jiggle"')).toBe(false);
    expect(verdict('"animate-' + '[jiggle_1s_infinite]"')).toBe(false);
    // Important beats the block, and the allowlist: only motion-safe: passes it.
    expect(verdict('"animate-wobble!"')).toBe(false);
    expect(verdict('"md:!animate-wobble"')).toBe(false);
    expect(verdict('"animate-spin' + '!"')).toBe(false);
    expect(verdict('"motion-safe:animate-wobble!"')).toBe(true);
    // A form the block is not written for fails, even where a selector matches it.
    expect(verdict('"animate-' + '(--wiggle)"')).toBe(false);
    expect(verdict('"animate-' + '(--animate-wobble)"')).toBe(false);
    expect(verdict('"motion-safe:animate-' + '(--wiggle)"')).toBe(true);
    expect(verdict('"animate-' + '(--wiggle)"', new Map([["(--wiggle)", "a fixture"]]))).toBe(true);
    expect(() => switchedOff("animate-jiggle", [":is(.x)"])).toThrow(/cannot match/);
  });
});

describe("the styles.css scan", () => {
  it("only counts a block outside @layer", () => {
    const rule =
      "@media (prefers-reduced-motion: reduce) { .a, [class*='animate-x'] { animation: none; } }";
    expect(switchedOffSelectors(rule)).toEqual([".a", "[class*='animate-x']"]);
    expect(switchedOffSelectors(`@layer utilities { ${rule} }`)).toEqual([]);
    expect(
      switchedOffSelectors("@media (prefers-reduced-motion: reduce) { .a { opacity: 1; } }"),
    ).toEqual([]);
  });

  it("finds each rule that starts an animation, and whether the block stops it", () => {
    const css = `
      @import "x.css";
      @layer utilities {
        .a { animation: a 1s; }
        .b { animation-name: b !important; }
        .c,
        .d { animation: c 1s; }
        .e { animation: none; animation-delay: 1s; }
        .l  >  .m { animation: l 1s; }
        @media (prefers-reduced-motion: no-preference) { .f { animation: f 1s; } }
      }
      @utility g { @variant motion-safe { animation: g 1s; } }
      .h { animation: h 1s; }
      @media (prefers-reduced-motion: reduce) {
        .a, .b, .c, .h, .i, .k, .l > .m { animation: none; }
        .j { animation: j 2s; }
      }
      .i { animation: i 1s; }
      @layer utilities { .k { animation: k 1s; } }
    `;
    expect(animationRules(css)).toEqual([
      { selector: ".a", stopped: true }, // the block is unlayered: it beats any layer
      { selector: ".b", stopped: false }, // !important beats animation: none
      { selector: ".c", stopped: true },
      { selector: ".d", stopped: false }, // not listed
      { selector: ".l > .m", stopped: true },
      { selector: ".h", stopped: true }, // unlayered, but before the block
      { selector: ".i", stopped: false }, // unlayered and after the block: it wins
      { selector: ".k", stopped: true }, // after the block, but in a layer
    ]);
    expect(() => animationRules(".a { animation: a 1s; } }")).toThrow(/closes no block/);
    expect(() => animationRules(".a { animation: a 1s;")).toThrow(/never closed/);
  });
});
