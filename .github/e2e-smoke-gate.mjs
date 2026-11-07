// P0-9: decide the "E2E smoke" check from Playwright's sanitized JSON report.
//
//   node .github/e2e-smoke-gate.mjs <sanitized results.json> [smoke-set.json]
//
// Exit 0 only when every test named in e2e/smoke-set.json is in the report and
// passed. A test that is missing (renamed, deleted, never reached), skipped,
// failed, timed out, interrupted or flaky counts as not passed: a skip is not a
// pass. Output names smoke tests by the titles in the manifest only; it never
// prints error text from the report.
//
// Reads files only. No network, no child processes, no secrets.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SEP = " › ";

/** Basename of a spec path, so "e2e/foo.spec.ts" and "foo.spec.ts" compare equal. */
export function specName(file) {
  return String(file ?? "")
    .split(/[\\/]/)
    .pop();
}

export function smokeKey(file, title) {
  return `${specName(file)}${SEP}${title}`;
}

/**
 * Flatten a Playwright JSON report into Map<key, statuses[]>. The key is the spec
 * file plus the describe titles below the file-level suite plus the test title.
 * A test can have one entry per project; every entry must pass.
 */
export function reportStatuses(report) {
  const out = new Map();
  const walk = (suite, path, file) => {
    for (const child of suite.suites ?? []) {
      const childFile = child.file ?? file;
      // The top-level suite for each file is titled with the file path itself.
      const isFileSuite = !file && childFile && specName(child.title) === specName(childFile);
      walk(child, isFileSuite ? path : [...path, child.title], childFile);
    }
    for (const spec of suite.specs ?? []) {
      const key = smokeKey(spec.file ?? file, [...path, spec.title].join(SEP));
      const statuses = out.get(key) ?? [];
      for (const t of spec.tests ?? []) statuses.push(t.status ?? "unknown");
      out.set(key, statuses);
    }
  };
  walk(report ?? {}, [], undefined);
  return out;
}

export function parseSmokeSet(manifest) {
  const tests = manifest?.tests;
  if (!Array.isArray(tests) || tests.length === 0) throw new Error("smoke set is empty");
  const keys = tests.map((t) => {
    if (typeof t?.file !== "string" || typeof t?.title !== "string" || !t.file || !t.title) {
      throw new Error("every smoke entry needs a file and a title");
    }
    return smokeKey(t.file, t.title);
  });
  if (new Set(keys).size !== keys.length) throw new Error("smoke set has duplicate entries");
  return keys;
}

/** @returns {{ passed: string[], notPassed: { key: string, why: string }[] }} */
export function evaluateSmoke(report, manifest) {
  const keys = parseSmokeSet(manifest);
  const statuses = reportStatuses(report);
  const passed = [];
  const notPassed = [];
  for (const key of keys) {
    const s = statuses.get(key);
    if (!s || s.length === 0) notPassed.push({ key, why: "missing from the report" });
    else if (s.every((x) => x === "expected")) passed.push(key);
    else notPassed.push({ key, why: [...new Set(s)].join(", ") });
  }
  return { passed, notPassed };
}

function main(argv) {
  const [reportPath, manifestPath = "e2e/smoke-set.json"] = argv;
  if (!reportPath) {
    console.error("usage: node .github/e2e-smoke-gate.mjs <results.json> [smoke-set.json]");
    return 2;
  }
  let report;
  let manifest;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    console.error("E2E smoke: no readable report; the smoke set did not run.");
    return 1;
  }
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    console.error("E2E smoke: the smoke set file is missing or not JSON.");
    return 1;
  }
  let result;
  try {
    result = evaluateSmoke(report, manifest);
  } catch (e) {
    console.error(`E2E smoke: ${e instanceof Error ? e.message : "invalid smoke set"}`);
    return 1;
  }
  const total = result.passed.length + result.notPassed.length;
  console.log(`E2E smoke: ${result.passed.length} of ${total} passed`);
  for (const { key, why } of result.notPassed) console.log(`  not passed (${why}): ${key}`);
  return result.notPassed.length === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
