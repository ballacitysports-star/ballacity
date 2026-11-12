import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every switch in the Parent Center says what it turns on (axe: button-name). The visible label sits
 * beside a switch, not in a <label> tied to it, so each switch carries an aria-label or
 * aria-labelledby.
 */

function switchTags(src: string): { line: number; tag: string }[] {
  const out: { line: number; tag: string }[] = [];
  for (const m of src.matchAll(/<Switch\b/g)) {
    let depth = 0;
    let i = m.index!;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (depth === 0 && src.startsWith("/>", i)) break;
    }
    out.push({ line: src.slice(0, m.index).split("\n").length, tag: src.slice(m.index, i + 2) });
  }
  return out;
}

const FILES = [
  "src/routes/parent.index.tsx",
  ...readdirSync("src/components/child")
    .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
    .map((f) => `src/components/child/${f}`),
];

describe("Parent Center switches", () => {
  it("each has an accessible name", () => {
    const unnamed: string[] = [];
    let seen = 0;
    for (const file of FILES) {
      for (const { line, tag } of switchTags(readFileSync(file, "utf8"))) {
        seen++;
        if (!/aria-label(ledby)?=/.test(tag)) unnamed.push(`${file}:${line}`);
      }
    }
    expect(seen).toBeGreaterThan(4);
    expect(unnamed).toEqual([]);
  });
});
