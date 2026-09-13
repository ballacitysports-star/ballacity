import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The heading scale lives in styles.css so a hand-written <h1> and <PageHeader>
 * cannot drift. These tests read the CSS rather than trusting a copy here, and
 * assert the routes keep using the scale instead of re-inventing sizes.
 */
const CSS = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function utility(name: string): string {
  const match = CSS.match(new RegExp(`@utility ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`@utility ${name} not found in styles.css`);
  return match[1]!;
}

const ROUTES = readdirSync(new URL("../routes", import.meta.url), { recursive: true })
  .filter((f): f is string => typeof f === "string" && f.endsWith(".tsx"))
  .map((f) => ({
    name: f,
    src: readFileSync(new URL(`../routes/${f}`, import.meta.url), "utf8"),
  }));

describe("page heading scale", () => {
  it("defines every step of the scale", () => {
    for (const name of ["page-eyebrow", "page-title", "page-subtitle", "section-title", "bar-title"])
      expect(() => utility(name), name).not.toThrow();
  });

  it("keeps the title the largest step, and the bar title smaller than it", () => {
    expect(utility("page-title")).toMatch(/font-size:\s*var\(--text-2xl\)/);
    expect(utility("bar-title")).toMatch(/font-size:\s*var\(--text-base\)/);
    expect(utility("section-title")).toMatch(/font-size:\s*var\(--text-base\)/);
  });

  it("caps the subtitle measure so it never reads as body copy", () => {
    expect(utility("page-subtitle")).toMatch(/max-width:\s*60ch/);
  });

  it("gives every focusable element a visible keyboard focus ring", () => {
    expect(CSS).toMatch(/:focus-visible\s*\{[\s\S]*outline:/);
  });

  it("has no route left rendering the old per-page bar title sizes", () => {
    const offenders = ROUTES.filter(({ src }) =>
      /<h1[^>]*className="[^"]*(font-display text-lg font-bold|text-xl font-black)/.test(src),
    ).map(({ name }) => name);
    expect(offenders, "These headings should use `bar-title` or `page-title`.").toEqual([]);
  });
});
