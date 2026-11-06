import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM without types
import * as ratchet from "../../scripts/lint-changed.mjs";

const { errorsByRule, lintable, regressions } = ratchet;
const msg = (ruleId: string | null, severity = 2) => ({ ruleId, severity });

describe("lint ratchet (P3-9)", () => {
  it("lints source files only, never generated or vendored ones", () => {
    expect(
      lintable([
        "src/a.ts",
        "src/a.ts",
        "src/b.tsx",
        "scripts/c.mjs",
        "docs/x.md",
        "src/routeTree.gen.ts",
        "src/integrations/supabase/types.ts",
        "node_modules/z/index.js",
      ]),
    ).toEqual(["scripts/c.mjs", "src/a.ts", "src/b.tsx"]);
  });

  it("counts errors by rule, ignoring warnings and formatting", () => {
    expect(
      errorsByRule({
        messages: [
          msg("@typescript-eslint/no-explicit-any"),
          msg("@typescript-eslint/no-explicit-any"),
          msg("prettier/prettier"),
          msg("react-hooks/exhaustive-deps", 1),
          msg(null),
        ],
      }),
    ).toEqual({ "@typescript-eslint/no-explicit-any": 2, "parse-error": 1 });
  });

  it("fails a file whose errors went up, naming the rules that grew", () => {
    const base = { "src/a.ts": { "no-explicit-any": 3 } };
    const head = { "src/a.ts": { "no-explicit-any": 3, "no-empty": 1 } };
    expect(regressions(head, base)).toEqual([
      { file: "src/a.ts", before: 3, after: 4, rules: ["no-empty"] },
    ]);
  });

  it("passes a file that kept or lowered its count, even if the mix changed", () => {
    const base = { "src/a.ts": { "no-explicit-any": 3 } };
    expect(regressions({ "src/a.ts": { "no-explicit-any": 3 } }, base)).toEqual([]);
    expect(regressions({ "src/a.ts": { "no-explicit-any": 1 } }, base)).toEqual([]);
    expect(regressions({ "src/a.ts": { "no-explicit-any": 2, "no-empty": 1 } }, base)).toEqual([]);
  });

  it("a new file must have no errors", () => {
    expect(regressions({ "src/new.ts": {} }, {})).toEqual([]);
    expect(regressions({ "src/new.ts": { "no-explicit-any": 1 } }, {})).toEqual([
      { file: "src/new.ts", before: 0, after: 1, rules: ["no-explicit-any"] },
    ]);
  });

  it("runs as a blocking pull request step against the base branch", () => {
    const wf = readFileSync(".github/workflows/unit-lint.yml", "utf8");
    const start = wf.indexOf("- name: Lint (files changed in this pull request add no errors)");
    expect(start).toBeGreaterThan(-1);
    const step = wf.slice(start, wf.indexOf("\n\n", start));
    expect(step).toContain("run: node scripts/lint-changed.mjs");
    expect(step).toContain("LINT_BASE: origin/${{ github.base_ref }}");
    expect(step).not.toContain("continue-on-error");
    expect(wf).toContain("fetch-depth: 0");
  });
});
