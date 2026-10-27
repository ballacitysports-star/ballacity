#!/usr/bin/env node
// Replays every migration into a scratch Postgres database and runs the SQL
// tests in supabase/tests against it.
//
//   node scripts/db-test.mjs                run everything
//   node scripts/db-test.mjs --replay-only  just prove the migrations apply
//   node scripts/db-test.mjs --only reel    run test files whose name contains "reel"
//   node scripts/db-test.mjs --keep         keep the scratch database afterwards
//   node scripts/db-test.mjs --reuse        reuse a database left by --keep (skips the replay)
//
// Needs `psql` on the PATH and a SUPERUSER connection from the usual libpq
// settings (PGHOST, PGPORT, PGUSER, PGPASSWORD). It creates and drops its own
// database, so it never touches anything else on that server.
//
// Why two migration folders: supabase/migrations holds ours, drizzle/migrations
// holds the ones Lovable writes and applies itself. The live schema is both
// together, so they are replayed together in timestamp order (a drizzle entry's
// time is `when` in its journal; at the same instant ours goes first).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const dbName = option("--db") ?? "ballacity_dbtest";
const only = option("--only");

function psql(database, extraArgs, input) {
  return spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", database, ...extraArgs], {
    input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PGOPTIONS: "-c search_path=public,extensions" },
  });
}

// Set once the scratch database exists; drops it unless --keep or --reuse.
let cleanup = () => {};

function fail(message, detail) {
  console.error(`\n${message}`);
  if (detail) console.error(detail.trim().split("\n").slice(-12).join("\n"));
  cleanup();
  process.exit(1);
}

function migrationOrder() {
  const rows = [];
  for (const file of readdirSync(join(root, "supabase/migrations"))) {
    if (file.endsWith(".sql")) {
      rows.push({
        key: `${file.slice(0, 14)}a${file}`,
        path: join(root, "supabase/migrations", file),
        name: file,
      });
    }
  }
  const journal = JSON.parse(
    readFileSync(join(root, "drizzle/migrations/meta/_journal.json"), "utf8"),
  );
  for (const entry of journal.entries) {
    const stamp = new Date(entry.when).toISOString().replace(/\D/g, "").slice(0, 14);
    rows.push({
      key: `${stamp}b${entry.tag}`,
      path: join(root, "drizzle/migrations", `${entry.tag}.sql`),
      name: `${entry.tag}.sql`,
    });
  }
  return rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// -- scratch database -------------------------------------------------------
let r = psql("postgres", ["-At", "-c", "SHOW server_version_num"]);
if (r.status !== 0)
  fail("Cannot connect to Postgres with psql (check PGHOST/PGUSER/PGPASSWORD).", r.stderr);
const serverVersion = Number(r.stdout.trim());
// Supabase runs Postgres 17, which has a MAINTAIN table privilege that 16 lacks.
const stripMaintain = serverVersion < 170000;

const reuse =
  flag("--reuse") &&
  psql("postgres", [
    "-At",
    "-c",
    `SELECT 1 FROM pg_database WHERE datname = '${dbName}'`,
  ]).stdout.trim() === "1";
cleanup = () => {
  if (!flag("--keep") && !reuse) psql("postgres", ["-c", `DROP DATABASE IF EXISTS "${dbName}"`]);
};
if (!reuse) {
  r = psql("postgres", ["-c", `DROP DATABASE IF EXISTS "${dbName}"`]);
  if (r.status !== 0) fail(`Could not drop ${dbName}.`, r.stderr);
  r = psql("postgres", ["-c", `CREATE DATABASE "${dbName}"`]);
  if (r.status !== 0) fail(`Could not create ${dbName}.`, r.stderr);
}

// -- races ------------------------------------------------------------------
// A test file runs in one session, so it cannot show two requests arriving
// together. These open real sessions against committed rows, then remove them.
function session(script) {
  return new Promise((resolve) => {
    const child = spawn("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", dbName], {
      env: { ...process.env, PGOPTIONS: "-c search_path=public,extensions" },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
    child.stdin.end(script);
  });
}
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

const RACE_CLEANUP = `
  DELETE FROM public.hosted_games WHERE id = 'race-last-seat';
  DELETE FROM auth.users WHERE id IN (t.id('racehost'), t.id('racea'), t.id('raceb'));`;

// Two players take the last seat at the same moment. The first holds its
// transaction open after inserting; the second arrives while it does. Without a
// lock on the game, the second counts an empty seat too and both get in.
async function lastSeatRace() {
  psql(dbName, [], RACE_CLEANUP);
  r = psql(
    dbName,
    [],
    `SELECT t.person('racehost', 35), t.person('racea', 25), t.person('raceb', 26);
     INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players)
       VALUES ('race-last-seat', t.id('racehost'), 'basketball', 'Last seat', now() + interval '2 days', 1);
     INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
       VALUES ('race-last-seat', t.id('racehost'), 0, false);`,
  );
  if (r.status !== 0) fail("The race test could not set up its game.", r.stderr);
  const join = (who, hold) =>
    `BEGIN; SELECT t.as_user(t.id('${who}'));
     INSERT INTO public.game_participants (game_id, user_id) VALUES ('race-last-seat', t.id('${who}'));
     ${hold ? "SELECT pg_sleep(3);" : ""} COMMIT;`;
  const first = session(join("racea", true));
  await pause(1000);
  const second = session(join("raceb", false));
  const results = await Promise.all([first, second]);
  const seats = psql(dbName, [
    "-At",
    "-c",
    "SELECT count(*) FROM public.game_participants WHERE game_id = 'race-last-seat'",
  ]).stdout.trim();
  psql(dbName, [], RACE_CLEANUP);
  const lost = results.filter((x) => x.code !== 0);
  return [
    ["two players racing for the last seat leave one on the roster", seats === "1"],
    [
      "and the other is told the roster is full",
      lost.length === 1 && lost[0].out.includes("GAME_FULL"),
    ],
  ];
}

let exitCode = 0;
try {
  if (!reuse) {
    r = psql(dbName, ["-f", join(root, "supabase/tests/support/supabase-stub.sql")]);
    if (r.status !== 0) fail("The Supabase platform stub failed to load.", r.stderr);

    // -- replay -------------------------------------------------------------
    const migrations = migrationOrder();
    const started = Date.now();
    for (const migration of migrations) {
      let sql = readFileSync(migration.path, "utf8");
      if (stripMaintain) sql = sql.replace(/,\s*MAINTAIN\b/gi, "");
      r = psql(dbName, ["-1"], sql);
      if (r.status !== 0) {
        // The same migration committed to both folders applies twice. Most are
        // repeatable and harmless; one that creates a table is not, and the error
        // alone ("already exists") does not say why. Name the other copy.
        const digest = (m) => createHash("sha256").update(readFileSync(m.path)).digest("hex");
        const twin = migrations.find((m) => m !== migration && digest(m) === digest(migration));
        const hint = twin
          ? `\nThis file is identical to ${twin.name}, which is also replayed. Keep one: if Lovable already applied the drizzle copy, remove the supabase/migrations one.`
          : "";
        fail(`Migration failed to apply: ${migration.name}${hint}`, r.stderr);
      }
    }
    console.log(
      `Replayed ${migrations.length} migrations in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
    );
  }

  if (!flag("--replay-only")) {
    psql(dbName, ["-c", "DROP SCHEMA IF EXISTS t CASCADE"]);
    r = psql(dbName, ["-f", join(root, "supabase/tests/support/helpers.sql")]);
    if (r.status !== 0) fail("supabase/tests/support/helpers.sql failed to load.", r.stderr);

    // -- tests --------------------------------------------------------------
    const files = readdirSync(join(root, "supabase/tests"))
      .filter((f) => f.endsWith(".test.sql") && (!only || f.includes(only)))
      .sort();
    const raceSelected = !only || "race".includes(only);
    if (files.length === 0 && !raceSelected) fail("No test files matched.");

    let passed = 0;
    let failed = 0;
    for (const file of files) {
      console.log(`\n${file}`);
      r = psql(dbName, ["-f", join(root, "supabase/tests", file)]);
      const output = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
      let assertions = 0;
      for (const line of output.split("\n")) {
        const m = line.match(/(?:NOTICE|WARNING):\s+(not ok|ok) - (.*)$/);
        if (!m) continue;
        assertions += 1;
        if (m[1] === "ok") {
          passed += 1;
          console.log(`  ok - ${m[2]}`);
        } else {
          failed += 1;
          console.log(`  NOT OK - ${m[2]}`);
        }
      }
      if (r.status !== 0) {
        failed += 1;
        console.log(`  NOT OK - ${file} stopped on an SQL error:`);
        console.log(
          (r.stderr ?? "")
            .trim()
            .split("\n")
            .filter((l) => !/NOTICE:/.test(l))
            .slice(-6)
            .map((l) => `    ${l}`)
            .join("\n"),
        );
      } else if (assertions === 0) {
        failed += 1;
        console.log(`  NOT OK - ${file} ran no assertions`);
      }
    }
    if (raceSelected) {
      console.log("\nraces");
      for (const [name, ok] of await lastSeatRace()) {
        if (ok) passed += 1;
        else failed += 1;
        console.log(`  ${ok ? "ok" : "NOT OK"} - ${name}`);
      }
    }
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) exitCode = 1;
  }
} finally {
  cleanup();
}
process.exit(exitCode);
