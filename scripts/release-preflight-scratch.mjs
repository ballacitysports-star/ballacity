// Local scratch-database helpers for the release preflight.
//
// Used only by `release-preflight.mjs --write-manifest` (to replay the migrations and record what
// each one provides and what the final protection definitions look like) and by its self-tests.
// Everything here talks to the LOCAL Postgres that `bun run test:db` uses (libpq settings PGHOST,
// PGHOSTADDR, PGPORT, PGUSER, PGPASSWORD) and refuses any other host. It creates and drops its own
// databases and never touches a release target. The preflight itself never imports the write paths below.
//
// It is held to the same rules as scripts/db-test.mjs (scripts/db-test-target.mjs): the libpq settings are checked
// before any connection; before the first write the server must attest that it is a local scratch Postgres (not a
// Supabase-managed cluster, not a forwarded port to a populated server); every database it creates carries the scratch
// marker, and it drops, reuses or writes to no database without that marker (independent review of d604958c).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  DATABASE_LIST_SQL,
  SCRATCH_MARKER,
  SERVER_PROBE_SQL,
  existingDatabaseProblems,
  serverProblemsFromProbe,
  targetProblems,
} from "./db-test-target.mjs";
import {
  bucketStateSql,
  functionStateSql,
  policyStateSql,
  tableStateSql,
} from "./release-preflight.mjs";

const LOCAL_HOSTS = new Set(["", "localhost", "127.0.0.1", "::1"]);
const LOOPBACK_ADDRS = /^(127(?:\.\d{1,3}){3}|::1|0:0:0:0:0:0:0:1)$/;
/** The role every replay runs as: production's migrations are applied as postgres, so owners and ACLs match. */
export const MIGRATOR_ROLE = "postgres";

/**
 * libpq environment for the local scratch server. Throws if PGHOST (any of a comma-separated list) is not a
 * unix socket or localhost, or if PGHOSTADDR (which libpq uses instead of resolving PGHOST) is not a loopback
 * address. PGSERVICE and PGSERVICEFILE are removed: a service entry could name any host.
 */
export function localEnv(source = process.env) {
  for (const host of (source.PGHOST ?? "").split(",")) {
    if (!(LOCAL_HOSTS.has(host) || host.startsWith("/"))) {
      throw new Error(
        `Refusing to use PGHOST=${source.PGHOST} for scratch databases: only a local Postgres (unix socket, localhost) is allowed.`,
      );
    }
  }
  for (const addr of (source.PGHOSTADDR ?? "").split(",")) {
    if (addr !== "" && !LOOPBACK_ADDRS.test(addr.trim()))
      throw new Error(
        `Refusing to use PGHOSTADDR=${source.PGHOSTADDR} for scratch databases: only a loopback address (127.0.0.0/8, ::1) is allowed.`,
      );
  }
  // Then db-test's client-side rules (scripts/db-test-target.mjs): services and a connection-string PGDATABASE are
  // refused, not silently dropped. The database name is checked per call (scratchName).
  const problems = targetProblems(source, "scratch_name_checked_separately");
  if (problems.length)
    throw new Error(
      `Refusing to use this libpq environment for scratch databases:\n  - ${problems.join("\n  - ")}`,
    );
  const env = { ...source };
  delete env.PGDATABASE;
  delete env.PGSERVICE;
  delete env.PGSERVICEFILE;
  delete env.PREFLIGHT_DATABASE_URL;
  env.PGOPTIONS = "-c search_path=public,extensions";
  return env;
}

/** psql's -d takes a conninfo string or a URI as well as a name; only a plain name is ever passed. */
function databaseArg(database) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(String(database)))
    throw new Error(
      `bad database name ${JSON.stringify(database)}: a plain identifier, never a connection string`,
    );
  return database;
}

function psqlRun(database, extraArgs, input, readOnly) {
  const env = localEnv();
  // The server refuses CREATE/DROP DATABASE and every write inside a read-only transaction.
  if (readOnly) env.PGOPTIONS = `${env.PGOPTIONS} -c default_transaction_read_only=on`;
  return spawnSync(
    "psql",
    ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", databaseArg(database), ...extraArgs],
    { input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env },
  );
}

/**
 * psql against the local server for reads: every statement runs in a read-only transaction, so the caller cannot
 * create, drop or write anything with it (independent review: the one exported psql was a write path with no check).
 */
export function psqlLocal(database, extraArgs, input) {
  return psqlRun(database, extraArgs, input, true);
}

/** The writing psql, for the helpers below only, after their checks. */
function psqlWrite(database, extraArgs, input) {
  return psqlRun(database, extraArgs, input, false);
}

function must(r, what) {
  if (r.status !== 0)
    throw new Error(`${what}\n${(r.stderr ?? "").trim().split("\n").slice(-12).join("\n")}`);
  return r.stdout;
}

export function scratchName(name) {
  if (!/^[a-z0-9_]+$/.test(name) || ["postgres", "template0", "template1"].includes(name))
    throw new Error(`bad scratch database name ${name}`);
  return name;
}

export function serverVersionNum() {
  return Number(
    must(
      psqlLocal("postgres", ["-At", "-c", "SHOW server_version_num"]),
      "Cannot reach the local Postgres",
    ).trim(),
  );
}

/** What decides which server libpq reaches; the attestation is remembered for exactly this. */
function serverKey(env = process.env) {
  return JSON.stringify(
    ["PGHOST", "PGHOSTADDR", "PGPORT", "PGUSER", "PGSERVICE", "PGSERVICEFILE"].map(
      (k) => env[k] ?? null,
    ),
  );
}

let serverVerifiedFor = null;
/**
 * Before the first write: the server attests that it is a local scratch Postgres, as db-test requires. Remembered per
 * libpq environment: a change to PGHOST/PGPORT/... after the check means a server that was never checked.
 */
export function verifyServer() {
  if (serverVerifiedFor === serverKey()) return;
  const probe = must(
    psqlLocal("postgres", ["-At", "-F", "|", "-c", SERVER_PROBE_SQL]),
    "Could not identify the local Postgres",
  );
  const databases = must(
    psqlLocal("postgres", ["-At", "-F", "\t", "-c", DATABASE_LIST_SQL]),
    "Could not list the local Postgres databases",
  );
  const problems = serverProblemsFromProbe(probe, databases);
  if (problems.length)
    throw new Error(
      `Refusing to write scratch databases: the server is not a verified local scratch Postgres.\n  - ${problems.join("\n  - ")}`,
    );
  serverVerifiedFor = serverKey();
}

/** Whether a database exists and its comment (the scratch marker, for one a harness created). */
function databaseState(name) {
  const out = must(
    psqlLocal("postgres", [
      "-At",
      "-c",
      `SELECT 1, coalesce(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = '${scratchName(name)}'`,
    ]),
    `Could not look up ${name}`,
  ).trim();
  return out
    ? { exists: true, comment: out.split("|").slice(1).join("|") }
    : { exists: false, comment: "" };
}

const created = new Set();
/** Throws unless the database carries the scratch marker (it was created by db-test or by this module). */
function requireScratch(name) {
  verifyServer();
  if (created.has(name)) return;
  const state = databaseState(name);
  if (!state.exists || state.comment !== SCRATCH_MARKER)
    throw new Error(
      `Refusing to write to ${name}: it is not a scratch database created by db-test or the preflight helpers (no scratch marker).`,
    );
}

export function dropDb(name) {
  verifyServer();
  const problems = existingDatabaseProblems(databaseState(name));
  if (problems.length) throw new Error(`Refusing to drop ${name}: ${problems.join(" ")}`);
  psqlWrite("postgres", ["-c", `DROP DATABASE IF EXISTS "${scratchName(name)}"`]);
  created.delete(name);
}

/**
 * For the self-test only: a database WITHOUT the scratch marker, to prove that every helper refuses it. The server is
 * attested first, the name must be a self-test name, and the database is dropped again whatever `fn` does. This is
 * the only way this module touches an unmarked database.
 */
export function withUnmarkedDatabase(name, fn) {
  verifyServer();
  if (!/^rpf_[a-z0-9_]+$/.test(name)) throw new Error(`not a self-test database name: ${name}`);
  if (databaseState(name).exists) throw new Error(`${name} already exists`);
  must(
    psqlWrite("postgres", ["-c", `CREATE DATABASE "${scratchName(name)}"`]),
    `Could not create ${name}`,
  );
  try {
    return fn();
  } finally {
    psqlWrite("postgres", ["-c", `DROP DATABASE IF EXISTS "${scratchName(name)}"`]);
  }
}

export function createDb(name, template) {
  dropDb(name);
  if (template) requireScratch(template);
  const tpl = template ? ` TEMPLATE "${scratchName(template)}"` : "";
  must(
    psqlWrite("postgres", ["-c", `CREATE DATABASE "${scratchName(name)}"${tpl}`]),
    `Could not create ${name}`,
  );
  must(
    psqlWrite("postgres", [
      "-c",
      `COMMENT ON DATABASE "${scratchName(name)}" IS '${SCRATCH_MARKER}'`,
    ]),
    `Could not mark ${name} as a scratch database`,
  );
  created.add(name);
}

export function sql(db, text) {
  requireScratch(db);
  return must(psqlWrite(db, ["-At"], text), `SQL failed on ${db}`);
}

const asMigrator = `SET ROLE ${MIGRATOR_ROLE};\n`;

/** Loads the platform stub as the migrator role, so its default privileges apply to that role's objects. */
export function loadStub(db, root) {
  requireScratch(db);
  must(
    psqlWrite(
      db,
      [],
      asMigrator + readFileSync(`${root}/supabase/tests/support/supabase-stub.sql`, "utf8"),
    ),
    `The Supabase platform stub failed to load (the replay runs as role ${MIGRATOR_ROLE}, which must exist and be a superuser)`,
  );
}

/** Applies one migration file in its own transaction as the migrator role, as db-test.mjs does. */
export function applyMigration(db, absPath, stripMaintain) {
  requireScratch(db);
  let text = readFileSync(absPath, "utf8");
  if (stripMaintain) text = text.replace(/,\s*MAINTAIN\b/gi, "");
  must(psqlWrite(db, ["-1"], asMigrator + text), `Migration failed to apply: ${absPath}`);
}

/**
 * Catalog snapshot used to derive `provides` and every protection state. search_path is empty so every
 * name is schema-qualified; the preflight reads the target with the same setting and the same state
 * fragments (release-preflight.mjs), so the states are comparable.
 */
export const SNAPSHOT_SQL = `
SET search_path = '';
SELECT json_build_object(
  'functions', (SELECT coalesce(json_object_agg(p.oid::regprocedure::text, ${functionStateSql("p")}), '{}')
                  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
                   AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp%'
                   AND p.prokind IN ('f', 'p')),
  'policies', (SELECT coalesce(json_object_agg(pp.schemaname || '|' || pp.tablename || '|' || pp.policyname,
                   ${policyStateSql("pp")}), '{}')
                 FROM pg_policies pp),
  'tables', (SELECT coalesce(json_object_agg(n.nspname || '.' || c.relname, ${tableStateSql("c")}), '{}')
               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE c.relkind IN ('r', 'p')
                AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp%'),
  'buckets', (SELECT coalesce(json_object_agg(b.id, ${bucketStateSql("b")}), '{}') FROM storage.buckets b),
  'relations', (SELECT coalesce(json_agg(c.oid::regclass::text ORDER BY 1), '[]')
                  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
                   AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                   AND n.nspname NOT LIKE 'pg\\_toast%'),
  'schemas', (SELECT coalesce(json_agg(nspname::text ORDER BY 1), '[]') FROM pg_namespace
               WHERE nspname NOT IN ('pg_catalog', 'information_schema')
                 AND nspname NOT LIKE 'pg\\_toast%' AND nspname NOT LIKE 'pg\\_temp%')
);`;

export function snapshot(db) {
  const out = sql(db, SNAPSHOT_SQL).trim().split("\n").pop();
  return JSON.parse(out);
}

/** Structural fingerprint of a database, used by the self-tests to prove the preflight wrote nothing. */
export function fingerprint(db) {
  return sql(
    db,
    `SET search_path = '';
     SELECT md5(concat_ws('#',
       (SELECT string_agg(p.oid::regprocedure::text || ':' || md5(coalesce(pg_get_functiondef(p.oid), '')) || ':' || p.proowner::regrole::text || ':' || coalesce(p.proacl::text, 'default'), ',' ORDER BY 1)
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND p.prokind IN ('f','p')),
       (SELECT string_agg(c.oid::regclass::text || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' || c.relforcerowsecurity::text || ':' || coalesce(c.relacl::text, 'default'), ',' ORDER BY 1)
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg\\_toast%'),
       (SELECT string_agg(attrelid::regclass::text || '.' || attname || ':' || atttypid::regtype::text, ',' ORDER BY 1)
          FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE a.attnum > 0 AND NOT a.attisdropped AND n.nspname NOT IN ('pg_catalog','information_schema')
           AND n.nspname NOT LIKE 'pg\\_toast%'),
       (SELECT string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || coalesce(qual,'') || ':' || coalesce(with_check,''), ',' ORDER BY 1)
          FROM pg_policies),
       (SELECT string_agg(tgrelid::regclass::text || '.' || tgname || ':' || tgfoid::regprocedure::text || ':' || tgtype::text || ':' || tgenabled::text, ',' ORDER BY 1)
          FROM pg_trigger WHERE NOT tgisinternal),
       (SELECT string_agg(id || ':' || public::text, ',' ORDER BY 1) FROM storage.buckets),
       (SELECT string_agg(nspname, ',' ORDER BY 1) FROM pg_namespace)
     ));`,
  ).trim();
}
