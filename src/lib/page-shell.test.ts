import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pageContainerClasses, type PageWidth } from "@/lib/page-shell";

const ALL_WIDTHS: PageWidth[] = ["narrow", "prose", "content", "flush", "default", "full"];

/**
 * The shells' geometry lives in styles.css, so these assertions read it there
 * rather than trusting a copy in the test. That way a change to the CSS that
 * broke the scale would fail here.
 */
const CSS = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function shell(name: string): string {
  const match = CSS.match(new RegExp(`@utility ${name} \\{([^}]*)\\}`));
  if (!match) throw new Error(`@utility ${name} not found in styles.css`);
  return match[1]!;
}

/** The rem cap of a shell, or null when it is uncapped. */
function capRem(name: string): number | null {
  const body = shell(name);
  const max = body.match(/max-width:\s*min\(100%,\s*([\d.]+)rem\)/);
  if (max) return Number(max[1]);
  if (!/max-width:/.test(body)) return null;
  throw new Error(`${name} has a max-width that is not min(100%, …)`);
}

const SHELLS = [
  "page-shell-narrow",
  "page-shell-prose",
  "page-shell-content",
  "page-shell-feed",
  "page-shell-flush",
  "page-shell",
  "page-shell-full",
];

describe("page shell utilities", () => {
  it("defines every shell the component can render", () => {
    for (const name of SHELLS) expect(() => shell(name)).not.toThrow();
  });

  it("centres and fills the available width", () => {
    for (const name of SHELLS) {
      expect(shell(name), name).toMatch(/margin-inline:\s*auto/);
      expect(shell(name), name).toMatch(/width:\s*100%/);
    }
  });

  it("gutters content away from the screen edge", () => {
    for (const name of SHELLS) {
      // `flush` and `feed` are the deliberate exceptions: their children own
      // the padding, and a media feed runs edge to edge on a phone.
      if (name === "page-shell-flush" || name === "page-shell-feed") continue;
      expect(shell(name), name).toMatch(/padding-inline:\s*clamp\(/);
    }
  });

  it("leaves the flush shell unpadded, since its children pad themselves", () => {
    expect(shell("page-shell-flush")).not.toMatch(/padding-inline/);
  });

  it("leaves the feed shell unpadded and at the media-column width", () => {
    // 29.375rem is 470px — the highlights feed's column. Snapping it to the
    // next step up would widen every video card on the page.
    expect(shell("page-shell-feed")).not.toMatch(/padding-inline/);
    expect(capRem("page-shell-feed")).toBe(29.375);
  });

  it("still caps the flush shell, so it cannot run the full width of a monitor", () => {
    expect(capRem("page-shell-flush")).toBe(capRem("page-shell-content"));
  });

  it("caps width with min(100%, …) so a shell can never exceed the viewport", () => {
    // This is what makes the containers incapable of causing horizontal
    // overflow on a narrow screen, whatever cap they carry.
    for (const name of SHELLS) {
      expect(() => capRem(name), name).not.toThrow();
    }
  });

  it("orders the tiers narrow < prose < content < default", () => {
    const narrow = capRem("page-shell-narrow")!;
    const prose = capRem("page-shell-prose")!;
    const content = capRem("page-shell-content")!;
    const wide = capRem("page-shell")!;
    expect(narrow).toBeLessThan(prose);
    expect(prose).toBeLessThan(content);
    expect(content).toBeLessThan(wide);
  });

  it("keeps prose at a readable measure", () => {
    // Wider than about 45rem and a line of body text runs past the point
    // where the eye reliably finds the next one.
    expect(capRem("page-shell-prose")!).toBeLessThanOrEqual(45);
  });

  it("leaves the full shell uncapped", () => {
    expect(capRem("page-shell-full")).toBeNull();
  });

  it("keeps page-shell at the width it already had, so existing pages are unchanged", () => {
    // Four route files used page-shell before the other tiers existed; this
    // pins its geometry so adopting the scale cannot silently resize them.
    expect(capRem("page-shell")).toBe(72);
  });

  it("grows gutters with the viewport but never to zero", () => {
    const clamp = shell("page-shell").match(/padding-inline:\s*clamp\(([^)]*)\)/)![1]!;
    const [min, , max] = clamp.split(",").map((s) => s.trim());
    expect(Number(min!.replace("rem", ""))).toBeGreaterThan(0);
    expect(Number(max!.replace("rem", ""))).toBeGreaterThan(Number(min!.replace("rem", "")));
  });
});

describe("pageContainerClasses", () => {
  it("maps each width to its shell utility", () => {
    expect(pageContainerClasses("narrow")).toContain("page-shell-narrow");
    expect(pageContainerClasses("prose")).toContain("page-shell-prose");
    expect(pageContainerClasses("flush")).toContain("page-shell-flush");
    expect(pageContainerClasses("content")).toContain("page-shell-content");
    expect(pageContainerClasses("full")).toContain("page-shell-full");
  });

  it("maps default to the original page-shell", () => {
    expect(pageContainerClasses("default").split(" ")).toContain("page-shell");
  });

  it("defaults to the content tier, which most pages want", () => {
    expect(pageContainerClasses()).toBe(pageContainerClasses("content"));
  });

  it("appends caller classes last so they can override", () => {
    expect(pageContainerClasses("content", "pb-24")).toContain("pb-24");
  });

  it("never emits two shell utilities at once", () => {
    for (const width of ALL_WIDTHS) {
      const shells = pageContainerClasses(width)
        .split(" ")
        .filter((c) => c.startsWith("page-shell"));
      expect(shells, width).toHaveLength(1);
    }
  });
});

/**
 * iOS Safari zooms the page when a focused input's text is under 16px, and
 * never zooms back. Around 150 controls across the app set text-sm or text-xs
 * themselves, so without this rule tapping almost any field — signing up,
 * hosting a game, paying — shifts the whole layout under the user.
 *
 * It is one CSS rule standing in for ~150 call sites, which makes it easy to
 * delete by accident and hard to notice missing, so it is pinned here.
 */
describe("form controls do not trigger iOS zoom", () => {
  const rule = CSS.match(/@media \(max-width: 767px\) \{([\s\S]*?)\n\}/);

  it("raises small controls to 16px below the md breakpoint", () => {
    expect(rule, "the mobile form-control rule is missing from styles.css").not.toBeNull();
    expect(rule![1]).toMatch(/font-size:\s*1rem/);
  });

  it("covers every control type at both small sizes", () => {
    for (const el of ["input", "textarea", "select"]) {
      for (const size of ["text-xs", "text-sm"]) {
        expect(rule![1], `${el}.${size}`).toContain(`${el}.${size}`);
      }
    }
  });

  it("stays scoped to the small sizes so larger controls keep their size", () => {
    // The org wizards use text-xl and text-2xl inputs deliberately; a blanket
    // `input { font-size: 1rem }` would shrink them.
    expect(rule![1]).not.toMatch(/(?:^|,)\s*(?:input|textarea|select)\s*\{/);
    expect(rule![1]).not.toMatch(/text-(?:base|lg|xl)/);
  });
});

/**
 * `min-h-screen` is `100vh`, and on mobile browsers `vh` is the *largest*
 * viewport height — the one you get with the URL bar hidden. A page sized that
 * way is taller than the space actually visible while the bar is showing, so
 * its bottom sits under the browser chrome and the page gains a scroll it
 * should not have. `dvh` tracks the viewport as the bar shows and hides.
 *
 * The app was split: 39 places used min-h-dvh and 10 still used min-h-screen,
 * including the auth screen, settings, and the root error boundary.
 */
describe("full-height pages use the dynamic viewport", () => {
  const ROOT = new URL("../", import.meta.url);

  function sourcesUsing(pattern: RegExp): string[] {
    const hits: string[] = [];
    const walk = (dir: URL) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
        if (entry.isDirectory()) walk(child);
        else if (entry.name.endsWith(".tsx") && pattern.test(readFileSync(child, "utf8"))) {
          hits.push(entry.name);
        }
      }
    };
    walk(ROOT);
    return hits.sort();
  }

  it("uses no min-h-screen anywhere", () => {
    expect(sourcesUsing(/\bmin-h-screen\b/)).toEqual([]);
  });

  it("still has full-height pages, so the check above is not vacuous", () => {
    expect(sourcesUsing(/\bmin-h-dvh\b/).length).toBeGreaterThan(20);
  });
});

/**
 * One page title, and shared button behaviour.
 *
 * 51 routes render an <h1>, between them using more than a dozen class
 * combinations for what is the same thing. `page-title` is the single
 * definition, and PageHeader renders it too so the component and a plain <h1>
 * cannot drift.
 *
 * The button rules are deliberately behavioural rather than visual: 624 of the
 * app's buttons are raw <button>, 348 of them pill-shaped and 536 sized by
 * padding rather than a height. That is the product's identity, so it is left
 * alone and only the things every button should agree on are set globally.
 */
describe("shared title and button rules", () => {
  it("defines one responsive page title", () => {
    const body = CSS.match(/@utility page-title \{([\s\S]*?)\n\}/)?.[1];
    expect(body, "page-title utility missing from styles.css").toBeTruthy();
    // 2xl on a phone, 3xl from sm up — the dominant size, made responsive.
    expect(body!).toMatch(/--text-2xl/);
    expect(body!).toMatch(/@variant sm/);
    expect(body!).toMatch(/--text-3xl/);
    // A long team or player name must not overflow, nor ladder one word a line.
    expect(body!).toMatch(/text-wrap:\s*balance/);
    expect(body!).toMatch(/overflow-wrap:\s*break-word/);
  });

  it("has PageHeader render that same utility rather than its own copy", () => {
    const src = readFileSync(
      new URL("../components/layout/PageHeader.tsx", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(/className="page-title"/);
    expect(src, "PageHeader should not restate the type scale").not.toMatch(
      /text-2xl[^"]*sm:text-3xl/,
    );
  });

  it("stops any button overflowing its container", () => {
    expect(CSS).toMatch(/max-width:\s*100%/);
    expect(CSS).toMatch(/\[role="button"\]/);
  });

  it("removes the iOS double-tap zoom and tap delay on buttons", () => {
    // touch-action: manipulation is the Safari-specific half of this.
    expect(CSS).toMatch(/touch-action:\s*manipulation/);
  });
});

/**
 * Keyboard focus has to be visible.
 *
 * The app shipped with no focus indicator of its own: no :focus-visible rule
 * in styles.css, 14 of 230 components setting a focus style, and all 625 raw
 * <button> elements relying on the browser default — which the `outline-none`
 * utility, used 181 times, removes. Several of those places set no replacement
 * ring, so a keyboard user had nothing showing where they were.
 */
describe("keyboard focus is visible", () => {
  const rule = CSS.match(/\n:focus-visible \{([\s\S]*?)\n\}/)?.[1];

  it("defines a global focus indicator", () => {
    expect(rule, ":focus-visible rule missing from styles.css").toBeTruthy();
    expect(rule!).toMatch(/outline:[^;]*solid/);
  });

  it("uses :focus-visible so a mouse click does not draw a ring", () => {
    // :focus would fire on pointer clicks too, which is why designs strip it.
    expect(CSS).toMatch(/\n:focus-visible \{/);
    expect(CSS, "a bare :focus rule would bring back the problem").not.toMatch(
      /\n:focus \{[^}]*outline:/,
    );
  });

  it("takes its colour from the theme rather than hardcoding one", () => {
    // --ring is defined for both light and dark, so the indicator follows.
    expect(rule!).toMatch(/var\(--ring\)/);
    expect(CSS).toMatch(/--ring:/);
  });

  it("sits outside @layer so it outranks the outline-none utilities", () => {
    // Tailwind puts utilities in @layer utilities; unlayered rules win.
    const at = CSS.indexOf("\n:focus-visible {");
    const layerBefore = CSS.lastIndexOf("@layer", at);
    if (layerBefore !== -1) {
      // If a @layer block opened before it, that block must have closed first.
      const between = CSS.slice(layerBefore, at);
      expect(between.split("{").length - 1).toBeLessThanOrEqual(between.split("}").length - 1);
    }
  });
});
