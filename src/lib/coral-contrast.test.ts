import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * P3-5: white text on the brand coral is 4.1:1, under WCAG AA's 4.5:1 (axe: color-contrast, found on
 * the unread badges). Anything with white text on coral uses `bg-coral-strong` (4.9:1, and 5.3:1 in
 * the light theme, whose coral is a light blue). This keeps plain `bg-coral` out from behind white text.
 */

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [p] : [];
  });
}

const PLAIN_CORAL = /(?<![\w:/-])bg-coral(?![\w/-])/;

describe("white text on coral (P3-5)", () => {
  it("uses bg-coral-strong, never plain bg-coral, behind text-white", () => {
    const offenders: string[] = [];
    for (const f of files("src")) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/"[^"\n]*"|`[^`]*`/g)) {
        const cls = m[0];
        if (/(?<![\w:-])text-white(?![\w/-])/.test(cls) && PLAIN_CORAL.test(cls)) {
          offenders.push(`${f}: ${cls.slice(0, 120)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("defines coral-strong in both themes and exposes it to Tailwind", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain("--color-coral-strong: var(--coral-strong);");
    expect(css.match(/--coral-strong: oklch\(/g)?.length).toBe(2);
  });
});
