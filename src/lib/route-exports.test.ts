import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * TanStack's router code-splitting moves a route's component into its own chunk only
 * when the route file exports nothing but `Route`. Any other export (a component, a
 * helper) keeps the whole route module, and everything it imports, in the entry bundle
 * that every page downloads. Put shared pieces in src/components or src/lib instead.
 * (__root is always in the entry, so its exports cost nothing extra.)
 */
describe("route files export only Route", () => {
  const dir = "src/routes";
  const files = readdirSync(dir).filter(
    (f) => /\.(tsx?|jsx?)$/.test(f) && !/\.test\./.test(f) && f !== "__root.tsx",
  );

  it("has route files to check", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no route file exports a value other than Route", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const m of src.matchAll(
        /^export\s+(?:default\s+|async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_]+)/gm,
      )) {
        if (m[1] !== "Route") offenders.push(`${f}: ${m[1]}`);
      }
      for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
        for (const name of m[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)) {
          if (!/^type\s/.test(name) && name !== "Route") offenders.push(`${f}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
