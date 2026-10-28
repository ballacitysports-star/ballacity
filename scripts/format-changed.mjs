#!/usr/bin/env node
/**
 * Fails when a file changed in this branch is not Prettier-formatted.
 *
 * `eslint .` reports thousands of formatting errors because 240 files were never
 * formatted, and rewriting them all in one commit would bury real changes and
 * collide with every open branch. So the gate looks only at what a branch
 * touches: new and edited files must be clean, and the backlog shrinks as files
 * are next edited instead of growing.
 *
 *   node scripts/format-changed.mjs                 # against origin/main
 *   FORMAT_BASE=origin/some-branch node scripts/format-changed.mjs
 *
 * Fix with the command it prints, or `bunx prettier --write <file>`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const EXT = /\.(?:ts|tsx|js|mjs|cjs|json|css)$/;
/** Generated or vendored: never hand-formatted, so never checked. */
const SKIP = [/^node_modules\//, /(^|\/)routeTree\.gen\.ts$/, /^src\/integrations\/supabase\//];

/** The changed paths worth checking, de-duplicated and sorted. */
export function formattable(paths) {
  return [...new Set(paths)]
    .map((p) => p.trim())
    .filter((p) => p && EXT.test(p) && !SKIP.some((re) => re.test(p)))
    .sort();
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const lines = (s) => s.split("\n").filter(Boolean);

function changedFiles(base) {
  const mergeBase = git("merge-base", "HEAD", base).trim();
  return [
    // Committed and uncommitted edits to tracked files, since the branch point.
    ...lines(git("diff", "--name-only", "--diff-filter=ACMR", mergeBase)),
    // New files not added yet.
    ...lines(git("ls-files", "--others", "--exclude-standard")),
  ];
}

function main() {
  const base = process.env.FORMAT_BASE || "origin/main";
  let files;
  try {
    files = formattable(changedFiles(base));
  } catch (e) {
    console.error(`Could not compare with ${base}: ${e.message.split("\n")[0]}`);
    console.error("Fetch it first (git fetch origin main) or set FORMAT_BASE.");
    process.exit(2);
  }
  if (files.length === 0) {
    console.log("No changed files to check for formatting.");
    return;
  }
  // --list-different prints only the files that need work (and exits 1 for them).
  const r = spawnSync("npx", ["prettier", "--list-different", ...files], { encoding: "utf8" });
  const offenders = lines(r.stdout ?? "");
  if (r.status !== 0 || offenders.length > 0) {
    if (offenders.length === 0) {
      console.error(r.stderr || "Prettier could not check the changed files.");
      process.exit(r.status ?? 1);
    }
    console.error(`These changed files are not formatted:\n  ${offenders.join("\n  ")}`);
    console.error(`\nFix with:\n  npx prettier --write ${offenders.join(" ")}`);
    process.exit(1);
  }
  console.log(`${files.length} changed file(s) are formatted.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
