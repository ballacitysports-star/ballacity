// Self-tests for scripts/release-preflight.mjs (node:test; run with `bun run preflight:test`).
//
// Builds throwaway databases on the LOCAL Postgres that `bun run test:db` uses (psql + PGHOST/PGUSER
// or the default unix socket), drops them afterwards, and never connects anywhere else. Not part of
// any required CI workflow (and excluded from vitest).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import {
  DEFAULT_MANIFEST,
  LEDGER,
  ROOT,
  loadManifest,
  migrationOrder,
} from "./release-preflight.mjs";
import * as scratch from "./release-preflight-scratch.mjs";

const TOOL = join(ROOT, "scripts/release-preflight.mjs");
const manifest = loadManifest(join(ROOT, DEFAULT_MANIFEST));
const FROM = manifest.release_range.from;
const PRE = `rpf_${process.pid}_pre`;
const FULL = `rpf_${process.pid}_full`;
const created = new Set();
const tempDirs = [];
let stripMaintain = false;
let counter = 0;

function localUrl(db) {
  const host =
    process.env.PGHOST ||
    scratch.sql("postgres", "SHOW unix_socket_directories").trim().split(",")[0].trim();
  const params = new URLSearchParams({ host });
  if (process.env.PGPORT) params.set("port", process.env.PGPORT);
  params.set("user", process.env.PGUSER || scratch.sql("postgres", "SELECT current_user").trim());
  if (process.env.PGPASSWORD) params.set("password", process.env.PGPASSWORD);
  return `postgresql:///${db}?${params}`;
}

function newDb(template) {
  const name = `rpf_${process.pid}_${++counter}`;
  scratch.createDb(name, template);
  created.add(name);
  return name;
}

const ledgerCount = (db) => Number(scratch.sql(db, `SELECT count(*) FROM ${LEDGER}`).trim());

function ledgerRow(db, entry) {
  scratch.sql(
    db,
    `INSERT INTO ${LEDGER} (version, name, statements)
     VALUES ('${entry.version}', '${entry.path
       .split("/")
       .pop()
       .replace(/\.sql$/, "")}', ARRAY[]::text[]);`,
  );
}

function applyEntries(db, entries) {
  for (const e of entries) {
    scratch.applyMigration(db, join(ROOT, e.path), stripMaintain);
    ledgerRow(db, e);
  }
}

/** Runs the tool; for database runs also proves that the target is unchanged afterwards. */
function preflight(db, extraArgs = [], { root, manifestPath } = {}) {
  const args = [TOOL, "--json", ...extraArgs];
  if (db) args.push("--db-url", localUrl(db));
  else if (!extraArgs.includes("--offline")) args.push("--offline");
  if (root) args.push("--root", root);
  if (manifestPath) args.push("--manifest", manifestPath);
  const env = { ...process.env };
  delete env.PREFLIGHT_DATABASE_URL;
  const beforeState = db && { fp: scratch.fingerprint(db), ledger: ledgerCount(db) };
  const r = spawnSync(process.execPath, args, { encoding: "utf8", env });
  if (db) {
    assert.equal(
      scratch.fingerprint(db),
      beforeState.fp,
      "catalog fingerprint changed: the preflight wrote to the target",
    );
    assert.equal(
      ledgerCount(db),
      beforeState.ledger,
      "ledger row count changed: the preflight wrote to the target",
    );
  }
  let report;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    throw new Error(`preflight printed no JSON (exit ${r.status}):\n${r.stdout}\n${r.stderr}`);
  }
  return { code: r.status, report, text: (report.errors ?? []).join("\n") };
}

/** A copy of the checkout's migrations and manifest that a test may tamper with. */
function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), "release-preflight-"));
  tempDirs.push(dir);
  cpSync(join(ROOT, "supabase/migrations"), join(dir, "supabase/migrations"), { recursive: true });
  cpSync(join(ROOT, "drizzle/migrations"), join(dir, "drizzle/migrations"), { recursive: true });
  cpSync(join(ROOT, DEFAULT_MANIFEST), join(dir, DEFAULT_MANIFEST));
  return dir;
}
const editManifest = (dir, fn) => {
  const path = join(dir, DEFAULT_MANIFEST);
  const m = JSON.parse(readFileSync(path, "utf8"));
  fn(m);
  writeFileSync(path, JSON.stringify(m, null, 2));
};
const byVersion = (v) => manifest.migrations.find((e) => e.version === v);

before(() => {
  stripMaintain = scratch.serverVersionNum() < 170000;
  // Pre-release target: everything before the release range, plus a production-like ledger.
  scratch.createDb(PRE);
  created.add(PRE);
  scratch.loadStub(PRE, ROOT);
  const history = migrationOrder(ROOT).filter((m) => m.version < FROM);
  for (const m of history) scratch.applyMigration(PRE, join(ROOT, m.path), stripMaintain);
  scratch.sql(
    PRE,
    `CREATE SCHEMA supabase_migrations;
     CREATE TABLE ${LEDGER} (version text PRIMARY KEY, statements text[], name text);
     INSERT INTO ${LEDGER} (version, name, statements)
     SELECT DISTINCT ON (v) v, n, ARRAY[]::text[] FROM (VALUES ${history
       .filter((m) => m.source === "supabase" && m.version <= "20260926155719")
       .map((m) => `('${m.version}', '${m.name}')`)
       .join(", ")}) x(v, n);`,
  );
  // Fully released target: every manifest migration applied with its ledger row.
  scratch.createDb(FULL, PRE);
  created.add(FULL);
  applyEntries(FULL, manifest.migrations);
});

after(() => {
  for (const db of created) scratch.dropDb(db);
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("happy paths", () => {
  test("pre-release target: passes and lists every manifest migration as pending, in order", () => {
    const { code, report } = preflight(PRE);
    assert.equal(code, 0, report.errors?.join("\n"));
    assert.equal(report.read_only, true);
    assert.deepEqual(
      report.pending.map((p) => p.version),
      manifest.migrations.map((e) => e.version),
    );
    assert.equal(report.applied.length, 0);
    assert.ok(
      report.warnings.some(
        (w) => w.includes("private_sec.game_payee(text)") && w.includes("superseded"),
      ),
    );
  });

  test("fully released target: nothing pending and --verify-after matches every protection", () => {
    const { code, report } = preflight(FULL, ["--verify-after"]);
    assert.equal(code, 0, report.errors?.join("\n"));
    assert.equal(report.pending.length, 0);
    assert.equal(report.protections.matching, report.protections.checked);
    assert.ok(report.protections.checked > 100);
  });

  test("--verify-after on the pre-release target fails: protections are missing and migrations pending", () => {
    const { code, text } = preflight(PRE, ["--verify-after"]);
    assert.equal(code, 1);
    assert.match(text, /not applied yet/);
    assert.match(text, /protection private_sec\.game_payee\(text\) is missing/);
  });

  test("checked-in manifest is consistent with the checkout (offline)", () => {
    const { code, report } = preflight(null, ["--offline"]);
    assert.equal(code, 0, report.errors?.join("\n"));
  });
});

describe("manifest integrity (hard failures)", () => {
  test("tampered file: sha256 mismatch", () => {
    const dir = tempRoot();
    const target = byVersion("20261104100000").path;
    writeFileSync(join(dir, target), `${readFileSync(join(dir, target), "utf8")}\n-- tampered\n`);
    const { code, text } = preflight(null, ["--offline"], { root: dir });
    assert.equal(code, 1);
    assert.match(text, /20261104100000.*sha256 mismatch/);
  });

  test("tampered file also fails a database run", () => {
    const dir = tempRoot();
    const target = byVersion("20261103140000").path;
    writeFileSync(
      join(dir, target),
      readFileSync(join(dir, target), "utf8").replace("game_payee", "game_payeE"),
    );
    const { code, text } = preflight(PRE, [], { root: dir });
    assert.equal(code, 1);
    assert.match(text, /20261103140000.*sha256 mismatch/);
  });

  test("skipped file: a manifest entry removed", () => {
    const dir = tempRoot();
    editManifest(dir, (m) => {
      m.migrations = m.migrations.filter((e) => e.version !== "20261104130000");
    });
    const { code, text } = preflight(null, ["--offline"], { root: dir });
    assert.equal(code, 1);
    assert.match(
      text,
      /unlisted migration in the release range: .*20261104130000_location_text_detector\.sql/,
    );
  });

  test("skipped file: a new file in the migrations folder that the manifest does not list", () => {
    const dir = tempRoot();
    writeFileSync(join(dir, "supabase/migrations/20261107090000_late_addition.sql"), "SELECT 1;\n");
    const { code, text } = preflight(null, ["--offline"], { root: dir });
    assert.equal(code, 1);
    assert.match(text, /unlisted migration .*20261107090000_late_addition\.sql/);
  });

  test("missing file", () => {
    const dir = tempRoot();
    unlinkSync(join(dir, byVersion("20261105110000").path));
    const { code, text } = preflight(null, ["--offline"], { root: dir });
    assert.equal(code, 1);
    assert.match(text, /20261105110000.*missing from the checkout/);
  });

  test("duplicate version", () => {
    const dir = tempRoot();
    editManifest(dir, (m) => {
      const i = m.migrations.findIndex((e) => e.version === "20261103130000");
      m.migrations.splice(i + 1, 0, { ...m.migrations[i] });
    });
    const { code, text } = preflight(null, ["--offline"], { root: dir });
    assert.equal(code, 1);
    assert.match(text, /duplicate version 20261103130000/);
  });

  test("out-of-order version", () => {
    const dir = tempRoot();
    editManifest(dir, (m) => {
      const i = m.migrations.findIndex((e) => e.version === "20261104110000");
      [m.migrations[i], m.migrations[i + 1]] = [m.migrations[i + 1], m.migrations[i]];
    });
    const { code, text } = preflight(null, ["--offline"], { root: dir });
    assert.equal(code, 1);
    assert.match(text, /20261104110000.*out of order/);
  });
});

describe("dependencies, ledger and protections against a target", () => {
  test("missing dependency: a required table and function absent from the target", () => {
    const db = newDb(PRE);
    scratch.sql(
      db,
      "DROP TABLE public.user_reports CASCADE; DROP FUNCTION public.can_notify(uuid,uuid) CASCADE;",
    );
    const { code, text } = preflight(db);
    assert.equal(code, 1);
    assert.match(text, /missing dependency: 20261106130000 .* requires table public\.user_reports/);
    assert.match(
      text,
      /missing dependency: 20261106140000 .* requires function public\.can_notify\(uuid,uuid\)/,
    );
  });

  test("missing dependency: a requirement no earlier pending migration provides", () => {
    const dir = tempRoot();
    editManifest(dir, (m) => {
      m.migrations.find((e) => e.version === "20261103140000").provides.functions = [];
    });
    const { code, text } = preflight(PRE, [], { root: dir });
    assert.equal(code, 1);
    assert.match(
      text,
      /missing dependency: 20261104120000 .* requires function private_sec\.game_payee\(text\)/,
    );
  });

  test("already-applied migrations are excluded from the pending list", () => {
    const db = newDb(PRE);
    const k = manifest.migrations.findIndex((e) => e.version === "20261103140000") + 1;
    applyEntries(db, manifest.migrations.slice(0, k));
    const { code, report } = preflight(db);
    assert.equal(code, 0, report.errors?.join("\n"));
    assert.deepEqual(
      report.applied.map((a) => a.version),
      manifest.migrations.slice(0, k).map((e) => e.version),
    );
    assert.deepEqual(
      report.pending.map((p) => p.version),
      manifest.migrations.slice(k).map((e) => e.version),
    );
    assert.equal(report.pending[0].order, k + 1);
  });

  test("gap: a later version applied while an earlier one is not", () => {
    const db = newDb(PRE);
    ledgerRow(db, manifest.migrations[1]);
    const { code, text } = preflight(db);
    assert.equal(code, 1);
    assert.match(
      text,
      new RegExp(
        `gap: ${manifest.migrations[1].version} .* earlier ${manifest.migrations[0].version}`,
      ),
    );
  });

  test("gap that would replay an older protection over a newer one: game_payee and the approval functions", () => {
    const db = newDb(FULL);
    scratch.sql(db, `DELETE FROM ${LEDGER} WHERE version IN ('20261103140000', '20261104110000')`);
    const { code, text } = preflight(db);
    assert.equal(code, 1);
    assert.match(text, /gap: .*20261103140000/);
    assert.match(
      text,
      /regression: pending 20261103140000 .* redefines private_sec\.game_payee\(text\), but the later definition from 20261104120000 is already applied/,
    );
    assert.match(
      text,
      /regression: pending 20261104110000 .* redefines public\.grant_minor_hosting_approval\(uuid,integer,boolean\)/,
    );
  });

  test("an unknown ledger row in the release range fails", () => {
    const db = newDb(FULL);
    scratch.sql(
      db,
      `INSERT INTO ${LEDGER} (version, name, statements) VALUES ('20261107000000', 'not_in_repo', ARRAY[]::text[])`,
    );
    const { code, text } = preflight(db);
    assert.equal(code, 1);
    assert.match(text, /ledger row 20261107000000 .* not in the manifest/);
  });

  test("regressed protection: replaying a historical migration changes game_payee's md5", () => {
    const db = newDb(FULL);
    // Re-running step 3 after step 6 is exactly what the runbook forbids: it resets game_payee().
    scratch.applyMigration(db, join(ROOT, byVersion("20261103140000").path), stripMaintain);
    const plain = preflight(db);
    assert.equal(plain.code, 1);
    assert.match(
      plain.text,
      /protection private_sec\.game_payee\(text\) differs from expect_after.*drifted or was regressed/,
    );
    const after = preflight(db, ["--verify-after"]);
    assert.equal(after.code, 1);
    assert.match(
      after.text,
      /protection private_sec\.game_payee\(text\) differs from expect_after/,
    );
  });

  test("regressed policy: a widened qual is caught by --verify-after", () => {
    const db = newDb(FULL);
    scratch.sql(
      db,
      `ALTER POLICY "Authorized people read exact game location" ON public.hosted_game_private USING (true);`,
    );
    const { code, text } = preflight(db, ["--verify-after"]);
    assert.equal(code, 1);
    assert.match(
      text,
      /policy Authorized people read exact game location on public\.hosted_game_private differs/,
    );
  });

  test("no target given: refuses with exit 2", () => {
    const env = { ...process.env };
    delete env.PREFLIGHT_DATABASE_URL;
    const r = spawnSync(process.execPath, [TOOL], { encoding: "utf8", env });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /No target/);
  });

  test("--write-manifest refuses a target URL", () => {
    const r = spawnSync(
      process.execPath,
      [TOOL, "--write-manifest", "--from", FROM, "--db-url", localUrl(PRE)],
      {
        encoding: "utf8",
      },
    );
    assert.equal(r.status, 2);
    assert.match(r.stderr, /local scratch database only/);
  });
});
