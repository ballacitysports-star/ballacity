#!/usr/bin/env node
/**
 * Plan 9.2 test gate: a pull request whose migrations add or change a row-level security
 * policy must also add or change a SQL test under supabase/tests/.
 *
 * "Adds a policy" means an added line in supabase/migrations/*.sql, outside a `--` comment,
 * containing `create policy` or `alter policy` (any case). Removing a policy or rewriting a
 * function does not trigger it. The gate is per branch: one test file can cover several
 * migrations, as the existing NNN_*.test.sql files do.
 *
 *   node scripts/policy-tests-gate.mjs                 # against origin/main
 *   POLICY_BASE=origin/other node scripts/policy-tests-gate.mjs
 *   POLICY_HEAD=<commit> ...                           # check a commit instead of HEAD
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const MIGRATION = /^supabase\/migrations\/[^/]+\.sql$/;
const SQL_TEST = /^supabase\/tests\/.+\.sql$/;
const POLICY = /\b(create|alter)\s+policy\b/i;

/** The line without its `--` comment (a `--` inside a quoted string is rare in DDL; good enough). */
export function stripSqlComment(line) {
  const i = line.indexOf("--");
  return i === -1 ? line : line.slice(0, i);
}

/** Whether any of these added SQL lines creates or alters a policy. */
export function addsPolicy(addedLines) {
  return addedLines.some((l) => POLICY.test(stripSqlComment(l)));
}

/**
 * @param {{ path: string, added: string[] }[]} changes  changed files and their added lines
 * @returns {{ ok: true } | { ok: false, migrations: string[] }}
 */
export function checkPolicyTests(changes) {
  const migrations = changes
    .filter((c) => MIGRATION.test(c.path) && addsPolicy(c.added))
    .map((c) => c.path)
    .sort();
  if (migrations.length === 0) return { ok: true };
  if (changes.some((c) => SQL_TEST.test(c.path))) return { ok: true };
  return { ok: false, migrations };
}

/** Added lines per file from a `git diff --unified=0` patch. */
export function parseAddedLines(patch) {
  const out = new Map();
  let file = null;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ ")) {
      const p = line.slice(4).trim();
      file = p === "/dev/null" ? null : p.replace(/^b\//, "");
      if (file && !out.has(file)) out.set(file, []);
    } else if (file && line.startsWith("+") && !line.startsWith("+++")) {
      out.get(file).push(line.slice(1));
    }
  }
  return out;
}

const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 64 * 1024 * 1024,
  });

function main() {
  const base = process.env.POLICY_BASE || "origin/main";
  const head = process.env.POLICY_HEAD || "HEAD";
  let mergeBase;
  try {
    mergeBase = git("merge-base", head, base).trim();
  } catch (e) {
    console.error(`Could not compare with ${base}: ${e.message.split("\n")[0]}`);
    console.error("Fetch it first (git fetch origin main) or set POLICY_BASE.");
    process.exit(2);
  }
  const names = git("diff", "--name-only", "--diff-filter=ACMR", mergeBase, head)
    .split("\n")
    .filter(Boolean);
  const added = parseAddedLines(
    git("diff", "--unified=0", "--diff-filter=ACMR", mergeBase, head, "--", "supabase/migrations"),
  );
  const changes = names.map((path) => ({ path, added: added.get(path) ?? [] }));
  const result = checkPolicyTests(changes);
  if (result.ok) {
    console.log("Policy gate: no policy change without a SQL test.");
    return;
  }
  console.error("Policy gate: these migrations add or change a policy, but no SQL test changed:");
  for (const m of result.migrations) console.error(`  ${m}`);
  console.error(
    "Add or update a test under supabase/tests/ that exercises the policy (see supabase/tests/README.md).",
  );
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
