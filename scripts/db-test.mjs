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
// Local and disposable only (scripts/db-test-target.mjs): the server must be a
// local socket or loopback host, never a Supabase-managed cluster, and a database
// is dropped or reused only if this script created it. There is no override.
//
// Why two migration folders: supabase/migrations holds ours, drizzle/migrations
// holds the ones Lovable writes and applies itself. The live schema is both
// together, so they are replayed together in timestamp order; see
// scripts/migration-order.mjs, which e2e/local-stack shares.
import { spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dedupeMigrations } from "./migration-twins.mjs";
import { migrationOrder } from "./migration-order.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SCRATCH_MARKER,
  existingDatabaseProblems,
  scrubbedEnv,
  serverProblems,
  targetProblems,
} from "./db-test-target.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const dbName = option("--db") ?? "ballacity_dbtest";
const only = option("--only");

// Refuse before any connection unless the target is a local, plain database name.
{
  const problems = targetProblems(process.env, dbName);
  if (problems.length) {
    console.error("\ndb-test refused: the target is not a verified local, disposable database.");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(2);
  }
}
const psqlEnv = { ...scrubbedEnv(process.env), PGOPTIONS: "-c search_path=public,extensions" };

function psql(database, extraArgs, input) {
  return spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", database, ...extraArgs], {
    input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: psqlEnv,
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

// -- scratch database -------------------------------------------------------
// What the server says about itself: local, or a disposable container behind a loopback port; never Supabase-managed.
// These read-only catalog queries are all a server that is then refused ever receives.
{
  const probe = psql("postgres", [
    "-At",
    "-F",
    "|",
    "-c",
    "SELECT coalesce(host(inet_server_addr()), ''), coalesce((SELECT string_agg(rolname, ',') FROM pg_roles WHERE rolname IN ('supabase_admin', 'authenticator')), ''), (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%')",
  ]);
  if (probe.status !== 0)
    fail("Cannot connect to Postgres with psql (check PGHOST/PGUSER/PGPASSWORD).", probe.stderr);
  const [serverAddr, roles, postgresUserTables] = probe.stdout.trim().split("|");
  const dbList = psql("postgres", [
    "-At",
    "-F",
    "\t",
    "-c",
    "SELECT datname, coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database",
  ]);
  if (dbList.status !== 0) fail("Could not list the server's databases.", dbList.stderr);
  const databases = dbList.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, ...comment] = line.split("\t");
      return { name, comment: comment.join("\t") };
    });
  const problems = serverProblems({
    serverAddr: serverAddr || null,
    managedRoles: roles ? roles.split(",") : [],
    databases,
    postgresUserTables: Number(postgresUserTables) || 0,
  });
  if (problems.length) {
    console.error("\ndb-test refused: the server is not a verified local scratch Postgres.");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(2);
  }
}
// The name is a checked plain identifier, so it is safe to interpolate.
const existing = psql("postgres", [
  "-At",
  "-c",
  `SELECT 1, coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = '${dbName}'`,
]);
if (existing.status !== 0) fail("Could not look up the scratch database.", existing.stderr);
{
  const [found, ...comment] = existing.stdout.trim().split("|");
  const problems = existingDatabaseProblems({ exists: found === "1", comment: comment.join("|") });
  if (problems.length) {
    console.error("\ndb-test refused:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(2);
  }
}
let r = psql("postgres", ["-At", "-c", "SHOW server_version_num"]);
if (r.status !== 0) fail("Could not read the server version.", r.stderr);
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
  r = psql("postgres", ["-c", `COMMENT ON DATABASE "${dbName}" IS '${SCRATCH_MARKER}'`]);
  if (r.status !== 0) fail(`Could not mark ${dbName} as a scratch database.`, r.stderr);
}

// -- races ------------------------------------------------------------------
// A test file runs in one session, so it cannot show two requests arriving
// together. These open real sessions against committed rows, then remove them.
function session(script) {
  return new Promise((resolve) => {
    const child = spawn("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", dbName], {
      env: psqlEnv,
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

// WP 5.5: two invitees accept the last place of a free game at the same moment. Accepting takes the game-row lock before it
// counts the roster and writes the winner's roster row, so the second waits for the first and is told "full": one place
// is given, never two, and the loser's invitation still waits (no request, no error, no deadlock).
const INVITE_RACE_CLEANUP = `
  DELETE FROM public.hosted_games WHERE id = 'race-invite-last';
  DELETE FROM public.notifications WHERE user_id IN (t.id('raceinvhost'), t.id('raceinva'), t.id('raceinvb'));
  DELETE FROM auth.users WHERE id IN (t.id('raceinvhost'), t.id('raceinva'), t.id('raceinvb'));`;

async function inviteLastPlaceRace() {
  psql(dbName, [], INVITE_RACE_CLEANUP);
  r = psql(
    dbName,
    [],
    `SELECT t.person('raceinvhost', 35), t.person('raceinva', 25), t.person('raceinvb', 26);
     INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players)
       VALUES ('race-invite-last', t.id('raceinvhost'), 'basketball', 'Last place', now() + interval '2 days', 1);
     INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
       VALUES ('race-invite-last', t.id('raceinvhost'), 0, true);
     INSERT INTO public.game_invites (id, game_id, host_id, invitee_id) VALUES
       (t.id('race-inv-a'), 'race-invite-last', t.id('raceinvhost'), t.id('raceinva')),
       (t.id('race-inv-b'), 'race-invite-last', t.id('raceinvhost'), t.id('raceinvb'));`,
  );
  if (r.status !== 0) fail("The invitation race could not set up its game.", r.stderr);
  const accept = (who, inv, hold) =>
    `BEGIN; SELECT t.as_user(t.id('${who}'));
     SELECT 'ANSWER:' || (public.game_respond_invite(t.id('${inv}'), true) ->> 'status');
     ${hold ? "SELECT pg_sleep(3);" : ""} COMMIT;`;
  const first = session(accept("raceinva", "race-inv-a", true));
  await pause(1000);
  const second = session(accept("raceinvb", "race-inv-b", false));
  const results = await Promise.all([first, second]);
  const state = psql(dbName, [
    "-At",
    "-c",
    `SELECT (SELECT string_agg(user_id::text, ',') FROM public.game_participants WHERE game_id = 'race-invite-last') || '|' ||
            (SELECT count(*) FROM public.join_requests WHERE game_id = 'race-invite-last') || '|' ||
            (SELECT string_agg(status, ',' ORDER BY id = t.id('race-inv-b')) FROM public.game_invites
              WHERE game_id = 'race-invite-last')`,
  ]);
  const winner = psql(dbName, ["-At", "-c", "SELECT t.id('raceinva')"]).stdout.trim();
  psql(dbName, [], INVITE_RACE_CLEANUP);
  const answers = results.map((x) => (x.out.match(/ANSWER:(\w+)/) ?? [])[1]);
  return [
    [
      "two invitees accepting the last free place: the first is on the roster, the other invitation waits",
      state.status === 0 && state.stdout.trim() === `${winner}|1|accepted,pending`,
    ],
    [
      'and the second is told "full", without an error or a deadlock',
      results.every((x) => x.code === 0) && answers[0] === "accepted" && answers[1] === "full",
    ],
  ];
}

// 20261204110000: two invitees accept the last place of a paid game at the same moment. A paid accept writes no roster
// row, so only the approval holds the place: the second waits for the first on the game-row lock, then counts the
// first one's approval in a fresh snapshot and is told "full". One approval, never two, and the loser's invitation still
// waits (no request, no error, no deadlock).
const PAID_INVITE_RACE_CLEANUP = `
  DELETE FROM public.hosted_games WHERE id = 'race-invite-paid';
  DELETE FROM public.notifications WHERE user_id IN (t.id('racepayhost'), t.id('racepaya'), t.id('racepayb'));
  DELETE FROM auth.users WHERE id IN (t.id('racepayhost'), t.id('racepaya'), t.id('racepayb'));`;

async function paidInviteLastPlaceRace() {
  psql(dbName, [], PAID_INVITE_RACE_CLEANUP);
  r = psql(
    dbName,
    [],
    `SELECT t.person('racepayhost', 35), t.person('racepaya', 25), t.person('racepayb', 26);
     INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players)
       VALUES ('race-invite-paid', t.id('racepayhost'), 'basketball', 'Last paid place', now() + interval '2 days', 1);
     INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
       VALUES ('race-invite-paid', t.id('racepayhost'), 10, true);
     INSERT INTO public.game_invites (id, game_id, host_id, invitee_id) VALUES
       (t.id('race-pay-a'), 'race-invite-paid', t.id('racepayhost'), t.id('racepaya')),
       (t.id('race-pay-b'), 'race-invite-paid', t.id('racepayhost'), t.id('racepayb'));`,
  );
  if (r.status !== 0) fail("The paid invitation race could not set up its game.", r.stderr);
  const accept = (who, inv, hold) =>
    `BEGIN; SELECT t.as_user(t.id('${who}'));
     SELECT 'ANSWER:' || (public.game_respond_invite(t.id('${inv}'), true) ->> 'status');
     ${hold ? "SELECT pg_sleep(3);" : ""} COMMIT;`;
  const first = session(accept("racepaya", "race-pay-a", true));
  await pause(1000);
  const second = session(accept("racepayb", "race-pay-b", false));
  const results = await Promise.all([first, second]);
  // Counts, not a list of the roster: a paid accept writes no roster row, so the roster is empty.
  const state = psql(dbName, [
    "-At",
    "-c",
    `SELECT (SELECT count(*) FROM public.game_participants WHERE game_id = 'race-invite-paid') || '|' ||
            (SELECT coalesce(string_agg(player_id::text || ':' || status, ','), '') FROM public.join_requests
              WHERE game_id = 'race-invite-paid') || '|' ||
            (SELECT string_agg(status, ',' ORDER BY id = t.id('race-pay-b')) FROM public.game_invites
              WHERE game_id = 'race-invite-paid')`,
  ]);
  const winner = psql(dbName, ["-At", "-c", "SELECT t.id('racepaya')"]).stdout.trim();
  psql(dbName, [], PAID_INVITE_RACE_CLEANUP);
  const answers = results.map((x) => (x.out.match(/ANSWER:(\w+)/) ?? [])[1]);
  return [
    [
      "two invitees accepting the last paid place: the first is approved, the other invitation waits",
      state.status === 0 && state.stdout.trim() === `0|${winner}:approved|accepted,pending`,
    ],
    [
      'and the second is told "full", without an error or a deadlock',
      results.every((x) => x.code === 0) && answers[0] === "accepted" && answers[1] === "full",
    ],
  ];
}

// 20261129130000: a host's removal or decline against whoever holds the player's invitation at the same moment.
// game_respond_invite takes the invitation, then the game, then the request. host_remove_player takes them in that order,
// so the two queue at the invitation. The decline trigger already holds the request and waits for the invitation: for a
// holder that is not waiting on the request (an availability delete's foreign-key action, an accept that times out) it
// then cancels it; with an accept that is, Postgres ends one side of the deadlock, and the trigger gives up its own wait
// (the accept then reads the request declined and answers 'expired'). Those orders deadlock mid-function, which holding
// a transaction open after the call would not show, so the accept session here takes its invitation first and waits
// before answering, as an accept that has just locked it would. Races 3 and 3b assume deadlock_timeout 1s
// (the default here and on Supabase): whichever side started waiting first runs the deadlock check first.
const HOST_RACE_CLEANUP = `
  DELETE FROM public.hosted_games WHERE id = 'race-host-remove';
  DELETE FROM public.notifications WHERE user_id IN (t.id('racermhost'), t.id('racerma'), t.id('racermb'), t.id('racermc'), t.id('racermd'),
                                                   t.id('racerme'), t.id('racermf'));
  DELETE FROM auth.users WHERE id IN (t.id('racermhost'), t.id('racerma'), t.id('racermb'), t.id('racermc'), t.id('racermd'),
                                         t.id('racerme'), t.id('racermf'));`;

async function hostRemovalRaces() {
  psql(dbName, [], HOST_RACE_CLEANUP);
  // racerma: on the roster with no request (added by the host). racermb: invited only. racermc to racermf: invited,
  // request pending; racermd's invitation came from her availability post.
  r = psql(
    dbName,
    [],
    `SELECT t.person('racermhost', 35), t.person('racerma', 25), t.person('racermb', 26), t.person('racermc', 27),
            t.person('racermd', 28), t.person('racerme', 29), t.person('racermf', 30);
     INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players)
       VALUES ('race-host-remove', t.id('racermhost'), 'basketball', 'Remove race', now() + interval '2 days', 10);
     INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
       VALUES ('race-host-remove', t.id('racermhost'), 0, true);
     INSERT INTO public.game_participants (game_id, user_id) VALUES ('race-host-remove', t.id('racerma'));
     INSERT INTO public.game_invites (id, game_id, host_id, invitee_id, created_at) VALUES
       (t.id('race-rm-a'), 'race-host-remove', t.id('racermhost'), t.id('racerma'), now() - interval '1 hour'),
       (t.id('race-rm-b'), 'race-host-remove', t.id('racermhost'), t.id('racermb'), now() - interval '1 hour'),
       (t.id('race-rm-c'), 'race-host-remove', t.id('racermhost'), t.id('racermc'), now() - interval '1 hour');
     SET session_replication_role = replica;
     INSERT INTO public.join_requests (game_id, host_id, player_id, idempotency_key) VALUES
       ('race-host-remove', t.id('racermhost'), t.id('racermc'), 'race'),
       ('race-host-remove', t.id('racermhost'), t.id('racermd'), 'race'),
       ('race-host-remove', t.id('racermhost'), t.id('racerme'), 'race'),
       ('race-host-remove', t.id('racermhost'), t.id('racermf'), 'race');
     INSERT INTO public.player_availabilities (id, user_id, sports) VALUES (t.id('race-rm-post'), t.id('racermd'), '{basketball}');
     INSERT INTO public.game_invites (id, game_id, host_id, invitee_id, availability_id, created_at) VALUES
       (t.id('race-rm-d'), 'race-host-remove', t.id('racermhost'), t.id('racermd'), t.id('race-rm-post'), now() - interval '1 hour'),
       (t.id('race-rm-e'), 'race-host-remove', t.id('racermhost'), t.id('racerme'), NULL, now() - interval '1 hour'),
       (t.id('race-rm-f'), 'race-host-remove', t.id('racermhost'), t.id('racermf'), NULL, now() - interval '1 hour');
     SET session_replication_role = origin;`,
  );
  if (r.status !== 0) fail("The host removal races could not set up their game.", r.stderr);
  // lockFirst: seconds the accept holds its invitation before answering (0: it answers at once).
  const accept = (who, inv, lockFirst) =>
    `BEGIN;
     ${lockFirst ? `SELECT 1 FROM public.game_invites WHERE id = t.id('${inv}') FOR UPDATE; SELECT pg_sleep(${lockFirst});` : ""}
     SELECT t.as_user(t.id('${who}'));
     SELECT 'ANSWER:' || (public.game_respond_invite(t.id('${inv}'), true) ->> 'status');
     COMMIT;`;
  const remove = (who, hold) =>
    `BEGIN; SELECT t.as_user(t.id('racermhost'));
     SELECT 'REMOVED:' || public.host_remove_player('race-host-remove', t.id('${who}'))::text;
     ${hold ? "SELECT pg_sleep(3);" : ""} COMMIT;`;
  const state = (who, inv) =>
    psql(dbName, [
      "-At",
      "-c",
      `SELECT (SELECT count(*) FROM public.game_participants WHERE game_id = 'race-host-remove' AND user_id = t.id('${who}'))
              || '|' || coalesce((SELECT status FROM public.join_requests
                                   WHERE game_id = 'race-host-remove' AND player_id = t.id('${who}')), 'none')
              || '|' || (SELECT status FROM public.game_invites WHERE id = t.id('${inv}'))`,
    ]).stdout.trim();
  const decline = (who) =>
    `BEGIN; SELECT t.as_user(t.id('racermhost'));
     UPDATE public.join_requests SET status = 'rejected', reviewed_at = now()
      WHERE game_id = 'race-host-remove' AND player_id = t.id('${who}');
     COMMIT;`;
  const answer = (x) => (x.out.match(/ANSWER:(\w+)/) ?? [])[1];
  const clean = (results) =>
    results.every((x) => x.code === 0) && !/deadlock/i.test(results.map((x) => x.out).join(""));

  // 1. The accept holds its invitation; the host removes the player meanwhile and waits for it, then removes the place
  //    the accept gave and declines the request it approved.
  let first = session(accept("racerma", "race-rm-a", 3));
  await pause(1000);
  let second = session(remove("racerma", false));
  const r1 = await Promise.all([first, second]);
  const s1 = state("racerma", "race-rm-a");
  // 2. The removal holds its transaction; the accept arrives, waits at the invitation and finds it cancelled.
  first = session(remove("racermb", true));
  await pause(1000);
  second = session(accept("racermb", "race-rm-b", false));
  const r2 = await Promise.all([first, second]);
  const s2 = state("racermb", "race-rm-b");
  // 3. The accept holds its invitation; the host declines the request meanwhile and its trigger waits for the
  //    invitation. Half a second later the accept asks for the request: a deadlock. The decline has waited longer, so
  //    Postgres stops its wait first (deadlock_timeout 1s); the trigger gives the wait up, the decline commits, and the
  //    accept reads the decline and answers expired.
  first = session(accept("racermc", "race-rm-c", 1.5));
  await pause(1000);
  second = session(decline("racermc"));
  const r3 = await Promise.all([first, second]);
  const s3 = state("racermc", "race-rm-c");
  // 3b. The same, with the accept holding its invitation for 3 seconds: the decline's deadlock check (at 1s) finds no
  //    cycle yet, so the accept's own check finds it and Postgres ends the accept (40P01, nothing kept). The decline
  //    then cancels the invitation. Either way the host's decline holds.
  first = session(accept("racermf", "race-rm-f", 3));
  await pause(1000);
  second = session(decline("racermf"));
  const r3b = await Promise.all([first, second]);
  const s3b = state("racermf", "race-rm-f");
  // 4. The player deletes the availability post her invitation came from: ON DELETE SET NULL updates the pending
  //    invitation and holds it until her transaction ends. The host declines meanwhile: the decline waits for her, then
  //    cancels the invitation (skipping it would leave it pending for good).
  first = session(
    `BEGIN; SELECT t.as_user(t.id('racermd'));
     WITH d AS (DELETE FROM public.player_availabilities WHERE id = t.id('race-rm-post') RETURNING 1)
     SELECT 'DELETED:' || count(*) FROM d;
     SELECT pg_sleep(3); COMMIT;`,
  );
  await pause(1000);
  second = session(decline("racermd"));
  const r4 = await Promise.all([first, second]);
  const s4 = state("racermd", "race-rm-d");
  const post4 = psql(dbName, [
    "-At",
    "-c",
    "SELECT availability_id IS NULL FROM public.game_invites WHERE id = t.id('race-rm-d')",
  ]).stdout.trim();
  // 5. The accept holds the invitation and waits for the game (another writer holds it), then gives up on its statement
  //    timeout. The host's decline waits for the invitation meanwhile, then cancels it once the accept has rolled back.
  const hold = session(
    `BEGIN; SELECT 1 FROM public.hosted_games WHERE id = 'race-host-remove' FOR NO KEY UPDATE;
     SELECT pg_sleep(4); COMMIT;`,
  );
  await pause(500);
  first = session(`SET statement_timeout = '2500ms';\n${accept("racerme", "race-rm-e", false)}`);
  await pause(1000);
  second = session(decline("racerme"));
  const r5 = await Promise.all([hold, first, second]);
  const s5 = state("racerme", "race-rm-e");
  psql(dbName, [], HOST_RACE_CLEANUP);
  return [
    [
      "an accept holding its invitation, then the host's removal: the removal waits, then takes the place and declines",
      clean(r1) && answer(r1[0]) === "accepted" && s1 === "0|rejected|accepted",
    ],
    [
      "a removal in progress, then the accept: it waits and answers cancelled, writing nothing",
      clean(r2) && answer(r2[1]) === "cancelled" && s2 === "0|none|cancelled",
    ],
    [
      "an accept holding its invitation, then the host's decline: the decline yields the deadlock, the accept answers expired",
      clean(r3) && answer(r3[0]) === "expired" && s3 === "0|rejected|expired",
    ],
    [
      "an accept holding its invitation longer, then the host's decline: the accept is ended, the invitation cancelled",
      r3b[0].code !== 0 &&
        /deadlock detected/.test(r3b[0].out) &&
        r3b[1].code === 0 &&
        s3b === "0|rejected|cancelled",
    ],
    [
      "a player's availability delete holding the invitation (FK set null), then the host's decline: it waits, then cancels",
      clean(r4) && /DELETED:1/.test(r4[0].out) && post4 === "t" && s4 === "0|rejected|cancelled",
    ],
    [
      "an accept holding the invitation that then times out, and the host's decline meanwhile: the invitation is cancelled",
      r5[0].code === 0 &&
        r5[1].code !== 0 &&
        /statement timeout/.test(r5[1].out) &&
        r5[2].code === 0 &&
        s5 === "0|rejected|cancelled",
    ],
  ];
}

// 20261130110000: a guardian's cancel for their child against the host's removal of the same child. The cancel deletes
// the request first and then the roster row, whose joined-count trigger updates the game; the removal takes the game and
// then the request. The two can deadlock, and the app then tries the ended call once more (cancelChildGame,
// hostRemoveParticipant), which is safe only because Postgres ends that side whole. The cancel session here takes the
// request first and waits before cancelling, as a cancel that has just deleted it would; the removal starts meanwhile
// and waits for the request. The cancel goes on only once it sees the removal waiting on it (pg_locks, polled, not a
// fixed sleep, so a slow runner does not change the order) and a further 2s, past the removal's own deadlock check
// (deadlock_timeout 1s, as in races 3 and 3b), which finds no cycle yet. So the cancel's check finds it: Postgres ends
// the cancel, the removal commits, and the cancel tried once more answers 'withdrawn', keeps the removal's declined
// request and takes back the guardian's approval on it.
const GUARDIAN_RACE_CLEANUP = `
  DELETE FROM public.hosted_games WHERE id = 'race-guardian-cancel';
  DELETE FROM public.notifications WHERE user_id IN (t.id('racegchost'), t.id('racegcmom'), t.id('racegckid'));
  DELETE FROM auth.users WHERE id IN (t.id('racegchost'), t.id('racegcmom'), t.id('racegckid'));`;

async function guardianCancelRace() {
  psql(dbName, [], GUARDIAN_RACE_CLEANUP);
  // racegckid (15) is on the roster with a request the host approved and racegcmom approved as guardian.
  r = psql(
    dbName,
    [],
    `SELECT t.person('racegchost', 35), t.person('racegcmom', 42), t.person('racegckid', 15);
     SELECT t.guardian('racegcmom', 'racegckid');
     INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players)
       VALUES ('race-guardian-cancel', t.id('racegchost'), 'basketball', 'Cancel race', now() + interval '2 days', 10);
     INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
       VALUES ('race-guardian-cancel', t.id('racegchost'), 0, true);
     SET session_replication_role = replica;
     INSERT INTO public.join_requests (game_id, host_id, player_id, status, idempotency_key, reviewed_at,
                                       guardian_approved_at, guardian_approved_by)
       VALUES ('race-guardian-cancel', t.id('racegchost'), t.id('racegckid'), 'approved', 'race', now() - interval '1 hour',
               now() - interval '1 hour', t.id('racegcmom'));
     INSERT INTO public.game_participants (game_id, user_id) VALUES ('race-guardian-cancel', t.id('racegckid'));
     UPDATE public.hosted_games SET joined = 1 WHERE id = 'race-guardian-cancel';
     SET session_replication_role = origin;`,
  );
  if (r.status !== 0) fail("The guardian cancel race could not set up its game.", r.stderr);
  // holdFirst: the cancel holds the child's request until the removal waits for it, then 2s more (false: it cancels at
  // once). It gives up after 30s if the removal never waits, which fails the race's first check.
  const holdUntilRemovalWaits = `SELECT 1 FROM public.join_requests WHERE game_id = 'race-guardian-cancel' AND player_id = t.id('racegckid') FOR UPDATE;
     DO $wait$
     BEGIN
       FOR _try IN 1..300 LOOP
         IF EXISTS (SELECT 1 FROM pg_locks l WHERE NOT l.granted AND pg_backend_pid() = ANY (pg_blocking_pids(l.pid))) THEN
           RETURN;
         END IF;
         PERFORM pg_sleep(0.1);
       END LOOP;
       RAISE EXCEPTION 'the removal never waited for the request';
     END $wait$;
     SELECT pg_sleep(2);`;
  const cancel = (holdFirst) =>
    `BEGIN;
     ${holdFirst ? holdUntilRemovalWaits : ""}
     SELECT t.as_user(t.id('racegcmom'));
     SELECT 'CANCEL:' || public.guardian_cancel_child_game(t.id('racegckid'), 'race-guardian-cancel');
     COMMIT;`;
  const remove = `BEGIN; SELECT t.as_user(t.id('racegchost'));
     SELECT 'REMOVED:' || public.host_remove_player('race-guardian-cancel', t.id('racegckid'))::text;
     COMMIT;`;
  // roster rows | status | note | decline stamped | no guardian approval left
  const state = () =>
    psql(dbName, [
      "-At",
      "-c",
      `SELECT (SELECT count(*) FROM public.game_participants WHERE game_id = 'race-guardian-cancel' AND user_id = t.id('racegckid'))
              || '|' || coalesce((SELECT status || '|' || coalesce(reviewer_notes, '') || '|' || (last_rejected_at IS NOT NULL)::text
                                         || '|' || (guardian_approved_at IS NULL AND guardian_approved_by IS NULL)::text
                                    FROM public.join_requests
                                   WHERE game_id = 'race-guardian-cancel' AND player_id = t.id('racegckid')), 'none')`,
    ]).stdout.trim();
  const first = session(cancel(true));
  await pause(1000);
  const second = session(remove);
  const [ended, removal] = await Promise.all([first, second]);
  const afterRace = state();
  const retry = await session(cancel(false));
  const afterRetry = state();
  psql(dbName, [], GUARDIAN_RACE_CLEANUP);
  return [
    [
      "a guardian's cancel holding the child's request, then the host's removal: the cancel is ended whole, the removal commits",
      ended.code !== 0 &&
        /deadlock detected/.test(ended.out) &&
        removal.code === 0 &&
        /REMOVED:\{"removed": true, "request_declined": true/.test(removal.out) &&
        afterRace === "0|rejected|Removed by host|true|false",
    ],
    [
      "the cancel tried once more answers withdrawn, keeps the removal's decline and takes back the guardian's approval",
      retry.code === 0 &&
        /CANCEL:withdrawn/.test(retry.out) &&
        afterRetry === "0|rejected|Removed by host|true|true",
    ],
  ];
}

// 20261205100000: a member sends the same post report twice at the same moment (a double tap, two tabs). report_post
// takes a transaction advisory lock on (reporter, post) before it looks for the open report, so the second call waits
// for the first to commit, finds its report and answers with it: one row, one id for both, no error.
const POST_REPORT_RACE_CLEANUP = `
  DELETE FROM public.user_reports WHERE reporter_id = t.id('racerepb');
  DELETE FROM public.posts WHERE id = t.id('race-net-post');
  DELETE FROM auth.users WHERE id IN (t.id('racerepa'), t.id('racerepb'));`;

async function postReportRace() {
  psql(dbName, [], POST_REPORT_RACE_CLEANUP);
  r = psql(
    dbName,
    [],
    `SELECT t.person('racerepa', 30), t.person('racerepb', 31);
     INSERT INTO public.posts (id, author_id, audience, body, moderation_status)
       VALUES (t.id('race-net-post'), t.id('racerepa'), 'public', 'Race me', 'approved');`,
  );
  if (r.status !== 0) fail("The post report race could not set up its post.", r.stderr);
  const report = (hold) =>
    `BEGIN; SELECT t.as_user(t.id('racerepb'));
     SELECT 'ANSWER:' || public.report_post(t.id('race-net-post'), 'spam');
     ${hold ? "SELECT pg_sleep(3);" : ""} COMMIT;`;
  const first = session(report(true));
  await pause(1000);
  const second = session(report(false));
  const results = await Promise.all([first, second]);
  const rows = psql(dbName, [
    "-At",
    "-c",
    "SELECT count(*) FROM public.user_reports WHERE reporter_id = t.id('racerepb') AND post_id = t.id('race-net-post')",
  ]).stdout.trim();
  psql(dbName, [], POST_REPORT_RACE_CLEANUP);
  const answers = results.map((x) => (x.out.match(/ANSWER:([0-9a-f-]{36})/) ?? [])[1]);
  return [
    ["one member reporting the same post twice at once files one report", rows === "1"],
    [
      "and both calls answer with that report, without an error",
      results.every((x) => x.code === 0) && !!answers[0] && answers[0] === answers[1],
    ],
  ];
}

// P2-1 stage 4a: one family signs up through the old path (rsvp_tryout) and another through
// events (register_for_event) for the last seat of the same copied tryout. Both lock the post
// first, so the second waits for the first and is told it is full: one seat is taken, never two,
// and no mirror write fails. Run in both orders.
const SIGNUP_RACE_CLEANUP = `
  DELETE FROM public.team_posts WHERE id = t.id('race-post');
  DELETE FROM public.teams WHERE id = 'race-team';
  DELETE FROM private_sec.event_mirror_failures WHERE source_id LIKE t.id('race-post')::text || '%';
  DELETE FROM auth.users WHERE id IN (t.id('raceowner'), t.id('raceold'), t.id('racenew'));`;

async function oldVsNewSignupRace(oldFirst) {
  psql(dbName, [], SIGNUP_RACE_CLEANUP);
  r = psql(
    dbName,
    [],
    `SELECT t.person('raceowner', 40), t.person('raceold', 30), t.person('racenew', 31);
     INSERT INTO public.teams (id, owner_id, kind, name, handle, age_groups)
       VALUES ('race-team', t.id('raceowner'), 'team', 'Race', 'race-team', ARRAY['adult']);
     INSERT INTO public.team_posts (id, team_id, author_id, kind, title, event_date, moderation_status, spots_max)
       VALUES (t.id('race-post'), 'race-team', t.id('raceowner'), 'tryout', 'Last seat tryout',
               now() + interval '3 days', 'approved', 1);`,
  );
  if (r.status !== 0) fail("The sign-up race could not set up its tryout.", r.stderr);
  const oldPath = (hold) =>
    `BEGIN; SELECT t.as_user(t.id('raceold'));
     SELECT public.rsvp_tryout(t.id('race-post'));
     ${hold ? "SELECT pg_sleep(3);" : ""} COMMIT;`;
  const newPath = (hold) =>
    `BEGIN; SELECT t.as_user(t.id('racenew'));
     SELECT public.register_for_event((SELECT id FROM public.events WHERE legacy_post_id = t.id('race-post')));
     ${hold ? "SELECT pg_sleep(3);" : ""} COMMIT;`;
  const first = session(oldFirst ? oldPath(true) : newPath(true));
  await pause(1000);
  const second = session(oldFirst ? newPath(false) : oldPath(false));
  const results = await Promise.all([first, second]);
  const state = psql(dbName, [
    "-At",
    "-c",
    `SELECT (SELECT spots_taken FROM public.team_posts WHERE id = t.id('race-post')) || '|' ||
            (SELECT count(*) FROM public.tryout_rsvps WHERE post_id = t.id('race-post') AND status = 'registered') || '|' ||
            (SELECT count(*) FROM public.event_registrations g JOIN public.events e ON e.id = g.event_id
              WHERE e.legacy_post_id = t.id('race-post') AND g.status = 'registered') || '|' ||
            (SELECT count(*) FROM private_sec.event_mirror_failures WHERE source_id LIKE t.id('race-post')::text || '%')`,
  ]).stdout.trim();
  psql(dbName, [], SIGNUP_RACE_CLEANUP);
  const lost = results.filter((x) => x.code !== 0);
  const order = oldFirst ? "old path first" : "events path first";
  return [
    [`last seat, ${order}: one seat taken everywhere, no mirror failure`, state === "1|1|1|0"],
    [
      `last seat, ${order}: the other is told it is full, without a deadlock`,
      lost.length === 1 &&
        /TRYOUT_FULL|EVENT_FULL/.test(lost[0].out) &&
        !/deadlock/i.test(results.map((x) => x.out).join("")),
    ],
  ];
}

let exitCode = 0;
try {
  if (!reuse) {
    r = psql(dbName, ["-f", join(root, "supabase/tests/support/supabase-stub.sql")]);
    if (r.status !== 0) fail("The Supabase platform stub failed to load.", r.stderr);

    // -- replay -------------------------------------------------------------
    let migrations;
    try {
      const order = dedupeMigrations(migrationOrder(root));
      migrations = order.replay;
      if (order.skipped.length > 0)
        console.log(
          `Skipped ${order.skipped.length} known identical copies (applied once): ${order.skipped
            .map((t) => t.name)
            .join(", ")}`,
        );
    } catch (e) {
      fail(e.message);
    }
    const started = Date.now();
    for (const migration of migrations) {
      let sql = readFileSync(migration.path, "utf8");
      if (stripMaintain) sql = sql.replace(/,\s*MAINTAIN\b/gi, "");
      r = psql(dbName, ["-1"], sql);
      if (r.status !== 0) fail(`Migration failed to apply: ${migration.name}`, r.stderr);
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
      for (const [name, ok] of [
        ...(await lastSeatRace()),
        ...(await inviteLastPlaceRace()),
        ...(await paidInviteLastPlaceRace()),
        ...(await postReportRace()),
        ...(await hostRemovalRaces()),
        ...(await guardianCancelRace()),
        ...(await oldVsNewSignupRace(true)),
        ...(await oldVsNewSignupRace(false)),
      ]) {
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
