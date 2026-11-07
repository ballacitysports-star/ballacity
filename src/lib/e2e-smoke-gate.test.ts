/**
 * P0-9: the E2E smoke gate (.github/e2e-smoke-gate.mjs), its manifest
 * (e2e/smoke-set.json) and how the E2E workflow wires them into the `E2E smoke` check.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM without types
import * as gate from "../../.github/e2e-smoke-gate.mjs";

const { evaluateSmoke, parseSmokeSet, reportStatuses, smokeKey } = gate;

type Status = "expected" | "unexpected" | "skipped" | "flaky" | "interrupted";

/** The shape Playwright's JSON reporter writes: file suite, nested describes, specs, tests. */
function report(
  entries: { file: string; describes?: string[]; title: string; status: Status[] }[],
) {
  const files = new Map<string, Record<string, unknown>>();
  for (const e of entries) {
    const fileSuite = files.get(e.file) ?? { title: e.file, file: e.file, suites: [], specs: [] };
    files.set(e.file, fileSuite);
    let suite = fileSuite as { suites: Record<string, unknown>[]; specs: unknown[] };
    for (const d of e.describes ?? []) {
      let next = suite.suites.find((s) => s.title === d) as typeof suite | undefined;
      if (!next) {
        next = { title: d, file: e.file, suites: [], specs: [] } as unknown as typeof suite;
        suite.suites.push(next as unknown as Record<string, unknown>);
      }
      suite = next;
    }
    suite.specs.push({
      title: e.title,
      file: e.file,
      tests: e.status.map((status, i) => ({ projectName: `p${i}`, status })),
    });
  }
  return { config: {}, suites: [...files.values()] };
}

const manifest = (tests: { file: string; title: string }[]) => ({ tests });

describe("evaluateSmoke", () => {
  const set = manifest([
    { file: "a.spec.ts", title: "top level" },
    { file: "b.spec.ts", title: "outer › inner › nested" },
  ]);

  it("passes when every smoke test ran and passed", () => {
    const r = report([
      { file: "a.spec.ts", title: "top level", status: ["expected"] },
      { file: "b.spec.ts", describes: ["outer", "inner"], title: "nested", status: ["expected"] },
      { file: "c.spec.ts", title: "not smoke", status: ["unexpected"] },
    ]);
    const out = evaluateSmoke(r, set);
    expect(out.notPassed).toEqual([]);
    expect(out.passed).toHaveLength(2);
  });

  it("a skipped smoke test is not a pass", () => {
    const r = report([
      { file: "a.spec.ts", title: "top level", status: ["skipped"] },
      { file: "b.spec.ts", describes: ["outer", "inner"], title: "nested", status: ["expected"] },
    ]);
    expect(evaluateSmoke(r, set).notPassed).toEqual([
      { key: "a.spec.ts › top level", why: "skipped" },
    ]);
  });

  it("a missing smoke test (renamed, deleted or never reached) is not a pass", () => {
    const r = report([{ file: "a.spec.ts", title: "top level", status: ["expected"] }]);
    expect(evaluateSmoke(r, set).notPassed).toEqual([
      { key: "b.spec.ts › outer › inner › nested", why: "missing from the report" },
    ]);
  });

  it("failed, flaky and interrupted results are not passes, in any project", () => {
    for (const bad of ["unexpected", "flaky", "interrupted"] as const) {
      const r = report([
        { file: "a.spec.ts", title: "top level", status: ["expected", bad] },
        { file: "b.spec.ts", describes: ["outer", "inner"], title: "nested", status: ["expected"] },
      ]);
      expect(evaluateSmoke(r, set).notPassed.map((n: { why: string }) => n.why)).toEqual([
        `expected, ${bad}`,
      ]);
    }
  });

  it("matches a describe path exactly, not a test with the same leaf title elsewhere", () => {
    const r = report([
      { file: "a.spec.ts", title: "top level", status: ["expected"] },
      { file: "b.spec.ts", describes: ["outer"], title: "nested", status: ["expected"] },
    ]);
    expect(evaluateSmoke(r, set).notPassed).toHaveLength(1);
  });

  it("an empty or malformed report passes nothing", () => {
    expect(evaluateSmoke({}, set).passed).toEqual([]);
    expect(evaluateSmoke(null, set).notPassed).toHaveLength(2);
  });

  it("treats e2e/ prefixed and bare spec paths alike", () => {
    expect(smokeKey("e2e/a.spec.ts", "t")).toBe(smokeKey("a.spec.ts", "t"));
    const r = report([{ file: "e2e/a.spec.ts", title: "t", status: ["expected"] }]);
    expect(reportStatuses(r).get("a.spec.ts › t")).toEqual(["expected"]);
  });
});

describe("parseSmokeSet", () => {
  it("rejects an empty set, missing fields and duplicates", () => {
    expect(() => parseSmokeSet({ tests: [] })).toThrow(/empty/);
    expect(() => parseSmokeSet({})).toThrow(/empty/);
    expect(() => parseSmokeSet({ tests: [{ file: "a.spec.ts" }] })).toThrow(/file and a title/);
    expect(() =>
      parseSmokeSet({
        tests: [
          { file: "a.spec.ts", title: "t" },
          { file: "e2e/a.spec.ts", title: "t" },
        ],
      }),
    ).toThrow(/duplicate/);
  });
});

describe("e2e/smoke-set.json", () => {
  const set = JSON.parse(readFileSync("e2e/smoke-set.json", "utf8")) as {
    tests: { file: string; title: string }[];
  };

  it("holds 20 to 30 tests, as P0-9 specifies, with no duplicates", () => {
    expect(parseSmokeSet(set).length).toBeGreaterThanOrEqual(20);
    expect(set.tests.length).toBeLessThanOrEqual(30);
  });

  it("names spec files that exist", () => {
    for (const t of set.tests) expect(existsSync(join("e2e", t.file)), t.file).toBe(true);
  });
});

describe("the CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "smoke gate "));
  const set = join(dir, "set.json");
  writeFileSync(set, JSON.stringify(manifest([{ file: "a.spec.ts", title: "t" }])));
  const run = (r: unknown) => {
    const path = join(dir, "results.json");
    if (r === undefined) writeFileSync(path, "not json");
    else writeFileSync(path, JSON.stringify(r));
    return spawnSync(process.execPath, [".github/e2e-smoke-gate.mjs", path, set], {
      encoding: "utf8",
    });
  };

  it("exits 0 only when the set passed", () => {
    const ok = run(report([{ file: "a.spec.ts", title: "t", status: ["expected"] }]));
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("1 of 1 passed");
    expect(run(report([{ file: "a.spec.ts", title: "t", status: ["skipped"] }])).status).toBe(1);
    expect(run(undefined).status).toBe(1);
  });

  it("never prints report error text, only manifest titles", () => {
    const r = report([{ file: "a.spec.ts", title: "t", status: ["unexpected"] }]);
    const spec = (r.suites[0] as { specs: { tests: Record<string, unknown>[] }[] }).specs[0];
    spec.tests[0].results = [{ error: { message: "SECRET-LOOKING-ERROR-TEXT" } }];
    const out = run(r);
    expect(out.status).toBe(1);
    expect(`${out.stdout}${out.stderr}`).not.toContain("SECRET-LOOKING-ERROR-TEXT");
  });

  it("imports nothing that can reach a network or run code", () => {
    const src = readFileSync(".github/e2e-smoke-gate.mjs", "utf8");
    const imports = [...src.matchAll(/^import .* from "([^"]+)";/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["node:fs", "node:url"]);
    expect(src).not.toMatch(/\bfetch\(|child_process|node:(net|http|https|dns|tls)/);
  });
});

describe("the workflow wiring", () => {
  const wf = readFileSync(".github/workflows/e2e.yml", "utf8");
  const smokeJob = wf.slice(wf.indexOf("\n  smoke:\n"));
  const gateStep = (() => {
    const start = wf.indexOf("- name: Check smoke set");
    const rest = wf.slice(start + 5);
    const m = /\n\n? {6}(?:- |#)/.exec(rest);
    return wf.slice(start, m ? start + 5 + m.index : undefined);
  })();

  it("judges the sanitized report only, after redaction, and records success last", () => {
    expect(gateStep).toContain("id: smoke");
    expect(gateStep).toContain("steps.redact.outputs.sanitized == 'true'");
    expect(gateStep).toContain(
      "node .github/e2e-smoke-gate.mjs ci-sanitized/results.json e2e/smoke-set.json",
    );
    expect(gateStep).not.toMatch(/playwright-report\/|secrets\.|SUPABASE|\benv:/);
    expect(gateStep).not.toMatch(/\|\|\s*(true|:)|continue-on-error|shell:/);
    const lines = gateStep.split("\n").map((l) => l.trim());
    const gate = lines.findIndex((l) => l.startsWith("node .github/e2e-smoke-gate.mjs"));
    const flag = lines.findIndex((l) => l.includes("result=passed"));
    expect(flag).toBe(gate + 1);
    expect(wf.match(/result=passed/g)?.length).toBe(1);
    expect(wf.indexOf("- name: Check smoke set")).toBeGreaterThan(
      wf.indexOf("- name: Redact report"),
    );
  });

  it("exposes the result as the Playwright job's output", () => {
    expect(wf).toContain("smoke: ${{ steps.smoke.outputs.result }}");
  });

  it("the E2E smoke job always reports, fails closed and holds nothing", () => {
    expect(smokeJob).toContain("name: E2E smoke");
    expect(smokeJob).toContain("needs: playwright");
    expect(smokeJob).toContain("if: always()");
    expect(smokeJob).toContain("permissions: {}");
    expect(smokeJob).toContain('if [ "$SMOKE" = "passed" ]; then');
    expect(smokeJob).toMatch(/exit 1\s*$/);
    expect(smokeJob).not.toMatch(/secrets\.|environment:|actions\/checkout|SUPABASE/);
  });
});
