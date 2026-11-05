// Self-tests for scripts/release-preflight.mjs (node:test; run with `bun run preflight:test`).
//
// Builds throwaway databases on the LOCAL Postgres that `bun run test:db` uses (psql + PGHOST/PGUSER
// or the default unix socket), drops them afterwards, and never connects anywhere else. Not part of
// any required CI workflow (and excluded from vitest); .github/workflows/release-preflight.yml runs it
// on Postgres 17.
//
// Version independence: the database tests use a manifest generated on the CURRENT server in before()
// (GEN), never the checked-in one, whose hashes are for the major it was generated on. The checked-in
// manifest is only checked offline and structurally.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import {
  definitionsIn,
  guardRequirements,
  DEFAULT_MANIFEST,
  LEDGER,
  ROOT,
  evaluate,
  loadManifest,
  migrationOrder,
  sha256File,
  writeManifest,
} from "./release-preflight.mjs";
import * as scratch from "./release-preflight-scratch.mjs";

const TOOL = join(ROOT, "scripts/release-preflight.mjs");
const checkedIn = loadManifest(join(ROOT, DEFAULT_MANIFEST));
const FROM = checkedIn.release_range.from;
const PRE = `rpf_${process.pid}_pre`;
const FULL = `rpf_${process.pid}_full`;
const created = new Set();
const tempDirs = [];
const GEN_DIR = mkdtempSync(join(tmpdir(), "release-preflight-gen-"));
tempDirs.push(GEN_DIR);
/** Manifest generated on this server in before(); every database test uses it. */
const GEN = join(GEN_DIR, "manifest.json");
let manifest;
let MAJOR;
let stripMaintain = false;
let counter = 0;

function localUrl(db) {
  const host =
    process.env.PGHOST ||
    scratch
      .psqlLocal("postgres", ["-At", "-c", "SHOW unix_socket_directories"])
      .stdout.trim()
      .split(",")[0]
      .trim();
  const params = new URLSearchParams({ host });
  if (process.env.PGPORT) params.set("port", process.env.PGPORT);
  params.set(
    "user",
    process.env.PGUSER ||
      scratch.psqlLocal("postgres", ["-At", "-c", "SELECT current_user"]).stdout.trim(),
  );
  if (process.env.PGPASSWORD) params.set("password", process.env.PGPASSWORD);
  return `postgresql:///${db}?${params}`;
}

function newDb(template) {
  const name = `rpf_${process.pid}_${++counter}`;
  scratch.createDb(name, template);
  created.add(name);
  return name;
}

const ledgerCount = (db) =>
  scratch.sql(db, `SELECT to_regclass('${LEDGER}') IS NULL`).trim() === "t"
    ? -1
    : Number(scratch.sql(db, `SELECT count(*) FROM ${LEDGER}`).trim());

/** Version shifted by some seconds (Lovable-applied ledger rows are 1-2 s after the file timestamp). */
function shiftVersion(v, seconds) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(v);
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + seconds * 1000);
  return t.toISOString().replace(/\D/g, "").slice(0, 14);
}
const LOVABLE_NAME = /^\d{14}_[0-9a-f]{8}-/;
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;

const stemOf = (entry) =>
  entry.path
    .split("/")
    .pop()
    .replace(/\.sql$/, "");
/** Dollar-quoted literal of a file's text (the tag never occurs in a migration). */
function dollar(text) {
  assert.ok(!text.includes("$rpf_stmt$"));
  return `$rpf_stmt$${text}$rpf_stmt$`;
}
/**
 * The ledger row the runbook template writes: name = file stem, statements = ARRAY[content], where psql's
 * backquote expansion (\set content `cat file`) drops one trailing newline. exact: keep the bytes as they are.
 */
function ledgerRow(db, entry, { name = stemOf(entry), statements, exact = false } = {}) {
  let stmts = statements;
  if (stmts === undefined) {
    const text = readFileSync(join(ROOT, entry.path), "utf8");
    stmts = `ARRAY[${dollar(exact ? text : text.replace(/\n$/, ""))}]`;
  }
  scratch.sql(
    db,
    `INSERT INTO ${LEDGER} (version, name, statements) VALUES ('${entry.version}', ${name === null ? "NULL" : q(name)}, ${stmts});`,
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
  else if (!root) args.push("--manifest", GEN);
  const env = { ...process.env };
  delete env.PREFLIGHT_DATABASE_URL;
  const beforeState = db && { fp: scratch.fingerprint(db), ledger: ledgerCount(db) };
  // A full release can report hundreds of protections; the default 1 MB buffer would truncate the output.
  const r = spawnSync(process.execPath, args, {
    encoding: "utf8",
    env,
    maxBuffer: 256 * 1024 * 1024,
  });
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
  cpSync(join(ROOT, "docs/migration-evidence"), join(dir, "docs/migration-evidence"), {
    recursive: true,
  });
  cpSync(GEN, join(dir, DEFAULT_MANIFEST));
  return dir;
}
const editManifest = (dir, fn) => {
  const path = join(dir, DEFAULT_MANIFEST);
  const m = JSON.parse(readFileSync(path, "utf8"));
  fn(m);
  writeFileSync(path, JSON.stringify(m, null, 2));
};
const byVersion = (v) => manifest.migrations.find((e) => e.version === v);
const allProt = (m) =>
  ["functions", "policies", "tables", "buckets"].flatMap((k) => m.protections[k] ?? []);

before(async () => {
  const version = scratch.serverVersionNum();
  stripMaintain = version < 170000;
  MAJOR = String(Math.floor(version / 10000));
  // A manifest generated on this server, so the hashes match whatever major the tests run on.
  await writeManifest({ from: FROM, root: ROOT, manifestPath: GEN, log: () => {} });
  manifest = loadManifest(GEN);

  // Pre-release target: everything before the release range, plus a production-like ledger
  // (runbook section 1): Lovable files ledgered under a version 1 s after their timestamp with the
  // file stem as name, the known_unledgered files without rows, the two rows whose files were
  // removed, and a drizzle ledger holding every journal file plus the one row that has no file.
  scratch.createDb(PRE);
  created.add(PRE);
  scratch.loadStub(PRE, ROOT);
  const history = migrationOrder(ROOT).filter((m) => m.version < FROM);
  for (const m of history) scratch.applyMigration(PRE, join(ROOT, m.path), stripMaintain);
  const unledgered = new Set(manifest.known_unledgered.map((k) => k.path));
  const fileVersions = new Set(history.map((m) => m.version));
  const rows = new Map();
  for (const m of history) {
    if (m.source !== "supabase" || unledgered.has(m.path)) continue;
    let v = m.version;
    if (LOVABLE_NAME.test(m.name)) {
      const skewed = shiftVersion(m.version, 1);
      if (!fileVersions.has(skewed) && !rows.has(skewed)) v = skewed;
    }
    if (!rows.has(v)) rows.set(v, m.name);
  }
  for (const k of manifest.known_ledger_rows_without_file) rows.set(k.version, k.name);
  const drizzleRows = history
    .filter((m) => m.source === "drizzle")
    .map((m) => `(${q(sha256File(join(ROOT, m.path)))}, ${m.when})`)
    .concat(manifest.known_drizzle_rows_without_file.map((k) => `(${q(k.hash)}, ${k.created_at})`));
  scratch.sql(
    PRE,
    `CREATE SCHEMA supabase_migrations;
     CREATE TABLE ${LEDGER} (version text PRIMARY KEY, statements text[], name text);
     INSERT INTO ${LEDGER} (version, name, statements)
     SELECT v, n, ARRAY[]::text[] FROM (VALUES ${[...rows]
       .map(([v, n]) => `(${q(v)}, ${q(n)})`)
       .join(", ")}) x(v, n);
     CREATE SCHEMA IF NOT EXISTS drizzle;
     CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);
     INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ${drizzleRows.join(", ")};`,
  );
  // A pinned hotfix (manifest.pinned_history) is applied with the release ledger template: statements = its file text.
  for (const k of manifest.pinned_history ?? [])
    scratch.sql(
      PRE,
      `UPDATE ${LEDGER} SET statements = ARRAY[${dollar(readFileSync(join(ROOT, k.path), "utf8").replace(/\n$/, ""))}] WHERE version = ${q(k.version)};`,
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
    assert.equal(report.protections.recognized, report.protections.checked);
    assert.equal(report.target.hashes_major, MAJOR);
    // the fixture's Lovable rows are ledgered under skewed versions and matched by name
    const skewed = Number(
      scratch
        .sql(
          PRE,
          `SELECT count(*) FROM ${LEDGER} WHERE name ~ '^[0-9]{14}_[0-9a-f]{8}-' AND left(name, 14) <> version`,
        )
        .trim(),
    );
    assert.ok(skewed > 200, `only ${skewed} skewed rows`);
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
    const { code, report } = preflight(null, ["--offline"], {
      manifestPath: join(ROOT, DEFAULT_MANIFEST),
    });
    assert.equal(code, 0, report.errors?.join("\n"));
  });

  test("checked-in manifest equals a regeneration on this server (hashes compared only for this major)", () => {
    const strip = (m) => {
      const c = structuredClone(m);
      delete c.generated.majors;
      for (const p of allProt(c)) {
        delete p.expect_before;
        delete p.expect_steps;
        delete p.expect_after;
      }
      return c;
    };
    assert.deepEqual(strip(checkedIn), strip(manifest), "regenerate the checked-in manifest");
    if (!(MAJOR in checkedIn.generated.majors)) return; // e.g. CI on 17 before PG17 hashes are merged
    allProt(manifest).forEach((p, i) => {
      const c = allProt(checkedIn)[i];
      for (const k of ["expect_before", "expect_steps", "expect_after"])
        assert.deepEqual(
          c[k][MAJOR],
          p[k][MAJOR],
          `${k} of ${p.signature ?? p.policy ?? p.table ?? p.bucket}`,
        );
    });
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

describe("pinned history: a hotfix dated before the range (independent pre-review 2026-11-05)", () => {
  const PIN = "20261031120000";
  const pinned = () => manifest.pinned_history.find((k) => k.version === PIN);

  test("the manifest pins the hotfix with the sha256 of its file", () => {
    assert.ok(pinned(), "20261031120000 is in pinned_history");
    assert.equal(pinned().sha256, sha256File(join(ROOT, pinned().path)));
  });

  test("an edited hotfix file fails offline", () => {
    const dir = tempRoot();
    const path = join(dir, pinned().path);
    writeFileSync(
      path,
      `${readFileSync(path, "utf8")}\nDROP TRIGGER IF EXISTS a00_payment_refund_fields_locked ON public.payment_submissions;\n`,
    );
    const { code, text } = preflight(null, ["--offline"], { root: dir });
    assert.equal(code, 1);
    assert.match(text, /pinned_history .*20261031120000.*sha256 differs/);
  });

  test("a deleted hotfix file fails offline", () => {
    const dir = tempRoot();
    rmSync(join(dir, pinned().path));
    const { code, text } = preflight(null, ["--offline"], { root: dir });
    assert.equal(code, 1);
    assert.match(text, /pinned_history .*20261031120000.*no such migration file/);
  });

  test("a new migration dated between the reviewed history and the range fails offline", () => {
    const dir = tempRoot();
    writeFileSync(join(dir, "supabase/migrations/20261101000000_backdated.sql"), "SELECT 1;\n");
    const { code, text } = preflight(null, ["--offline"], { root: dir });
    assert.equal(code, 1);
    assert.match(text, /unpinned history: supabase\/migrations\/20261101000000_backdated\.sql/);
  });

  test("a target that applied another text under the hotfix's version fails", () => {
    const db = newDb(PRE);
    scratch.sql(
      db,
      `UPDATE ${LEDGER} SET statements = ARRAY['-- an older version of the hotfix'] WHERE version = ${q(PIN)};`,
    );
    const { code, text } = preflight(db);
    assert.equal(code, 1);
    assert.match(
      text,
      /ledger row 20261031120000 .*a different text was applied under this version/,
    );
  });

  test("a target whose hotfix row records no text fails (not applied with the release template)", () => {
    const db = newDb(PRE);
    scratch.sql(db, `UPDATE ${LEDGER} SET statements = ARRAY[]::text[] WHERE version = ${q(PIN)};`);
    const { code, text } = preflight(db);
    assert.equal(code, 1);
    assert.match(text, /ledger row 20261031120000 .*statements is empty/);
  });

  // Applied through Lovable's migration tool instead: no ledger row, a drizzle row with the sha256 of the text it ran.
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const lovableApplied = (hash) => {
    const db = newDb(PRE);
    scratch.sql(
      db,
      `DELETE FROM ${LEDGER} WHERE version = ${q(PIN)};
       INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${q(hash)}, 1793900000000);`,
    );
    return db;
  };

  test("a hotfix applied through Lovable is recognized by the drizzle hash of its exact text", () => {
    const { code, report } = preflight(lovableApplied(pinned().sha256));
    assert.equal(code, 0, report.errors?.join("\n"));
    assert.ok(
      report.warnings.some((w) => w.includes(`pinned history ${PIN}: recognized by its drizzle`)),
      report.warnings.join("\n"),
    );
  });

  test("also when the pasted text lost the file's trailing newline", () => {
    const bytes = readFileSync(join(ROOT, pinned().path));
    assert.equal(bytes[bytes.length - 1], 0x0a);
    const { code, report } = preflight(lovableApplied(sha256(bytes.subarray(0, -1))));
    assert.equal(code, 0, report.errors?.join("\n"));
  });

  test("a drizzle row for any other text is unknown, and the hotfix counts as unapplied", () => {
    const edited = `${readFileSync(join(ROOT, pinned().path), "utf8")}-- edited\n`;
    const { code, text } = preflight(lovableApplied(sha256(edited)));
    assert.equal(code, 1);
    assert.match(text, /unknown drizzle\.__drizzle_migrations row/);
    assert.match(
      text,
      /unrecognized history: supabase\/migrations\/20261031120000_close_live_write_holes\.sql/,
    );
  });

  // Lovable's tool may also write the hotfix it applied into drizzle/migrations, dated when it applied it: inside the
  // release range's span (PR #287: 0032_hotfix_close_write_paths, 2026-11-05 17:14:51 UTC). That copy is the same
  // migration, so it is left out of the replay order and is never a release migration.
  const LOVABLE_WHEN = Date.UTC(2026, 10, 5, 17, 14, 51);
  const addDrizzleFile = (dir, tag, body) => {
    writeFileSync(join(dir, "drizzle/migrations", `${tag}.sql`), body);
    const journalPath = join(dir, "drizzle/migrations/meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    journal.entries.push({
      idx: journal.entries.length,
      version: "7",
      when: LOVABLE_WHEN,
      tag,
      breakpoints: true,
    });
    writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  };

  test("Lovable's drizzle copy of the hotfix is the same migration: not replayed again, not a release migration", () => {
    const dir = tempRoot();
    const bytes = readFileSync(join(ROOT, pinned().path));
    addDrizzleFile(dir, "0099_hotfix_copy", bytes.subarray(0, -1)); // as Lovable wrote it: no final newline
    assert.ok(!migrationOrder(dir).some((m) => m.path.endsWith("0099_hotfix_copy.sql")));
    const { code, text } = preflight(null, ["--offline"], { root: dir });
    assert.equal(code, 0, text);
  });

  test("a drizzle file that differs from the hotfix in anything else is replayed and must be in the manifest", () => {
    const dir = tempRoot();
    addDrizzleFile(
      dir,
      "0099_edited_copy",
      `${readFileSync(join(ROOT, pinned().path), "utf8")}-- edited\n`,
    );
    assert.ok(migrationOrder(dir).some((m) => m.path.endsWith("0099_edited_copy.sql")));
    const { code, text } = preflight(null, ["--offline"], { root: dir });
    assert.equal(code, 1);
    assert.match(
      text,
      /unlisted migration in the release range: drizzle\/migrations\/0099_edited_copy\.sql/,
    );
  });

  test("Lovable's copies of other migrations are still replayed at their drizzle date (they were applied then)", () => {
    const order = migrationOrder(ROOT).map((m) => m.path);
    assert.ok(
      order.includes("drizzle/migrations/0021_freeze_payment_claim_metadata_on_dispute.sql"),
    );
    assert.ok(
      order.includes(
        "supabase/migrations/20260915214000_freeze_payment_claim_metadata_on_dispute.sql",
      ),
    );
  });

  test("with neither a ledger row nor a drizzle row, the hotfix counts as unapplied", () => {
    const db = newDb(PRE);
    scratch.sql(db, `DELETE FROM ${LEDGER} WHERE version = ${q(PIN)};`);
    const { code, text } = preflight(db);
    assert.equal(code, 1);
    assert.match(
      text,
      /unrecognized history: supabase\/migrations\/20261031120000_close_live_write_holes\.sql/,
    );
  });
});

describe("scratch helpers: the same protections as db-test (independent review of d604958c)", () => {
  test("they write to and drop only databases a harness created (scratch marker)", () => {
    const foreign = `rpf_${process.pid}_unmarked`;
    scratch.withUnmarkedDatabase(foreign, () => {
      assert.throws(() => scratch.sql(foreign, "SELECT 1"), /not a scratch database/);
      assert.throws(() => scratch.loadStub(foreign, ROOT), /not a scratch database/);
      assert.throws(() => scratch.dropDb(foreign), /Refusing to drop/);
      assert.throws(
        () => scratch.createDb(`rpf_${process.pid}_from_foreign`, foreign),
        /not a scratch database/,
      );
    });
    const left = scratch
      .psqlLocal("postgres", [
        "-At",
        "-c",
        `SELECT count(*) FROM pg_database WHERE datname = '${foreign}'`,
      ])
      .stdout.trim();
    assert.equal(left, "0", "the self-test's unmarked database is dropped again");
  });

  // independent review of 7155a4fe: the exported psql was a write path with no attestation, and -d honours a
  // connection string
  test("the exported psql reads only, and takes only a plain database name", () => {
    const r = scratch.psqlLocal("postgres", [
      "-c",
      `CREATE DATABASE "rpf_${process.pid}_via_read_psql"`,
    ]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /read-only transaction/);
    const r2 = scratch.psqlLocal("postgres", ["-c", "CREATE TABLE public.rpf_scribble (x int)"]);
    assert.notEqual(r2.status, 0);
    assert.match(r2.stderr, /read-only transaction/);
    for (const bad of [
      "host=db.example.com dbname=prod",
      "postgresql://u@db.example.com/prod",
      "Prod",
      "",
    ])
      assert.throws(() => scratch.psqlLocal(bad, ["-c", "SELECT 1"]), /plain identifier/);
    assert.throws(
      () => scratch.withUnmarkedDatabase("not_a_self_test_name", () => {}),
      /self-test/,
    );
  });

  test("a database they create carries the marker, so db-test's guard recognizes it", () => {
    const db = newDb();
    const comment = scratch
      .psqlLocal("postgres", [
        "-At",
        "-c",
        `SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = '${db}'`,
      ])
      .stdout.trim();
    assert.equal(comment, "ballacity db-test scratch database (safe to drop)");
  });

  test("they refuse the reserved databases", () => {
    for (const name of ["postgres", "template0", "template1"])
      assert.throws(() => scratch.createDb(name), /bad scratch database name/);
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
      /unrecognized state: protection private_sec\.game_payee\(text\) is md5 .* must be expect_after .*drifted or was regressed/,
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

describe("fail closed: Postgres major and manifest hashes (rule a)", () => {
  const OTHER = () => (MAJOR === "16" ? "17" : "16");
  /** A copy of GEN whose hashes are labelled as another major (as if generated there). */
  function relabelled(dir) {
    const path = join(dir, "other-major.json");
    const m = structuredClone(manifest);
    const move = (o) => ({ [OTHER()]: o[MAJOR] });
    m.generated.majors = { [OTHER()]: { server_version_num: Number(OTHER()) * 10000 } };
    for (const p of allProt(m)) {
      p.expect_before = move(p.expect_before);
      p.expect_steps = move(p.expect_steps);
      p.expect_after = move(p.expect_after);
    }
    writeFileSync(path, JSON.stringify(m, null, 2));
    return path;
  }

  test("hashes only for another major: --verify-after FAILS and so does the default run", () => {
    const dir = mkdtempSync(join(tmpdir(), "release-preflight-major-"));
    tempDirs.push(dir);
    const path = relabelled(dir);
    const after = preflight(FULL, ["--verify-after"], { manifestPath: path });
    assert.equal(after.code, 1);
    assert.match(
      after.text,
      new RegExp(
        `--verify-after: the manifest's hashes were generated on Postgres ${OTHER()}, the target runs ${MAJOR}`,
      ),
    );
    const plain = preflight(PRE, [], { manifestPath: path });
    assert.equal(plain.code, 1);
    assert.match(plain.text, /protections: the manifest's hashes were generated on Postgres/);
    assert.match(plain.text, /state is unrecognized/);
  });

  test("--merge-hashes builds a two-major manifest that passes on this major", () => {
    const dir = mkdtempSync(join(tmpdir(), "release-preflight-merge-"));
    tempDirs.push(dir);
    const base = join(dir, "base.json");
    cpSync(GEN, base);
    const other = relabelled(dir);
    const r = spawnSync(process.execPath, [TOOL, "--merge-hashes", other, "--manifest", base], {
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    const merged = loadManifest(base);
    assert.deepEqual(Object.keys(merged.generated.majors).sort(), ["16", "17"]);
    assert.ok(
      merged.protections.functions.every((p) => "16" in p.expect_after && "17" in p.expect_after),
    );
    assert.equal(preflight(FULL, ["--verify-after"], { manifestPath: base }).code, 0);
    assert.equal(preflight(PRE, [], { manifestPath: base }).code, 0);
    assert.equal(preflight(null, ["--offline"], { manifestPath: base }).code, 0);
  });

  test("--merge-hashes refuses manifests that differ in more than their hashes", () => {
    const dir = mkdtempSync(join(tmpdir(), "release-preflight-merge-"));
    tempDirs.push(dir);
    const base = join(dir, "base.json");
    cpSync(GEN, base);
    const other = relabelled(dir);
    const m = loadManifest(other);
    m.migrations[3].sha256 = "0".repeat(64);
    writeFileSync(other, JSON.stringify(m));
    const r = spawnSync(process.execPath, [TOOL, "--merge-hashes", other, "--manifest", base], {
      encoding: "utf8",
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /differ in more than their hashes/);
    assert.equal(readFileSync(base, "utf8"), readFileSync(GEN, "utf8"));
  });

  test("a format-1 manifest (single-major expect_after) is refused offline", () => {
    const dir = tempRoot();
    editManifest(dir, (m) => {
      m.format = 1;
      delete m.generated.majors;
    });
    const { code, text } = preflight(null, ["--offline"], { root: dir });
    assert.equal(code, 1);
    assert.match(text, /format must be 2/);
    assert.match(text, /generated\.majors is empty/);
  });
});

describe("fail closed: recognized protection states (rule b)", () => {
  const fnProtection = (pred) => manifest.protections.functions.find(pred);
  const captures = () => new Set(manifest.drift_captures.map((c) => c.version));

  test("pending objects that differ from expect_before fail, naming the object", () => {
    const p = fnProtection(
      (x) =>
        x.signature.startsWith("public.") &&
        x.expect_before[MAJOR] !== null &&
        !x.defined_by.some((v) => captures().has(v)),
    );
    const db = newDb(PRE);
    scratch.sql(db, `ALTER FUNCTION ${p.signature} SET work_mem = '64kB';`);
    const { code, text } = preflight(db);
    assert.equal(code, 1);
    assert.match(
      text,
      new RegExp(
        `unrecognized state: protection ${p.signature.replace(/[()[\].]/g, "\\$&")} is md5 .* must be expect_before`,
      ),
    );
  });

  test("an object a pending migration creates must be absent", () => {
    const p = fnProtection(
      (x) =>
        x.signature.startsWith("public.") &&
        x.expect_before[MAJOR] === null &&
        /\(\w*\)$/.test(x.signature),
    );
    const db = newDb(PRE);
    scratch.sql(db, `CREATE FUNCTION ${p.signature} RETURNS integer LANGUAGE sql AS 'SELECT 1';`);
    const { code, text } = preflight(db);
    assert.equal(code, 1);
    assert.match(text, /must be absent \(a pending migration creates it\)/);
    assert.ok(text.includes(p.signature));
  });

  test("a pending policy that differs from expect_before fails", () => {
    const p = manifest.protections.policies.find((x) => x.expect_before[MAJOR]?.qual);
    const db = newDb(PRE);
    scratch.sql(
      db,
      `ALTER POLICY "${p.policy.replaceAll('"', '""')}" ON ${p.schema}.${p.table} USING (true);`,
    );
    const { code, text } = preflight(db);
    assert.equal(code, 1);
    assert.ok(
      text.includes(`unrecognized state: protection policy ${p.policy} on ${p.schema}.${p.table}`),
      text,
    );
  });

  test("a drift capture's hand fix already in the target is recognized; any other early definition is not", () => {
    const db = newDb(PRE);
    // production already holds enforce_gym_review's hand fix that 20261103101000 writes down (runbook 1a)
    scratch.applyMigration(db, join(ROOT, byVersion("20261103101000").path), stripMaintain);
    const ok = preflight(db);
    assert.equal(ok.code, 0, ok.text);
    // a later, non-capture release definition applied by hand without its ledger row is drift
    const db2 = newDb(PRE);
    const k = manifest.migrations.findIndex((e) => e.version === "20261103140000");
    applyEntries(db2, manifest.migrations.slice(0, k));
    scratch.applyMigration(db2, join(ROOT, byVersion("20261103140000").path), stripMaintain);
    const bad = preflight(db2);
    assert.equal(bad.code, 1);
    assert.match(
      bad.text,
      /unrecognized state: protection private_sec\.game_payee\(text\) is md5 .* must be absent/,
    );
  });

  test("partially applied definers: the target must equal the snapshot after the last applied one", () => {
    const db = newDb(PRE);
    const k = manifest.migrations.findIndex((e) => e.version === "20261103140000") + 1;
    applyEntries(db, manifest.migrations.slice(0, k));
    const ok = preflight(db);
    assert.equal(ok.code, 0, ok.text);
    const gp = ok.report.protections;
    assert.equal(gp.recognized, gp.checked);
    scratch.sql(db, `ALTER FUNCTION private_sec.game_payee(text) SET work_mem = '64kB';`);
    const bad = preflight(db);
    assert.equal(bad.code, 1);
    assert.match(
      bad.text,
      /unrecognized state: protection private_sec\.game_payee\(text\) .* the snapshot after 20261103140000, the last applied of its defining migrations 20261103140000, 20261104120000/,
    );
  });
});

describe("fail closed: unknown and unledgered history (rule c)", () => {
  test("an unknown ledger row BEFORE the release range fails", () => {
    const db = newDb(PRE);
    scratch.sql(
      db,
      `INSERT INTO ${LEDGER} (version, name) VALUES ('20260801000000', 'mystery_hand_fix')`,
    );
    const { code, text } = preflight(db);
    assert.equal(code, 1);
    assert.match(text, /unknown ledger row 20260801000000 \(name "mystery_hand_fix"\)/);
  });

  test("a Lovable-style name only counts within the timestamp skew", () => {
    const f = migrationOrder(ROOT).find((m) => m.version < FROM && LOVABLE_NAME.test(m.name));
    const db = newDb(PRE);
    const far = shiftVersion(f.version, 3600);
    scratch.sql(db, `INSERT INTO ${LEDGER} (version, name) VALUES ('${far}', '${f.name}')`);
    const { code, text } = preflight(db);
    assert.equal(code, 1);
    assert.match(text, new RegExp(`unknown ledger row ${far}`));
  });

  test("R5 review F5: a release-range file's name cannot recognize a row just before the range", () => {
    const f = migrationOrder(ROOT).find((m) => m.version >= FROM && m.source === "supabase");
    const db = newDb(PRE);
    const before = shiftVersion(f.version, -2);
    scratch.sql(db, `INSERT INTO ${LEDGER} (version, name) VALUES ('${before}', '${f.name}')`);
    const { code, text } = preflight(db);
    assert.equal(code, 1);
    assert.match(text, new RegExp(`unknown ledger row ${before}`));
  });

  test("R5 review F5: a Lovable-style name counts only AFTER the file's timestamp", () => {
    const f = migrationOrder(ROOT).find((m) => m.version < FROM && LOVABLE_NAME.test(m.name));
    const db = newDb(PRE);
    const early = shiftVersion(f.version, -2);
    scratch.sql(db, `INSERT INTO ${LEDGER} (version, name) VALUES ('${early}', '${f.name}')`);
    const { code, text } = preflight(db);
    assert.equal(code, 1);
    assert.match(text, new RegExp(`unknown ledger row ${early}`));
  });

  test("a historical file without a ledger row that known_unledgered does not list fails", () => {
    const db = newDb(PRE);
    scratch.sql(db, `DELETE FROM ${LEDGER} WHERE version = '20260926155719'`);
    const { code, text } = preflight(db);
    assert.equal(code, 1);
    assert.match(
      text,
      /unrecognized history: supabase\/migrations\/20260926155719_monetization_surfaces_ship_off\.sql/,
    );
  });

  test("removing a file from known_unledgered makes its missing ledger row fail", () => {
    const dir = tempRoot();
    const path = "supabase/migrations/20260930120000_managed_children.sql";
    editManifest(dir, (m) => {
      m.known_unledgered = m.known_unledgered.filter((k) => k.path !== path);
    });
    const { code, text } = preflight(PRE, [], { root: dir });
    assert.equal(code, 1);
    assert.ok(text.includes(`unrecognized history: ${path}`), text);
  });

  test("known_unledgered covers reviewed bytes only: a changed sha256 fails offline", () => {
    const dir = tempRoot();
    editManifest(dir, (m) => {
      m.known_unledgered[0].sha256 = "0".repeat(64);
    });
    const { code, text } = preflight(null, ["--offline"], { root: dir });
    assert.equal(code, 1);
    assert.match(text, /known_unledgered .*sha256 differs/);
  });

  test("an unknown drizzle ledger row fails", () => {
    const db = newDb(PRE);
    scratch.sql(
      db,
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('${"ab".repeat(32)}', 1799999999999)`,
    );
    const { code, text } = preflight(db);
    assert.equal(code, 1);
    assert.match(text, /unknown drizzle\.__drizzle_migrations row \(created_at 1799999999999/);
  });

  test("a missing drizzle ledger fails: the journal's files are unrecognized history", () => {
    const db = newDb(PRE);
    scratch.sql(db, "DROP SCHEMA drizzle CASCADE");
    const { code, text } = preflight(db);
    assert.equal(code, 1);
    assert.match(
      text,
      /unrecognized history: drizzle\/migrations\/0000_managed_children\.sql \(drizzle\) is in the journal but the target has no/,
    );
  });
});

describe("fail closed: server and ledger schema (rule d)", () => {
  test("a missing supabase_migrations schema fails", () => {
    const db = newDb(PRE);
    scratch.sql(db, "DROP SCHEMA supabase_migrations CASCADE");
    const { code, text } = preflight(db);
    assert.equal(code, 1);
    assert.match(text, /schema supabase_migrations does not exist in the target/);
  });

  test("a Postgres major other than 16 or 17 fails (pure evaluation, no database)", () => {
    for (const v of [150008, 180001]) {
      const ev = evaluate(manifest, {
        server_version_num: v,
        ledger_schema: true,
        ledger: true,
        ledger_all: [],
        drizzle_rows: [],
      });
      assert.ok(
        ev.errors.some((e) => e.startsWith(`unsupported Postgres major ${Math.floor(v / 10000)}`)),
        ev.errors.join("\n"),
      );
      assert.ok(ev.errors.some((e) => /hashes were generated on Postgres/.test(e)));
    }
  });
});

describe("detection: duplicated migrations", () => {
  test("duplicate path in the manifest", () => {
    const dir = tempRoot();
    editManifest(dir, (m) => {
      const i = m.migrations.findIndex((e) => e.version === "20261104130000");
      m.migrations.splice(i + 1, 0, { ...m.migrations[i], version: "20261104130001" });
    });
    const { code, text } = preflight(null, ["--offline"], { root: dir });
    assert.equal(code, 1);
    assert.match(text, /duplicate path/);
  });

  test("a second file with an existing release version (duplicate ledger key)", () => {
    const dir = tempRoot();
    writeFileSync(join(dir, "supabase/migrations/20261104130000_second_copy.sql"), "SELECT 1;\n");
    const { code, text } = preflight(null, ["--offline"], { root: dir });
    assert.equal(code, 1);
    assert.match(text, /unlisted migration .*20261104130000_second_copy\.sql/);
  });
});

test("guard requirements: only complete literal arguments count (dynamic names are not requirements)", () => {
  const r = guardRequirements(`DO $g$ BEGIN
    IF to_regprocedure('private_sec.game_payee(text)') IS NULL THEN RAISE EXCEPTION 'x'; END IF;
    _pub := to_regprocedure('public.' || _sig);
    IF to_regclass( 'public.teams' ) IS NULL THEN RAISE EXCEPTION 'y'; END IF;
  END $g$;`);
  assert.deepEqual(r.functions, ["private_sec.game_payee(text)"]);
  assert.deepEqual(r.tables, ["public.teams"]);
});

test("policy names with apostrophes are quoted, not refused; unsafe characters still are", async () => {
  const { sqlLiteral } = await import("./release-preflight.mjs");
  assert.equal(
    sqlLiteral("Guardians view their children's join requests"),
    "'Guardians view their children''s join requests'",
  );
  assert.equal(sqlLiteral("x'; drop table y"), "'x''; drop table y'");
  assert.throws(() => sqlLiteral("a\nb"), /unsafe/);
  assert.throws(() => sqlLiteral("a\\b"), /unsafe/);
});

describe("fail closed: grants, RLS, triggers, extra policies and buckets (independent review)", () => {
  // The reviewer's tampering, on the objects of this release: an internal function granted to the API roles,
  // RLS disabled plus write grants on a release table, an extra open policy, a private bucket made public,
  // and a release trigger dropped. None of these changes a function definition or an existing policy.
  const TAMPER = `
    GRANT EXECUTE ON FUNCTION private_sec.apply_content_hold() TO anon, authenticated;
    ALTER TABLE public.minor_hosting_approvals DISABLE ROW LEVEL SECURITY;
    GRANT INSERT, UPDATE, DELETE ON public.minor_hosting_approvals TO anon, authenticated;
    CREATE POLICY rvpre_open ON public.hosted_game_private FOR ALL USING (true);
    UPDATE storage.buckets SET public = true WHERE id = 'image-staging';
    DROP TRIGGER a1_sync_hosted_game_private_trg ON public.hosted_games;`;
  const NAMED = [
    [
      /protection private_sec\.apply_content_hold\(\) .*acl unexpected \[anon:EXECUTE authenticated:EXECUTE\]/,
      "function ACL",
    ],
    [/protection table public\.minor_hosting_approvals .*rls false \(expected true\)/, "RLS"],
    [
      /protection table public\.minor_hosting_approvals .*acl unexpected \[anon:DELETE anon:INSERT anon:UPDATE authenticated:DELETE authenticated:INSERT authenticated:UPDATE\]/,
      "table ACL",
    ],
    [
      /protection table public\.hosted_game_private .*policies unexpected \[rvpre_open\]/,
      "extra policy",
    ],
    [/protection storage bucket image-staging .*public true \(expected false\)/, "bucket"],
    [
      /protection table public\.hosted_games .*triggers missing \[a1_sync_hosted_game_private_trg\|public\.sync_hosted_game_private\(\)\|23\|O\]/,
      "trigger",
    ],
  ];

  test("the manifest protects these objects", () => {
    const tables = new Set(manifest.protections.tables.map((t) => `${t.schema}.${t.table}`));
    for (const t of [
      "public.minor_hosting_approvals",
      "public.hosted_game_private",
      "public.hosted_games",
    ])
      assert.ok(tables.has(t), t);
    assert.ok(manifest.protections.buckets.some((b) => b.bucket === "image-staging"));
    assert.ok(
      manifest.protections.functions.some(
        (f) => f.signature === "private_sec.apply_content_hold()",
      ),
    );
    // every table of a protected policy is protected too (its full policy set)
    for (const p of manifest.protections.policies) assert.ok(tables.has(`${p.schema}.${p.table}`));
  });

  test("the reviewer's tampering on a released copy fails --verify-after and the default run, naming each object", () => {
    const db = newDb(FULL);
    scratch.sql(db, TAMPER);
    for (const args of [["--verify-after"], []]) {
      const { code, text } = preflight(db, args);
      assert.equal(code, 1, `${args.join(" ") || "default run"} passed a tampered database`);
      for (const [re, what] of NAMED)
        assert.match(text, re, `${what} (${args.join(" ") || "default"})`);
    }
  });

  test("each tampering alone fails --verify-after", () => {
    const stmts = TAMPER.split(";")
      .map((x) => x.trim())
      .filter(Boolean);
    const pairs = [
      [stmts[0], NAMED[0][0]],
      [stmts[1], NAMED[1][0]],
      [stmts[2], NAMED[2][0]],
      [stmts[3], NAMED[3][0]],
      [stmts[4], NAMED[4][0]],
      [stmts[5], NAMED[5][0]],
      [
        "ALTER FUNCTION private_sec.apply_content_hold() OWNER TO service_role",
        /protection private_sec\.apply_content_hold\(\) .*owner service_role \(expected postgres\)/,
      ],
      [
        "ALTER TABLE public.hosted_games DISABLE TRIGGER a1_sync_hosted_game_private_trg",
        /protection table public\.hosted_games .*triggers unexpected \[a1_sync_hosted_game_private_trg\|public\.sync_hosted_game_private\(\)\|23\|D\]/,
      ],
    ];
    for (const [stmt, re] of pairs) {
      const tmp = newDb(FULL);
      scratch.sql(tmp, `${stmt};`);
      const { code, text } = preflight(tmp, ["--verify-after"]);
      assert.equal(code, 1, stmt);
      assert.match(text, re, stmt);
      scratch.dropDb(tmp);
      created.delete(tmp);
    }
  });

  test("a pre-release target with an extra policy on a protected table fails the default run", () => {
    const db = newDb(PRE);
    scratch.sql(db, "CREATE POLICY rvpre_open ON public.reviews FOR SELECT USING (true);");
    const { code, text } = preflight(db);
    assert.equal(code, 1);
    assert.match(
      text,
      /unrecognized state: protection table public\.reviews .*policies unexpected \[rvpre_open\]/,
    );
  });

  test("textual table touches: CREATE/ALTER TABLE, triggers, policies and grants", () => {
    const d = definitionsIn(`CREATE TABLE IF NOT EXISTS public.a (x int);
      ALTER TABLE ONLY b ENABLE ROW LEVEL SECURITY;
      CREATE TRIGGER t BEFORE UPDATE OF x, y ON private_sec.c FOR EACH ROW EXECUTE FUNCTION f();
      GRANT SELECT ON TABLE public.d, e TO anon; GRANT USAGE ON SCHEMA s TO anon;
      REVOKE ALL ON FUNCTION private_sec.g(uuid, text) FROM PUBLIC;
      DROP POLICY IF EXISTS "p" ON storage.objects;`);
    assert.deepEqual([...d.tables].sort(), [
      "private_sec.c",
      "public.a",
      "public.b",
      "public.d",
      "public.e",
      "storage.objects",
    ]);
    assert.ok(d.functions.has("private_sec.g"));
  });
});

describe("ledger rows in the release range: name and content (independent review)", () => {
  const k = () => manifest.migrations.findIndex((e) => e.version === "20261103140000") + 1;

  test("rows written byte for byte, or with the trailing newline psql drops, both pass", () => {
    const db = newDb(PRE);
    const list = manifest.migrations.slice(0, k());
    list.forEach((e, i) => ledgerRow(db, e, { exact: i % 2 === 0 }));
    for (const e of list) scratch.applyMigration(db, join(ROOT, e.path), stripMaintain);
    const r = preflight(db);
    assert.equal(r.code, 0, r.text);
  });

  test("the Lovable stem rule: a name without the version prefix (or with .sql) is accepted", () => {
    const db = newDb(PRE);
    const [first, second] = manifest.migrations;
    for (const e of [first, second]) scratch.applyMigration(db, join(ROOT, e.path), stripMaintain);
    ledgerRow(db, first, { name: stemOf(first).slice(15) });
    ledgerRow(db, second, { name: `${stemOf(second)}.sql` });
    const r = preflight(db);
    assert.equal(r.code, 0, r.text);
  });

  function withRow(opts) {
    const db = newDb(PRE);
    const list = manifest.migrations.slice(0, k());
    for (const e of list) scratch.applyMigration(db, join(ROOT, e.path), stripMaintain);
    list.forEach((e, i) => ledgerRow(db, e, i === list.length - 1 ? opts : {}));
    return preflight(db);
  }

  test("a wrong name fails", () => {
    const { code, text } = withRow({ name: "20261103140000_something_else" });
    assert.equal(code, 1);
    assert.match(
      text,
      /ledger row 20261103140000: name "20261103140000_something_else" is not the file stem 20261103140000_payment_settings_host_guard/,
    );
  });

  test("a missing name fails", () => {
    const { code, text } = withRow({ name: null });
    assert.equal(code, 1);
    assert.match(text, /ledger row 20261103140000: name null is not the file stem/);
  });

  test("empty or NULL statements fail", () => {
    for (const statements of ["ARRAY[]::text[]", "NULL"]) {
      const { code, text } = withRow({ statements });
      assert.equal(code, 1, statements);
      assert.match(text, /ledger row 20261103140000 .*statements is empty/);
    }
  });

  test("statements holding a different text fails", () => {
    const { code, text } = withRow({ statements: `ARRAY[${q("SELECT 1;")}]` });
    assert.equal(code, 1);
    assert.match(
      text,
      /ledger row 20261103140000 .*sha256\(statements\[1\]\) is .* a different text was applied/,
    );
  });
});

describe("scratch databases are local only (independent review)", () => {
  test("a non-loopback PGHOSTADDR is refused; loopback is accepted", () => {
    assert.throws(
      () => scratch.localEnv({ PGHOST: "localhost", PGHOSTADDR: "10.1.2.3" }),
      /Refusing to use PGHOSTADDR=10\.1\.2\.3/,
    );
    assert.throws(() => scratch.localEnv({ PGHOSTADDR: "2001:db8::1" }), /PGHOSTADDR/);
    assert.throws(() => scratch.localEnv({ PGHOST: "localhost,db.example.com" }), /PGHOST=/);
    assert.throws(() => scratch.localEnv({ PGHOST: "db.example.com" }), /PGHOST=/);
    for (const a of ["127.0.0.1", "127.1.2.3", "::1"])
      assert.equal(scratch.localEnv({ PGHOSTADDR: a }).PGHOSTADDR, a);
  });

  test("PGSERVICE and PGSERVICEFILE are refused, as db-test refuses them (independent review of d604958c)", () => {
    assert.throws(() => scratch.localEnv({ PGSERVICE: "prod", PGHOST: "" }), /PGSERVICE/);
    assert.throws(() => scratch.localEnv({ PGSERVICEFILE: "/tmp/pg_service.conf" }), /PGSERVICE/);
  });

  test("--write-manifest refuses a remote PGHOSTADDR before connecting", () => {
    const r = spawnSync(
      process.execPath,
      [TOOL, "--write-manifest", "--from", FROM, "--manifest", join(GEN_DIR, "never.json")],
      {
        encoding: "utf8",
        env: { ...process.env, PGHOSTADDR: "192.0.2.10", PREFLIGHT_DATABASE_URL: "" },
      },
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Refusing to use PGHOSTADDR=192\.0\.2\.10/);
  });
});
