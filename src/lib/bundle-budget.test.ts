import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM without types
import * as budget from "../../scripts/bundle-budget.mjs";

const { judge, measure, staticClosure, LIMITS } = budget;
const chunk = (source: string, kb: number) => ({ source, gzipBytes: kb * 1024 });

describe("bundle budget (P3-4)", () => {
  const chunks = {
    "index-abc.js": chunk("export const react = 1;", 280),
    "route-a.js": chunk('import{a}from"./index-abc.js";import"./vendor-x.js";', 40),
    "route-b.js": chunk('import{b}from"./index-abc.js";', 20),
    "vendor-x.js": chunk('import{c}from"./index-abc.js";', 100),
    "lazy.js": chunk('const m=()=>import("./route-b.js");import{d}from"./index-abc.js";', 5),
  };

  it("finds the entry as the chunk every other chunk imports", () => {
    const m = measure(chunks);
    expect(m.entry).toEqual({ file: "index-abc.js", kb: 280 });
    expect(m.largest).toEqual({ file: "vendor-x.js", kb: 100 });
    expect(m.totalKb).toBe(445);
    expect(m.files).toBe(5);
  });

  it("measures first paint as the entry plus what it imports statically, not lazily", () => {
    const shell = {
      "index-abc.js": chunk('import{a}from"./vendor-ui.js";import"./vendor-zod.js";', 280),
      "vendor-ui.js": chunk('import"./vendor-shared.js";', 50),
      "vendor-zod.js": chunk("export const z = 1;", 25),
      "vendor-shared.js": chunk("export const s = 1;", 1),
      "route.js": chunk('import{a}from"./index-abc.js";const m=()=>import("./lazy.js");', 30),
      "lazy.js": chunk('import{a}from"./index-abc.js";', 40),
    };
    const sources = Object.fromEntries(Object.entries(shell).map(([k, v]) => [k, v.source]));
    expect(staticClosure("index-abc.js", sources).sort()).toEqual([
      "index-abc.js",
      "vendor-shared.js",
      "vendor-ui.js",
      "vendor-zod.js",
    ]);
    // A dynamic import from the entry does not count either.
    const lazyEntry = { ...sources, "index-abc.js": 'const r=()=>import("./route.js");' };
    expect(staticClosure("index-abc.js", lazyEntry)).toEqual(["index-abc.js"]);
    const m = measure(shell);
    expect(m.firstPaint).toEqual({ kb: 356, files: 4 });
  });

  it("fails when first-paint JS grows more than 5 percent", () => {
    const m = measure(chunks);
    // index-abc imports nothing statically here, so first paint is the entry alone (280 kB).
    expect(m.firstPaint).toEqual({ kb: 280, files: 1 });
    expect(judge(m, { entryKb: 280, firstPaintKb: 267, totalKb: 445 }).failures).toEqual([]);
    expect(judge(m, { entryKb: 280, firstPaintKb: 260, totalKb: 445 }).failures[0]).toMatch(
      /first-paint JS \(the entry and the chunks it imports up front\) grew from 260 kB/,
    );
    // A baseline from before the measure existed does not fail on it.
    expect(judge(m, { entryKb: 280, totalKb: 445 }).failures).toEqual([]);
  });

  it("passes at the baseline and reports the entry target without failing", () => {
    const m = measure(chunks);
    const out = judge(m, { entryKb: 280, totalKb: 445 });
    expect(out.failures).toEqual([]);
    expect(out.notes[0]).toMatch(/entry chunk is 280 kB gzip, over the plan's 250 kB target/);
  });

  it("allows up to 5 percent growth and fails beyond it", () => {
    const m = measure(chunks);
    expect(judge(m, { entryKb: 267, totalKb: 445 }).failures).toEqual([]); // +4.9%
    expect(judge(m, { entryKb: 260, totalKb: 445 }).failures[0]).toMatch(/entry chunk grew/);
    expect(judge(m, { entryKb: 280, totalKb: 400 }).failures[0]).toMatch(/total client JS grew/);
  });

  it("enforces the hard chunk and total limits", () => {
    const big = { ...chunks, "superadmin.js": chunk('import{x}from"./index-abc.js";', 151) };
    expect(judge(measure(big), { entryKb: 280, totalKb: 10_000 }).failures[0]).toMatch(
      /superadmin\.js is 151 kB gzip, over the 150 kB chunk limit/,
    );
    const huge = { ...chunks, "vendor-y.js": chunk('import{x}from"./index-abc.js";', 149) };
    const many = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`v${i}.js`, chunk('import"./index-abc.js";', 149)]),
    );
    const out = judge(measure({ ...huge, ...many }), { entryKb: 280, totalKb: 10_000 });
    expect(out.failures.some((f: string) => /over the 1500 kB limit/.test(f))).toBe(true);
  });

  it("uses the plan's limits", () => {
    expect(LIMITS).toEqual({ entryKb: 250, chunkKb: 150, totalKb: 1500, growth: 0.05 });
  });

  it("has a baseline, and CI checks the build against it", () => {
    const baseline = JSON.parse(readFileSync("build/bundle-baseline.json", "utf8"));
    expect(baseline.entryKb).toBeGreaterThan(0);
    expect(baseline.totalKb).toBeGreaterThan(baseline.entryKb);
    expect(baseline.firstPaintKb).toBeGreaterThanOrEqual(baseline.entryKb);
    expect(baseline.firstPaintKb).toBeLessThan(baseline.totalKb);
    const wf = readFileSync(".github/workflows/unit-lint.yml", "utf8");
    const step = wf.slice(wf.indexOf("- name: Bundle budget"));
    expect(step).toContain("run: node scripts/bundle-budget.mjs .output/public/assets");
    expect(step.split("\n- name:")[0]).not.toContain("continue-on-error");
  });
});
