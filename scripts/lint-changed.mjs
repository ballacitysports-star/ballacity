#!/usr/bin/env node
/**
 * P3-9 lint ratchet: a branch may not add ESLint errors to any file it touches.
 *
 * `eslint .` still reports a large backlog (mostly no-explicit-any), so the full lint
 * stays informational. This gate looks only at what the branch changes: for each
 * changed file it counts ESLint errors now and in the file's version at the branch
 * point, and fails if any file has more than it had. A new file must have none.
 * The backlog can only shrink, file by file, as files are next edited.
 *
 * Formatting is not counted here (prettier/prettier); `format-changed.mjs` already
 * requires changed files to be fully formatted.
 *
 *   node scripts/lint-changed.mjs                # against origin/main
 *   LINT_BASE=origin/some-branch node scripts/lint-changed.mjs
 */
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const EXT = /\.(?:ts|tsx|js|mjs|cjs)$/;
/** Generated, vendored or not linted by eslint.config.js. */
const SKIP = [
  /^node_modules\//,
  /(^|\/)routeTree\.gen\.ts$/,
  /^src\/integrations\/supabase\//,
  /^dist\//,
  /^\.output\//,
];
const IGNORED_RULES = new Set(["prettier/prettier"]);

/** The changed paths worth linting, de-duplicated and sorted. */
export function lintable(paths) {
  return [...new Set(paths)]
    .map((p) => p.trim())
    .filter((p) => p && EXT.test(p) && !SKIP.some((re) => re.test(p)))
    .sort();
}

/** Error count per rule for one ESLint result, ignoring formatting. */
export function errorsByRule(result) {
  const out = {};
  for (const m of result?.messages ?? []) {
    if (m.severity !== 2 || IGNORED_RULES.has(m.ruleId)) continue;
    const rule = m.ruleId ?? "parse-error";
    out[rule] = (out[rule] ?? 0) + 1;
  }
  return out;
}

const total = (byRule) => Object.values(byRule).reduce((a, b) => a + b, 0);

/**
 * Files whose error count went up. `base[file]` is undefined for a new file (allowed 0).
 * @returns {{ file: string, before: number, after: number, rules: string[] }[]}
 */
export function regressions(head, base) {
  const out = [];
  for (const [file, now] of Object.entries(head)) {
    const before = base[file] ? total(base[file]) : 0;
    const after = total(now);
    if (after > before) {
      const rules = Object.keys(now).filter((r) => (now[r] ?? 0) > (base[file]?.[r] ?? 0));
      out.push({ file, before, after, rules: rules.sort() });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const lines = (s) => s.split("\n").filter(Boolean);

function changedFiles(mergeBase) {
  return [
    ...lines(git("diff", "--name-only", "--diff-filter=ACMR", mergeBase)),
    ...lines(git("ls-files", "--others", "--exclude-standard")),
  ];
}

function eslintJson(args, input) {
  const r = spawnSync("npx", ["eslint", "--format", "json", ...args], {
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0 && r.status !== 1) {
    throw new Error(`eslint exited ${r.status}: ${(r.stderr || "").split("\n")[0]}`);
  }
  return JSON.parse(r.stdout || "[]");
}

function main() {
  const base = process.env.LINT_BASE || "origin/main";
  let mergeBase;
  let files;
  try {
    mergeBase = git("merge-base", "HEAD", base).trim();
    files = lintable(changedFiles(mergeBase));
  } catch (e) {
    console.error(`Could not compare with ${base}: ${e.message.split("\n")[0]}`);
    console.error("Fetch it first (git fetch origin main) or set LINT_BASE.");
    process.exit(2);
  }
  if (files.length === 0) {
    console.log("No changed files to lint.");
    return;
  }

  const head = {};
  for (const r of eslintJson(["--no-warn-ignored", ...files])) {
    const rel = r.filePath.replace(`${process.cwd()}/`, "");
    head[rel] = errorsByRule(r);
  }

  const before = {};
  for (const file of Object.keys(head)) {
    let source;
    try {
      source = git("show", `${mergeBase}:${file}`);
    } catch {
      continue; // new in this branch: allowed none
    }
    const [r] = eslintJson(["--no-warn-ignored", "--stdin", "--stdin-filename", file], source);
    before[file] = errorsByRule(r);
  }

  const worse = regressions(head, before);
  const checked = Object.keys(head).length;
  if (worse.length === 0) {
    console.log(`Lint ratchet: ${checked} changed file(s), none adds ESLint errors.`);
    return;
  }
  console.error(`Lint ratchet: ${worse.length} changed file(s) add ESLint errors:`);
  for (const w of worse) {
    console.error(`  ${w.file}: ${w.before} -> ${w.after} (${w.rules.join(", ")})`);
  }
  console.error(`See them with: npx eslint ${worse.map((w) => w.file).join(" ")}`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
