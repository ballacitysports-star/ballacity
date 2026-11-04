// Local scratch-database helpers for the release preflight.
//
// Used only by `release-preflight.mjs --write-manifest` (to replay the migrations and record what
// each one provides and what the final protection definitions look like) and by its self-tests.
// Everything here talks to the LOCAL Postgres that `bun run test:db` uses (libpq settings PGHOST,
// PGPORT, PGUSER, PGPASSWORD) and refuses any other host. It creates and drops its own databases
// and never touches a release target. The preflight itself never imports the write paths below.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const LOCAL_HOSTS = new Set(["", "localhost", "127.0.0.1", "::1"]);

/** libpq environment for the local scratch server; throws if PGHOST points anywhere else. */
export function localEnv() {
  const host = process.env.PGHOST ?? "";
  if (!(LOCAL_HOSTS.has(host) || host.startsWith("/"))) {
    throw new Error(
      `Refusing to use PGHOST=${host} for scratch databases: only a local Postgres (unix socket, localhost) is allowed.`,
    );
  }
  const env = { ...process.env };
  delete env.PGDATABASE;
  delete env.PGSERVICE;
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

export function loadStub(db, root) {
  must(
    psqlLocal(db, ["-f", `${root}/supabase/tests/support/supabase-stub.sql`]),
    "The Supabase platform stub failed to load",
  );
}

/** Applies one migration file in its own transaction, as db-test.mjs does. */
export function applyMigration(db, absPath, stripMaintain) {
  let text = readFileSync(absPath, "utf8");
  if (stripMaintain) text = text.replace(/,\s*MAINTAIN\b/gi, "");
  must(psqlLocal(db, ["-1"], text), `Migration failed to apply: ${absPath}`);
}

/**
 * Catalog snapshot used to derive `provides` and `expect_after`. search_path is empty so every
 * name is schema-qualified; the preflight reads the target with the same setting, so the md5s of
 * pg_get_functiondef and of the policy expressions are comparable.
 */
export const SNAPSHOT_SQL = `
SET search_path = '';
SELECT json_build_object(
  'functions', (SELECT coalesce(json_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))), '{}')
                  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
                   AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp%'
                   AND p.prokind IN ('f', 'p')),
  'policies', (SELECT coalesce(json_object_agg(schemaname || '|' || tablename || '|' || policyname,
                   json_build_object('qual', md5(qual), 'with_check', md5(with_check),
                                     'shape', md5(cmd || '|' || permissive || '|' || roles::text))), '{}')
                 FROM pg_policies),
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
       (SELECT string_agg(p.oid::regprocedure::text || ':' || md5(coalesce(pg_get_functiondef(p.oid), '')), ',' ORDER BY 1)
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND p.prokind IN ('f','p')),
       (SELECT string_agg(c.oid::regclass::text || ':' || c.relkind::text || ':' || c.relrowsecurity::text, ',' ORDER BY 1)
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg\\_toast%'),
       (SELECT string_agg(attrelid::regclass::text || '.' || attname || ':' || atttypid::regtype::text, ',' ORDER BY 1)
          FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE a.attnum > 0 AND NOT a.attisdropped AND n.nspname NOT IN ('pg_catalog','information_schema')
           AND n.nspname NOT LIKE 'pg\\_toast%'),
       (SELECT string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || coalesce(qual,'') || ':' || coalesce(with_check,''), ',' ORDER BY 1)
          FROM pg_policies),
       (SELECT string_agg(tgrelid::regclass::text || '.' || tgname || ':' || tgenabled::text, ',' ORDER BY 1)
          FROM pg_trigger WHERE NOT tgisinternal),
       (SELECT string_agg(nspname, ',' ORDER BY 1) FROM pg_namespace)
     ));`,
  ).trim();
}
