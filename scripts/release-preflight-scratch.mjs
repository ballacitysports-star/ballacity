// Local scratch-database helpers for the release preflight.
//
// Used only by `release-preflight.mjs --write-manifest` (to replay the migrations and record what
// each one provides and what the final protection definitions look like) and by its self-tests.
// Everything here talks to the LOCAL Postgres that `bun run test:db` uses (libpq settings PGHOST,
// PGHOSTADDR, PGPORT, PGUSER, PGPASSWORD) and refuses any other host. It creates and drops its own
// databases and never touches a release target. The preflight itself never imports the write paths below.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
  const env = { ...source };
  delete env.PGDATABASE;
  delete env.PGSERVICE;
  delete env.PGSERVICEFILE;
  delete env.PREFLIGHT_DATABASE_URL;
  env.PGOPTIONS = "-c search_path=public,extensions";
  return env;
}

export function psqlLocal(database, extraArgs, input) {
  return spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", database, ...extraArgs], {
    input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: localEnv(),
  });
}

function must(r, what) {
  if (r.status !== 0)
    throw new Error(`${what}\n${(r.stderr ?? "").trim().split("\n").slice(-12).join("\n")}`);
  return r.stdout;
}

export function scratchName(name) {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`bad scratch database name ${name}`);
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

export function dropDb(name) {
  psqlLocal("postgres", ["-c", `DROP DATABASE IF EXISTS "${scratchName(name)}"`]);
}

export function createDb(name, template) {
  dropDb(name);
  const tpl = template ? ` TEMPLATE "${scratchName(template)}"` : "";
  must(
    psqlLocal("postgres", ["-c", `CREATE DATABASE "${scratchName(name)}"${tpl}`]),
    `Could not create ${name}`,
  );
}

export function sql(db, text) {
  return must(psqlLocal(db, ["-At"], text), `SQL failed on ${db}`);
}

const asMigrator = `SET ROLE ${MIGRATOR_ROLE};\n`;

/** Loads the platform stub as the migrator role, so its default privileges apply to that role's objects. */
export function loadStub(db, root) {
  must(
    psqlLocal(
      db,
      [],
      asMigrator + readFileSync(`${root}/supabase/tests/support/supabase-stub.sql`, "utf8"),
    ),
    `The Supabase platform stub failed to load (the replay runs as role ${MIGRATOR_ROLE}, which must exist and be a superuser)`,
  );
}

/** Applies one migration file in its own transaction as the migrator role, as db-test.mjs does. */
export function applyMigration(db, absPath, stripMaintain) {
  let text = readFileSync(absPath, "utf8");
  if (stripMaintain) text = text.replace(/,\s*MAINTAIN\b/gi, "");
  must(psqlLocal(db, ["-1"], asMigrator + text), `Migration failed to apply: ${absPath}`);
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
