import { readFileSync } from "node:fs";
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
      // `flush` is the deliberate exception: its children own the padding.
      if (name === "page-shell-flush") continue;
      expect(shell(name), name).toMatch(/padding-inline:\s*clamp\(/);
    }
  });

  it("leaves the flush shell unpadded, since its children pad themselves", () => {
    expect(shell("page-shell-flush")).not.toMatch(/padding-inline/);
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
