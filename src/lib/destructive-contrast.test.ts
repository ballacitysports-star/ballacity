import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * P3-5: white text on --destructive is 4.0:1, under WCAG AA's 4.5:1 (axe: color-contrast, found on
 * the Parent Center's "Delete …'s profile" button). Solid red behind white or destructive-foreground
 * text uses `bg-destructive-strong` (4.8:1). Red text keeps --destructive, which reads 5.1:1 on black.
 * Same pattern as coral-strong (coral-contrast.test.ts).
 */

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [p] : [];
  });
}

const SOLID_DESTRUCTIVE = /(?<![\w:/-])bg-destructive(?![\w/-])/;
const LIGHT_TEXT = /(?<![\w:-])text-(white|destructive-foreground)(?![\w/-])/;

describe("white text on destructive red (P3-5)", () => {
  it("uses bg-destructive-strong, never plain bg-destructive, behind light text", () => {
    const offenders: string[] = [];
    for (const f of files("src")) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/"[^"\n]*"|`[^`]*`/g)) {
        const cls = m[0];
        if (LIGHT_TEXT.test(cls) && SOLID_DESTRUCTIVE.test(cls)) {
          offenders.push(`${f}: ${cls.slice(0, 120)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("defines destructive-strong and exposes it to Tailwind", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain("--color-destructive-strong: var(--destructive-strong);");
    expect(css).toMatch(/--destructive-strong: oklch\(0\.57 0\.24 25\);/);
  });
});
