#!/usr/bin/env node
// Release preflight: read-only checks of a target database against the checked-in release manifest
// (docs/release/release-manifest.json) before the privacy release migrations are applied by hand.
// Run with --help for usage. The preflight never writes to the target: see HELP below.
//
// Release range: the manifest starts at 20261103100000, step 0a of runbook section 2 (the first
// migration of the privacy release), not at section 1's first unledgered file (20260915214000).
// The 71 files from 20260915214000 to 20261030120000 are in production by catalog evidence but have
// no ledger rows, while 20260926155719 is ledgered after them; a range starting there would always
// report a gap and list historical files as pending, and historical files must never be re-run.
// Their ledger rows are a separate owner decision (docs/migration-history-reconciliation.md).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_MANIFEST = "docs/release/release-manifest.json";
export const LEDGER = "supabase_migrations.schema_migrations";
export const DRIZZLE_LEDGER = "drizzle.__drizzle_migrations";
export const LEDGER_SCHEMA = "supabase_migrations";
export const MANIFEST_FORMAT = 2;
/** Postgres majors the preflight knows how to read. Anything else fails closed. */
export const SUPPORTED_MAJORS = [16, 17];
/** Lovable-applied rows carry a version one or two seconds after the file's timestamp and the file stem as name. */
export const LEDGER_NAME_SKEW_SECONDS = 10;

const HELP = `release-preflight: read-only checks before applying the privacy release migrations.

Usage
  node scripts/release-preflight.mjs --db-url <conninfo URL> [--verify-after] [--json]
  PREFLIGHT_DATABASE_URL=<URL> node scripts/release-preflight.mjs [--verify-after] [--json]
  node scripts/release-preflight.mjs --offline [--json]             manifest/file checks only, no database
  node scripts/release-preflight.mjs --write-manifest --from <version> [--manifest <out>]
                                                                    regenerate the manifest (local scratch only)
  node scripts/release-preflight.mjs --merge-hashes <other.json> [--manifest <base>]
                                                                    add another major's hashes to a manifest

Options
  --db-url <url>     target connection string (postgresql://user:pass@host:port/db?sslmode=require).
                     Defaults to PREFLIGHT_DATABASE_URL. Ambient PG* variables are ignored, so the tool
                     only ever connects to the database you name. The URL and password are never printed.
  --verify-after     after the release: every manifest migration must be applied, and every protected
                     function/policy must match the md5 recorded from a full replay (expect_after).
  --offline          skip the database; check the manifest against the checkout only.
  --json             print the full report as JSON instead of the human summary.
  --manifest <path>  manifest to use or write (default ${DEFAULT_MANIFEST}).
  --root <dir>       repository checkout to read migrations from (default: this checkout).
  --write-manifest   regenerate the manifest from the checkout; needs --from <version>. Replays the
                     migrations into a throwaway database on the LOCAL Postgres used by bun run test:db
                     (PGHOST must be a unix socket or localhost) and drops it afterwards. Refuses --db-url.
                     The hashes are recorded for the local server's major only.
  --merge-hashes <p> copy the per-major hashes of manifest <p> (e.g. the PG17 CI artifact) into --manifest.
                     Refused unless both list exactly the same migrations, sha256s, protections and allow-lists.

What it checks (each failure exits 1 with a message)
  1. Manifest integrity: every release file is listed in apply order with the sha256 of its bytes; a
     changed or missing file, an unlisted file in the release range, a duplicate or out-of-order
     version all fail.
  2. Dependencies: each migration's declared requires (functions as regprocedure signatures, tables,
     schemas, earlier migrations) must exist in the target or be provided by an earlier pending entry.
  3. Ledger: reads ${LEDGER} (and ${DRIZZLE_LEDGER} for drizzle files) and prints the
     exact pending list. Applied versions must be a prefix of the manifest order (no gaps). Every ledger
     row, in or before the release range, must match a file in supabase/migrations or the drizzle journal
     (or the manifest's known_ledger_rows_without_file); every file before the range must have a ledger
     row unless the manifest lists it in known_unledgered.
  4. Protections: a pending migration that would overwrite a function or policy whose later definition
     is already applied fails. Every protected function and policy must be in a recognized state:
     absent or expect_before when all its defining migrations are pending, the recorded snapshot after the
     last applied definer when some are, expect_after when all are. Anything else is drift and fails.
     --verify-after requires every protection to equal expect_after.
  5. Server: the target must run Postgres ${SUPPORTED_MAJORS.join(" or ")} and have the ${LEDGER_SCHEMA}
     schema, and the manifest must carry hashes generated on the target's major. A missing major fails;
     md5s of deparsed definitions are never compared across majors.

Read-only guarantee
  Every query runs in one session with SET SESSION default_transaction_read_only = on inside
  BEGIN READ ONLY ... ROLLBACK, and the tool aborts unless transaction_read_only reports on.
  It never inserts into the ledger, never applies a migration and never runs a file's SQL against the
  target. Applying the release stays a manual, separately approved step (runbook sections 2 and 6).

Exit codes: 0 all checks passed, 1 a check failed, 2 usage or connection error.`;

// --------------------------------------------------------------------------------------------- files

/** All migrations in replay order, exactly as scripts/db-test.mjs orders them. */
export function migrationOrder(root = ROOT) {
  const rows = [];
  for (const file of readdirSync(join(root, "supabase/migrations"))) {
    if (!file.endsWith(".sql")) continue;
    const version = file.slice(0, 14);
    rows.push({
      key: `${version}a${file}`,
      version,
      source: "supabase",
      path: `supabase/migrations/${file}`,
      name: file.replace(/\.sql$/, ""),
    });
  }
  const journalPath = join(root, "drizzle/migrations/meta/_journal.json");
  if (existsSync(journalPath)) {
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    for (const entry of journal.entries) {
      const version = new Date(entry.when).toISOString().replace(/\D/g, "").slice(0, 14);
      rows.push({
        key: `${version}b${entry.tag}`,
        version,
        source: "drizzle",
        path: `drizzle/migrations/${entry.tag}.sql`,
        name: entry.tag,
        when: entry.when,
      });
    }
  }
  return rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export const sortKey = (e) =>
  `${e.version}${e.source === "drizzle" ? "b" : "a"}${String(e.path).split("/").pop()}`;

export function sha256File(abs) {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

const ident = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)`;
const unquote = (s) => (s.startsWith('"') ? s.slice(1, -1) : s.toLowerCase());

/** Functions (schema.name) and policies (schema|table|name) a migration file creates or alters. */
export function definitionsIn(text) {
  const body = stripComments(text);
  const functions = new Set();
  const policies = new Set();
  const fnRe = new RegExp(
    String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+(${ident})(?:\s*\.\s*(${ident}))?\s*\(`,
    "gi",
  );
  for (const m of body.matchAll(fnRe)) {
    const [schema, name] = m[2] ? [unquote(m[1]), unquote(m[2])] : ["public", unquote(m[1])];
    functions.add(`${schema}.${name}`);
  }
  const altFnRe = new RegExp(
    String.raw`\bALTER\s+(?:FUNCTION|PROCEDURE)\s+(${ident})(?:\s*\.\s*(${ident}))?`,
    "gi",
  );
  for (const m of body.matchAll(altFnRe)) {
    const [schema, name] = m[2] ? [unquote(m[1]), unquote(m[2])] : ["public", unquote(m[1])];
    functions.add(`${schema}.${name}`);
  }
  const polRe = new RegExp(
    String.raw`\b(?:CREATE|ALTER)\s+POLICY\s+(${ident})\s+ON\s+(${ident})(?:\s*\.\s*(${ident}))?`,
    "gi",
  );
  for (const m of body.matchAll(polRe)) {
    const [schema, table] = m[3] ? [unquote(m[2]), unquote(m[3])] : ["public", unquote(m[2])];
    policies.add(`${schema}|${table}|${unquote(m[1])}`);
  }
  return { functions, policies };
}

/** Literal arguments of to_regprocedure/to_regclass/to_regnamespace in a file's guard blocks. */
export function guardRequirements(text) {
  const body = stripComments(text);
  const out = { functions: [], tables: [], schemas: [] };
  const re = /\bto_(regprocedure|regclass|regnamespace)\s*\(\s*'([^']+)'\s*\)/gi; // a complete literal argument only (not 'public.' || _sig)
  for (const m of body.matchAll(re)) {
    const kind = { regprocedure: "functions", regclass: "tables", regnamespace: "schemas" }[
      m[1].toLowerCase()
    ];
    if (!out[kind].includes(m[2])) out[kind].push(m[2]);
  }
  return out;
}

const fnName = (sig) => sig.slice(0, sig.indexOf("("));
const policyKey = (p) => `${p.schema}|${p.table}|${p.policy}`;
export const majorOf = (serverVersionNum) => Math.floor(Number(serverVersionNum) / 10000);
/** The majors a manifest carries hashes for, as strings ("16", "17"). */
export const manifestMajors = (manifest) => Object.keys(manifest?.generated?.majors ?? {}).sort();

/** 14-digit migration version to epoch seconds (UTC), or NaN. */
function versionSeconds(v) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(v));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000 : Number.NaN;
}
const fileStem = (path) =>
  String(path)
    .split("/")
    .pop()
    .replace(/\.sql$/, "");

// ------------------------------------------------------------------------------ manifest integrity

export function loadManifest(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Static checks that need only the checkout. Returns { errors, warnings }. */
export function checkManifest(manifest, root = ROOT) {
  const errors = [];
  const warnings = [];
  const from = manifest?.release_range?.from;
  const entries = manifest?.migrations;
  if (!/^\d{14}$/.test(from ?? ""))
    errors.push("manifest: release_range.from must be a 14-digit version");
  if (!Array.isArray(entries) || entries.length === 0) {
    errors.push("manifest: migrations must be a non-empty list");
    return { errors, warnings };
  }

  const seenVersions = new Map();
  const seenPaths = new Set();
  entries.forEach((e, i) => {
    const where = `manifest entry #${i + 1} (${e.version ?? "?"} ${e.path ?? "?"})`;
    if (!/^\d{14}$/.test(e.version ?? "")) errors.push(`${where}: version must be 14 digits`);
    if (seenVersions.has(e.version))
      errors.push(
        `${where}: duplicate version ${e.version} (also entry #${seenVersions.get(e.version) + 1}); the ledger keys rows by version, so two files cannot share one`,
      );
    else seenVersions.set(e.version, i);
    if (seenPaths.has(e.path)) errors.push(`${where}: duplicate path`);
    seenPaths.add(e.path);
    if (from && e.version < from)
      errors.push(`${where}: version is before release_range.from ${from}`);
    if (i > 0 && sortKey(entries[i - 1]) > sortKey(e))
      errors.push(
        `${where}: out of order; it must come before ${entries[i - 1].version} ${entries[i - 1].path} (apply order is timestamp order)`,
      );
    const abs = join(root, e.path ?? "");
    if (!e.path || !existsSync(abs)) {
      errors.push(`${where}: file is missing from the checkout`);
      return;
    }
    const actual = sha256File(abs);
    if (actual !== e.sha256)
      errors.push(
        `${where}: sha256 mismatch: manifest ${String(e.sha256).slice(0, 12)}..., file ${actual.slice(0, 12)}... (the file changed after the manifest was approved)`,
      );
    const fileVersion = e.source === "drizzle" ? null : e.path.split("/").pop().slice(0, 14);
    if (fileVersion && fileVersion !== e.version)
      errors.push(`${where}: version does not match the file name`);
    for (const dep of e.requires?.migrations ?? []) {
      const j = entries.findIndex((x) => x.version === dep);
      if (j < 0 && from && dep >= from)
        errors.push(`${where}: requires migration ${dep}, which the manifest does not list`);
      else if (j >= i)
        errors.push(`${where}: requires migration ${dep}, which comes later in the manifest`);
    }
  });

  // Every file in the release range must be listed (a skipped file is a hard failure).
  if (from) {
    const listed = new Set(entries.map((e) => e.path));
    for (const m of migrationOrder(root)) {
      if (m.version >= from && !listed.has(m.path))
        errors.push(
          `unlisted migration in the release range: ${m.path} (version ${m.version}) is in the migrations folder but not in the manifest; it would be skipped`,
        );
    }
  }

  // Protections: definers must be manifest versions, in apply order.
  const order = new Map(entries.map((e, i) => [e.version, i]));
  for (const p of allProtections(manifest)) {
    const label = protectionLabel(p);
    const defs = p.defined_by ?? [];
    if (defs.length === 0) errors.push(`protection ${label}: defined_by is empty`);
    for (const v of defs)
      if (!order.has(v))
        errors.push(
          `protection ${label}: defined_by names ${v}, which is not a manifest migration`,
        );
    for (let k = 1; k < defs.length; k++)
      if (order.get(defs[k - 1]) > order.get(defs[k]))
        errors.push(`protection ${label}: defined_by is not in apply order`);
  }
  // Textual cross-check: a file that defines a protected object must be one of its definers.
  const byFn = new Map();
  const byPol = new Map();
  for (const p of manifest.protections?.functions ?? []) {
    const k = fnName(p.signature);
    byFn.set(k, [...(byFn.get(k) ?? []), p]);
  }
  for (const p of manifest.protections?.policies ?? []) byPol.set(policyKey(p), p);
  for (const e of entries) {
    if (!e.path || !existsSync(join(root, e.path))) continue;
    const defs = definitionsIn(readFileSync(join(root, e.path), "utf8"));
    for (const name of defs.functions)
      for (const p of byFn.get(name) ?? [])
        if (!(p.defined_by ?? []).includes(e.version))
          errors.push(
            `protection ${p.signature}: ${e.path} defines ${name} but is not in its defined_by; regenerate the manifest`,
          );
    for (const key of defs.policies) {
      const p = byPol.get(key);
      if (p && !(p.defined_by ?? []).includes(e.version))
        errors.push(
          `protection policy ${key}: ${e.path} defines it but is not in its defined_by; regenerate the manifest`,
        );
    }
  }

  // Format 2: per-major hashes with before/step/after states, and explicit allow-lists.
  if (manifest.format !== MANIFEST_FORMAT)
    errors.push(
      `manifest: format must be ${MANIFEST_FORMAT} (per-major expect_before/expect_steps/expect_after); regenerate it with --write-manifest`,
    );
  const majors = manifestMajors(manifest);
  if (majors.length === 0)
    errors.push("manifest: generated.majors is empty; it carries no hashes for any Postgres major");
  for (const mj of majors)
    if (!SUPPORTED_MAJORS.includes(Number(mj)))
      errors.push(`manifest: hashes for unsupported Postgres major ${mj}`);
  for (const p of allProtections(manifest)) {
    const label = protectionLabel(p);
    for (const mj of majors) {
      if (!(p.expect_before && mj in p.expect_before))
        errors.push(`protection ${label}: no expect_before for Postgres ${mj}`);
      if (!(p.expect_after && mj in p.expect_after) || p.expect_after[mj] === null)
        errors.push(`protection ${label}: no expect_after for Postgres ${mj}`);
      for (const v of p.defined_by ?? [])
        if (!(p.expect_steps?.[mj] && v in p.expect_steps[mj]))
          errors.push(`protection ${label}: no snapshot after ${v} for Postgres ${mj}`);
    }
  }
  const allFiles = migrationOrder(root);
  const filePaths = new Set(allFiles.map((m) => m.path));
  const fileVersions = new Set(allFiles.map((m) => m.version));
  const seenUnledgered = new Set();
  for (const k of manifest.known_unledgered ?? []) {
    const where = `known_unledgered ${k.path}`;
    if (seenUnledgered.has(k.path)) errors.push(`${where}: listed twice`);
    seenUnledgered.add(k.path);
    if (!filePaths.has(k.path) || !existsSync(join(root, k.path))) {
      errors.push(`${where}: no such migration file`);
      continue;
    }
    if (from && fileStem(k.path).slice(0, 14) >= from)
      errors.push(`${where}: is in the release range; only historical files may lack a ledger row`);
    if (sha256File(join(root, k.path)) !== k.sha256)
      errors.push(
        `${where}: sha256 differs from the file (the allow-list covers the reviewed bytes only)`,
      );
  }
  for (const k of manifest.known_ledger_rows_without_file ?? []) {
    const where = `known_ledger_rows_without_file ${k.version}`;
    if (!/^\d{14}$/.test(k.version ?? "") || typeof k.name !== "string")
      errors.push(`${where}: needs a 14-digit version and a name`);
    if (fileVersions.has(k.version))
      errors.push(`${where}: a migration file has this version, so it is not without a file`);
    if (k.evidence && !existsSync(join(root, k.evidence)))
      errors.push(`${where}: evidence ${k.evidence} is missing from the checkout`);
  }
  for (const k of manifest.known_drizzle_rows_without_file ?? [])
    if (!/^[0-9a-f]{64}$/.test(k.hash ?? "") || !/^\d+$/.test(String(k.created_at ?? "")))
      errors.push(
        `known_drizzle_rows_without_file: entry needs a sha256 hash and a numeric created_at`,
      );
  for (const c of manifest.drift_captures ?? [])
    if (!order.has(c.version))
      errors.push(`drift_captures: ${c.version} is not a manifest migration`);
  return { errors, warnings };
}

function allProtections(manifest) {
  return [
    ...(manifest.protections?.functions ?? []).map((p) => ({ ...p, kind: "function" })),
    ...(manifest.protections?.policies ?? []).map((p) => ({ ...p, kind: "policy" })),
  ];
}
function protectionLabel(p) {
  return p.kind === "function" ? p.signature : `policy ${p.policy} on ${p.schema}.${p.table}`;
}

// ------------------------------------------------------------------------------------ connection

/** Turns a connection URL into libpq environment variables (keeps the password out of argv). */
export function connEnvFromUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The database URL is not a valid URL (postgresql://user:pass@host:port/db).");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("The database URL must start with postgresql://");
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("PG")) env[k] = v;
  delete env.PREFLIGHT_DATABASE_URL;
  if (url.hostname) env.PGHOST = url.hostname.replace(/^\[|\]$/g, "");
  if (url.port) env.PGPORT = url.port;
  if (url.username) env.PGUSER = decodeURIComponent(url.username);
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  const db = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (db) env.PGDATABASE = db;
  const params = {
    host: "PGHOST",
    port: "PGPORT",
    user: "PGUSER",
    password: "PGPASSWORD",
    dbname: "PGDATABASE",
    sslmode: "PGSSLMODE",
    sslrootcert: "PGSSLROOTCERT",
    sslcert: "PGSSLCERT",
    sslkey: "PGSSLKEY",
    connect_timeout: "PGCONNECT_TIMEOUT",
    application_name: "PGAPPNAME",
    target_session_attrs: "PGTARGETSESSIONATTRS",
  };
  for (const [k, v] of url.searchParams) {
    if (!params[k]) throw new Error(`Unsupported connection parameter in the database URL: ${k}`);
    env[params[k]] = v;
  }
  if (!env.PGDATABASE) throw new Error("The database URL names no database.");
  const local =
    !env.PGHOST ||
    env.PGHOST.startsWith("/") ||
    ["localhost", "127.0.0.1", "::1"].includes(env.PGHOST);
  if (!env.PGSSLMODE && !local) env.PGSSLMODE = "require";
  env.PGCONNECT_TIMEOUT ??= "15";
  env.PGAPPNAME ??= "release-preflight (read-only)";
  return env;
}

// SQL string literal for a manifest value. Apostrophes are doubled (policy names such as "Guardians view their children's
// join requests" or "invitee can respond; admin can revoke" contain them); backslashes and control characters are refused. The session
// runs with standard_conforming_strings on (asserted in the read-only preamble), so doubling is the complete escape.
export const sqlLiteral = (s) => {
  if (typeof s !== "string" || /[\\\u0000-\u001f]/.test(s))
    throw new Error(`Refusing unsafe manifest value: ${JSON.stringify(s)}`);
  return `'${s.replaceAll("'", "''")}'`;
};
const lit = sqlLiteral;

/** Runs one SELECT returning a single JSON value, inside a read-only transaction. */
export function readOnlyQuery(env, select) {
  const script = `SET SESSION default_transaction_read_only = on;
BEGIN READ ONLY;
SET LOCAL search_path = '';
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL standard_conforming_strings = on;
SELECT json_build_object('read_only', current_setting('transaction_read_only'), 'v', (${select}));
ROLLBACK;
`;
  const r = spawnSync("psql", ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"], {
    input: script,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env,
  });
  if (r.error) throw new Error(`Could not run psql: ${r.error.message}`);
  if (r.status !== 0) {
    let msg = (r.stderr ?? "").trim().split("\n").slice(-6).join("\n");
    if (env.PGPASSWORD) msg = msg.split(env.PGPASSWORD).join("***");
    throw new Error(`Query against the target failed:\n${msg}`);
  }
  const out = JSON.parse(r.stdout.trim().split("\n").pop());
  if (out.read_only !== "on")
    throw new Error("The session did not report transaction_read_only = on; aborting.");
  return out.v;
}

// ------------------------------------------------------------------------------------- preflight

function requirementKey(kind, name) {
  return `${kind}:${name}`;
}

/** Collects everything the checks need from the target in two read-only round trips. */
export function readTarget(env, manifest) {
  const head = readOnlyQuery(
    env,
    `SELECT json_build_object(
       'server_version_num', current_setting('server_version_num')::int,
       'ledger_schema', to_regnamespace('${LEDGER_SCHEMA}') IS NOT NULL,
       'ledger', to_regclass('${LEDGER}') IS NOT NULL,
       'drizzle', to_regclass('${DRIZZLE_LEDGER}') IS NOT NULL)`,
  );
  const reqs = new Map();
  for (const e of manifest.migrations) {
    for (const f of e.requires?.functions ?? [])
      reqs.set(requirementKey("function", f), `to_regprocedure(${lit(f)}) IS NOT NULL`);
    for (const t of e.requires?.tables ?? [])
      reqs.set(requirementKey("table", t), `to_regclass(${lit(t)}) IS NOT NULL`);
    for (const s of e.requires?.schemas ?? [])
      reqs.set(requirementKey("schema", s), `to_regnamespace(${lit(s)}) IS NOT NULL`);
  }
  const reqSql = reqs.size
    ? `(SELECT json_object_agg(k, ok) FROM (VALUES ${[...reqs].map(([k, expr]) => `(${lit(k)}, ${expr})`).join(", ")}) v(k, ok))`
    : `'{}'::json`;
  const fns = manifest.protections?.functions ?? [];
  const fnSql = fns.length
    ? `(SELECT json_object_agg(sig, md5(pg_get_functiondef(to_regprocedure(sig)))) FROM (VALUES ${fns.map((p) => `(${lit(p.signature)})`).join(", ")}) v(sig))`
    : `'{}'::json`;
  const pols = manifest.protections?.policies ?? [];
  const polSql = pols.length
    ? `(SELECT json_object_agg(v.s || '|' || v.t || '|' || v.p,
          CASE WHEN pp.policyname IS NULL THEN NULL ELSE json_build_object('qual', md5(pp.qual), 'with_check', md5(pp.with_check),
               'shape', md5(pp.cmd || '|' || pp.permissive || '|' || pp.roles::text)) END)
        FROM (VALUES ${pols.map((p) => `(${lit(p.schema)}, ${lit(p.table)}, ${lit(p.policy)})`).join(", ")}) v(s, t, p)
        LEFT JOIN pg_policies pp ON pp.schemaname = v.s AND pp.tablename = v.t AND pp.policyname = v.p)`
    : `'{}'::json`;
  const body = readOnlyQuery(
    env,
    `SELECT json_build_object(
       'ledger_rows', ${head.ledger ? `(SELECT count(*) FROM ${LEDGER})` : "NULL"},
       'ledger_all', ${head.ledger ? `(SELECT coalesce(json_agg(json_build_object('version', s.version::text, 'name', to_jsonb(s)->>'name') ORDER BY s.version::text), '[]') FROM ${LEDGER} s)` : "'[]'::json"},
       'drizzle_rows', ${head.drizzle ? `(SELECT coalesce(json_agg(json_build_object('hash', hash, 'created_at', created_at::text)), '[]') FROM ${DRIZZLE_LEDGER})` : "'[]'::json"},
       'requirements', ${reqSql},
       'functions', ${fnSql},
       'policies', ${polSql})`,
  );
  const from = manifest.release_range.from;
  return {
    ...head,
    ...body,
    ledger_versions: (body.ledger_all ?? []).map((r) => r.version).filter((v) => v >= from),
  };
}

/** Same state: both absent, or equal md5 (function) / equal qual, with_check and shape (policy). */
export function sameState(a, b) {
  if (a === null || a === undefined || b === null || b === undefined)
    return (a ?? null) === (b ?? null);
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.qual === b.qual && a.with_check === b.with_check && a.shape === b.shape;
}
const showState = (s) =>
  s === null || s === undefined
    ? "absent"
    : typeof s === "string"
      ? `md5 ${s.slice(0, 12)}`
      : `qual ${String(s.qual).slice(0, 8)} with_check ${String(s.with_check).slice(0, 8)} shape ${String(s.shape).slice(0, 8)}`;

/** Ledger rows and files that the checks treat as known, built from the checkout and the manifest. */
function ledgerKnowledge(manifest, root) {
  const files = migrationOrder(root);
  const supabase = files.filter((f) => f.source === "supabase");
  const drizzle = files.filter((f) => f.source === "drizzle");
  for (const f of drizzle)
    f.sha256 = existsSync(join(root, f.path)) ? sha256File(join(root, f.path)) : null;
  // A Lovable-applied row: name is the file stem (or the part after the version) and the version is a
  // few seconds after the file's timestamp (docs/migration-history-reconciliation.md section 1).
  const nameMatch = (row, f) => {
    if (!row.name) return false;
    const name = String(row.name).replace(/\.sql$/, "");
    const stem = fileStem(f.path);
    if (name !== stem && name !== stem.slice(15)) return false;
    const skew = Math.abs(versionSeconds(row.version) - versionSeconds(f.version));
    return skew <= LEDGER_NAME_SKEW_SECONDS;
  };
  return {
    files,
    supabase,
    drizzle,
    nameMatch,
    supabaseVersions: new Set(supabase.map((f) => f.version)),
    drizzleVersions: new Set(drizzle.map((f) => f.version)),
    unledgered: new Set((manifest.known_unledgered ?? []).map((k) => k.path)),
  };
}

/** Pure evaluation of the checks against data read from the target. */
export function evaluate(manifest, target, { verifyAfter = false, root = ROOT } = {}) {
  const errors = [];
  const warnings = [];
  const entries = manifest.migrations;
  const from = manifest.release_range.from;

  // 5. server and ledger schema: fail closed on anything this tool was not built for
  const major = target.server_version_num ? majorOf(target.server_version_num) : null;
  if (!SUPPORTED_MAJORS.includes(major))
    errors.push(
      `unsupported Postgres major ${major ?? "(unknown)"} (server_version_num ${target.server_version_num ?? "?"}): the preflight supports ${SUPPORTED_MAJORS.join(" and ")} only; this is not a recognized production server`,
    );
  if (!target.ledger_schema)
    errors.push(
      `schema ${LEDGER_SCHEMA} does not exist in the target; this is not the expected database (a Supabase project always has its migration ledger)`,
    );
  else if (!target.ledger)
    errors.push(`ledger ${LEDGER} does not exist in the target; this is not the expected database`);

  const ledgerAll = target.ledger_all ?? [];
  const ledger = new Set(ledgerAll.map((r) => r.version).filter((v) => v >= from));
  const drizzleHashes = new Set((target.drizzle_rows ?? []).map((r) => r.hash));
  const drizzleWhen = new Set((target.drizzle_rows ?? []).map((r) => String(r.created_at)));
  const isApplied = (e) =>
    e.source === "drizzle"
      ? drizzleHashes.has(e.sha256) || drizzleWhen.has(String(e.when))
      : ledger.has(e.version);
  const applied = entries.filter(isApplied);
  const pending = entries.filter((e) => !isApplied(e));

  // 3. ledger rows the manifest and the checkout do not know about, in and before the release range
  const known = new Set(entries.filter((e) => e.source !== "drizzle").map((e) => e.version));
  const kn = ledgerKnowledge(manifest, root);
  const knownRowsWithoutFile = manifest.known_ledger_rows_without_file ?? [];
  if (target.ledger) {
    for (const row of ledgerAll) {
      const v = row.version;
      if (v >= from) {
        if (!known.has(v))
          errors.push(
            `ledger row ${v} is in the release range (>= ${from}) but not in the manifest: production has a migration this release does not know`,
          );
        continue;
      }
      const recognized =
        kn.supabaseVersions.has(v) ||
        kn.drizzleVersions.has(v) ||
        kn.supabase.some((f) => kn.nameMatch(row, f)) ||
        knownRowsWithoutFile.some((k) => k.version === v && k.name === row.name);
      if (!recognized)
        errors.push(
          `unknown ledger row ${v} (name ${JSON.stringify(row.name ?? null)}): no file in supabase/migrations or the drizzle journal has this version or name, and it is not in the manifest's known_ledger_rows_without_file; the target ran a migration this checkout does not have`,
        );
    }
    // every historical file must be ledgered unless the manifest names it as known-unledgered
    for (const f of kn.supabase) {
      if (f.version >= from) continue;
      const covered = ledgerAll.some((r) => r.version === f.version || kn.nameMatch(r, f));
      if (!covered && !kn.unledgered.has(f.path))
        errors.push(
          `unrecognized history: ${f.path} (before the release range) has no ledger row and is not in the manifest's known_unledgered list; the target is missing it or applied it unrecorded`,
        );
    }
  }
  for (const f of kn.drizzle) {
    if (f.version >= from) continue;
    const covered =
      (f.sha256 && drizzleHashes.has(f.sha256)) ||
      drizzleWhen.has(String(f.when)) ||
      ledgerAll.some((r) => r.version === f.version);
    if (!covered && !kn.unledgered.has(f.path))
      errors.push(
        target.drizzle
          ? `unrecognized history: ${f.path} (drizzle, before the release range) has no row in ${DRIZZLE_LEDGER} and is not in known_unledgered`
          : `unrecognized history: ${f.path} (drizzle) is in the journal but the target has no ${DRIZZLE_LEDGER}`,
      );
  }
  const journalHashes = new Set(kn.drizzle.map((f) => f.sha256));
  const journalWhen = new Set(kn.drizzle.map((f) => String(f.when)));
  for (const r of target.drizzle_rows ?? []) {
    const ok =
      journalHashes.has(r.hash) ||
      journalWhen.has(String(r.created_at)) ||
      (manifest.known_drizzle_rows_without_file ?? []).some(
        (k) => k.hash === r.hash && String(k.created_at) === String(r.created_at),
      );
    if (!ok)
      errors.push(
        `unknown ${DRIZZLE_LEDGER} row (created_at ${r.created_at}, hash ${String(r.hash).slice(0, 16)}...): matches no drizzle journal file and is not in known_drizzle_rows_without_file`,
      );
  }

  // 3. gaps: the applied set must be a prefix of the manifest order
  const firstPending = entries.findIndex((e) => !isApplied(e));
  if (firstPending >= 0)
    for (let j = firstPending + 1; j < entries.length; j++)
      if (isApplied(entries[j]))
        errors.push(
          `gap: ${entries[j].version} (${entries[j].path}) is applied but the earlier ${entries[firstPending].version} (${entries[firstPending].path}) is not; applying it now would run out of order`,
        );

  // 2. dependencies
  const order = new Map(entries.map((e, i) => [e.version, i]));
  const provided = { function: new Set(), table: new Set(), schema: new Set() };
  for (const e of entries) {
    const pendingNow = !isApplied(e);
    if (pendingNow) {
      for (const [kind, list] of [
        ["function", e.requires?.functions],
        ["table", e.requires?.tables],
        ["schema", e.requires?.schemas],
      ])
        for (const name of list ?? []) {
          const inTarget = target.requirements?.[requirementKey(kind, name)] === true;
          if (!inTarget && !provided[kind].has(name))
            errors.push(
              `missing dependency: ${e.version} (${e.path}) requires ${kind} ${name}, which is neither in the target nor provided by an earlier pending migration`,
            );
        }
      for (const dep of e.requires?.migrations ?? []) {
        const de = entries[order.get(dep)];
        if (de === undefined) {
          if (dep >= from)
            errors.push(
              `missing dependency: ${e.version} requires migration ${dep}, which is not in the manifest`,
            );
        } else if (order.get(dep) >= order.get(e.version)) {
          errors.push(
            `missing dependency: ${e.version} requires migration ${dep}, which comes later`,
          );
        }
      }
      for (const f of e.provides?.functions ?? []) provided.function.add(f);
      for (const t of e.provides?.tables ?? []) provided.table.add(t);
      for (const s of e.provides?.schemas ?? []) provided.schema.add(s);
    }
  }

  // 5 + 4. hashes are compared only on the major they were generated on
  const majors = manifestMajors(manifest);
  const mj = major === null ? null : String(major);
  const haveHashes = mj !== null && majors.includes(mj);
  const protectionList = allProtections(manifest);
  if (!haveHashes && protectionList.length)
    errors.push(
      `${verifyAfter ? "--verify-after" : "protections"}: the manifest's hashes were generated on Postgres ${majors.join(", ") || "(none)"}, the target runs ${major ?? "(unknown)"}. Deparsed definitions (pg_get_functiondef, policy expressions) can differ between majors, so ${protectionList.length} protected objects cannot be compared and the target's state is unrecognized. Use a manifest with hashes for ${major ?? "the target's major"} (the release-preflight CI artifact holds PG17 hashes; merge them with --merge-hashes).`,
    );
  const captures = new Set((manifest.drift_captures ?? []).map((c) => c.version));

  // 4. protections
  const protections = [];
  for (const p of protectionList) {
    const label = protectionLabel(p);
    const defs = p.defined_by ?? [];
    const defEntries = defs.map((v) => entries[order.get(v)]).filter(Boolean);
    const actual =
      p.kind === "function"
        ? (target.functions?.[p.signature] ?? null)
        : (target.policies?.[policyKey(p)] ?? null);
    const allApplied = defEntries.every(isApplied);

    defEntries.forEach((d, k) => {
      if (isApplied(d)) return;
      const laterApplied = defEntries.slice(k + 1).filter(isApplied);
      if (laterApplied.length)
        errors.push(
          `regression: pending ${d.version} (${d.path}) redefines ${label}, but the later definition from ${laterApplied.map((x) => x.version).join(", ")} is already applied; replaying the older file would overwrite the newer protection`,
        );
      const laterPending = defEntries.slice(k + 1).filter((x) => !isApplied(x));
      if (laterPending.length)
        warnings.push(
          `${label}: ${d.version} defines it and is superseded by ${laterPending.map((x) => x.version).join(", ")} later in this release; the final definition must be the one from ${defs[defs.length - 1]}`,
        );
    });

    const row = { kind: p.kind, name: label, actual, all_definers_applied: allApplied };
    protections.push(row);
    if (!haveHashes) continue;
    const before = p.expect_before?.[mj] ?? null;
    const expectedAfter = p.expect_after?.[mj] ?? null;
    const steps = p.expect_steps?.[mj] ?? {};
    row.expected = expectedAfter;
    row.matches = sameState(actual, expectedAfter);

    // Recognized states, from the ledger: before / after the last applied definer / after.
    let lastApplied = -1;
    defEntries.forEach((d, k) => {
      if (isApplied(d)) lastApplied = k;
    });
    const allowed = [];
    if (lastApplied < 0)
      allowed.push({
        state: before,
        why:
          before === null
            ? "absent (a pending migration creates it)"
            : `expect_before (its defining migrations ${defs.join(", ")} are all pending)`,
      });
    else if (allApplied)
      allowed.push({
        state: expectedAfter,
        why: `expect_after (every defining migration ${defs.join(", ")} is applied)`,
      });
    else
      allowed.push({
        state: steps[defs[lastApplied]] ?? null,
        why: `the snapshot after ${defs[lastApplied]}, the last applied of its defining migrations ${defs.join(", ")}`,
      });
    // A drift capture records a hand fix production already has; while it is the next pending definer the
    // target may already hold the captured definition (runbook section 1a).
    const nextDef = defs[lastApplied + 1];
    if (nextDef && captures.has(nextDef))
      allowed.push({
        state: steps[nextDef] ?? null,
        why: `the snapshot after drift capture ${nextDef} (the hand fix the capture records)`,
      });
    row.recognized = allowed.some((a) => sameState(actual, a.state));
    row.recognized_as = allowed.find((a) => sameState(actual, a.state))?.why ?? null;

    if (verifyAfter) {
      if (!row.matches)
        errors.push(
          `protection ${label} ${actual === null ? "is missing from the target" : `differs from expect_after (target ${showState(actual)}, expected ${showState(expectedAfter)})`}${allApplied ? `; every migration that defines it (${defs.join(", ")}) is applied, so the target has drifted or was regressed` : ""}`,
        );
    } else if (!row.recognized)
      errors.push(
        `unrecognized state: protection ${label} is ${showState(actual)} in the target, but the ledger says it must be ${allowed.map((a) => `${a.why} [${showState(a.state)}]`).join(" or ")}; the target has drifted or was regressed`,
      );
  }
  if (verifyAfter && pending.length)
    errors.push(
      `--verify-after: ${pending.length} manifest migration(s) are not applied yet (first: ${pending[0].version} ${pending[0].path})`,
    );

  return {
    errors,
    warnings,
    applied: applied.map((e) => ({ version: e.version, path: e.path })),
    pending: pending.map((e) => ({
      order: order.get(e.version) + 1,
      version: e.version,
      path: e.path,
      sha256: e.sha256,
    })),
    protections,
    hashes_major: haveHashes ? mj : null,
  };
}

// ---------------------------------------------------------------------------------- manifest write

// Extra needs from the runbook's section 2 and 16 "Needs" columns that the files do not guard.
// Names without arguments are resolved to every overload present before the migration runs.
const RUNBOOK_NEEDS = {
  20261103100000: {
    functions: ["public.bump_helpful_count"],
    tables: ["public.reviews", "public.review_helpfuls"],
  },
  20261103101000: {
    functions: ["public.try_uuid", "public.has_verified_gym_visit"],
    tables: ["public.trainer_orgs"],
  },
  20261103102000: {
    functions: ["public.is_moderator", "public.try_uuid"],
    tables: ["public.reviews"],
  },
  20261103103000: { functions: ["public.enforce_skill_vote"] },
  20261103104000: { functions: ["public.enforce_review_integrity"] },
  20261103110000: {
    functions: ["public.enforce_review_integrity", "public.player_trait_counts"],
    tables: ["public.reviews"],
  },
  20261103120000: { migrations: ["20261103110000"] },
  20261103130000: { tables: ["public.profiles"] },
  20261103140000: { tables: ["public.game_payment_settings", "public.payment_submissions"] },
  20261104100000: {
    functions: ["public.game_age_range_is_adult_only"],
    tables: [
      "public.hosted_games",
      "public.game_participants",
      "public.guardian_links",
      "public.payment_submissions",
      "public.app_settings",
    ],
  },
  20261104110000: { migrations: ["20261103140000"] },
  20261104120000: { migrations: ["20261103140000", "20261104110000"] },
  20261104140000: {
    functions: ["public.is_moderator"],
    migrations: ["20261104100000", "20261104130000"],
  },
  20261104150000: { migrations: ["20261104100000", "20261104130000"] },
  20261105100000: { migrations: ["20261104100000", "20261104130000"] },
  20261105110000: { migrations: ["20261104100000"] },
  20261105130000: {
    functions: ["public.is_moderator"],
    migrations: ["20261104130000", "20261104140000"],
  },
  20261105140000: { migrations: ["20261104110000", "20261104120000"] },
  20261106100000: { migrations: ["20261104120000", "20261104130000"] },
  20261106110000: { migrations: ["20261105140000"] },
  20261106130000: { migrations: ["20261105130000"] },
};

export async function writeManifest({ from, root = ROOT, manifestPath, log = console.log }) {
  const scratch = await import("./release-preflight-scratch.mjs");
  const all = migrationOrder(root);
  const range = all.filter((m) => m.version >= from);
  if (range.length === 0) throw new Error(`No migrations at or after ${from}.`);
  const before = all.filter((m) => m.version < from);
  const db = scratch.scratchName(`release_preflight_manifest_${process.pid}`);
  const stripMaintain = scratch.serverVersionNum() < 170000;
  const serverVersion = scratch.serverVersionNum();
  scratch.createDb(db);
  try {
    scratch.loadStub(db, root);
    for (const m of before) scratch.applyMigration(db, join(root, m.path), stripMaintain);
    log(
      `Replayed ${before.length} migrations before ${from}; recording the ${range.length} release migrations one at a time.`,
    );
    let prev = scratch.snapshot(db);
    const initial = prev;
    const stepSnaps = new Map();
    const entries = [];
    const fnChanged = new Map();
    const fnByName = new Map();
    const polByKey = new Map();
    const polChanged = new Map();
    for (const m of range) {
      const text = readFileSync(join(root, m.path), "utf8");
      // requires: guard-block literals plus the runbook's Needs, resolved against the state before this file
      const guard = guardRequirements(text);
      const extra = RUNBOOK_NEEDS[m.version] ?? {};
      const resolveFn = (name) => {
        const direct = readFn(prev, name);
        if (direct) return [direct];
        if (name.includes("(")) {
          // A guard may spell a type differently from the catalog (timestamptz vs "timestamp with time zone", int vs integer):
          // let the server canonicalize it with the same empty search_path the snapshot uses.
          const canonical = scratch
            .sql(
              db,
              `SET search_path = '';\nSELECT coalesce(to_regprocedure(${lit(name)})::text, '');`,
            )
            .trim()
            .split("\n")
            .pop();
          if (canonical && canonical in prev.functions) return [canonical];
        }
        const overloads = Object.keys(prev.functions).filter((s) => fnName(s) === name);
        if (!overloads.length)
          throw new Error(`${m.path}: required function ${name} does not exist before it runs`);
        return overloads;
      };
      const requires = {
        functions: [
          ...new Set([...guard.functions, ...(extra.functions ?? [])].flatMap(resolveFn)),
        ].sort(),
        tables: [...new Set([...guard.tables, ...(extra.tables ?? [])])].sort(),
        schemas: [...new Set(guard.schemas)].sort(),
        migrations: [...(extra.migrations ?? [])],
      };
      for (const t of requires.tables)
        if (!prev.relations.includes(t))
          throw new Error(`${m.path}: required table ${t} does not exist before it runs`);
      for (const s of requires.schemas)
        if (!prev.schemas.includes(s))
          throw new Error(`${m.path}: required schema ${s} does not exist before it runs`);

      scratch.applyMigration(db, join(root, m.path), stripMaintain);
      const next = scratch.snapshot(db);
      stepSnaps.set(m.version, next);
      const provides = {
        functions: Object.keys(next.functions)
          .filter((s) => !(s in prev.functions))
          .sort(),
        tables: next.relations.filter((r) => !prev.relations.includes(r)).sort(),
        schemas: next.schemas.filter((s) => !prev.schemas.includes(s)).sort(),
      };
      for (const [sig, md5] of Object.entries(next.functions))
        if (prev.functions[sig] !== md5)
          fnChanged.set(sig, [...(fnChanged.get(sig) ?? []), m.version]);
      for (const [key, v] of Object.entries(next.policies))
        if (JSON.stringify(prev.policies[key]) !== JSON.stringify(v))
          polChanged.set(key, [...(polChanged.get(key) ?? []), m.version]);
      // A file that textually (re)defines a name counts as a definer of every overload of it, even
      // one it later drops or replaces with a different signature (e.g. the two-argument approval
      // functions): replaying it would bring the old definition back.
      const textual = definitionsIn(text);
      for (const name of textual.functions)
        fnByName.set(name, [...(fnByName.get(name) ?? []), m.version]);
      for (const key of textual.policies)
        polByKey.set(key, [...(polByKey.get(key) ?? []), m.version]);

      const entry = {
        version: m.version,
        source: m.source,
        path: m.path,
        sha256: sha256File(join(root, m.path)),
      };
      if (m.source === "drizzle") entry.when = m.when;
      entry.requires = requires;
      entry.provides = provides;
      entries.push(entry);
      prev = next;
    }
    const finalState = prev;
    const inOrder = (versions) => [...new Set(versions)].sort();
    for (const sig of Object.keys(finalState.functions))
      if (fnByName.has(fnName(sig)))
        fnChanged.set(sig, [...(fnChanged.get(sig) ?? []), ...fnByName.get(fnName(sig))]);
    for (const key of Object.keys(finalState.policies))
      if (polByKey.has(key))
        polChanged.set(key, [...(polChanged.get(key) ?? []), ...polByKey.get(key)]);
    const major = String(majorOf(serverVersion));
    // Per-major states: before the range, after each defining migration, and after the whole range.
    const states = (kind, key, defined_by) => {
      const at = (snap) => snap[kind][key] ?? null;
      return {
        expect_before: { [major]: at(initial) },
        expect_steps: {
          [major]: Object.fromEntries(defined_by.map((v) => [v, at(stepSnaps.get(v))])),
        },
        expect_after: { [major]: at(finalState) },
      };
    };
    const functions = [...fnChanged]
      .filter(([sig]) => sig in finalState.functions)
      .map(([signature, defs]) => {
        const defined_by = inOrder(defs);
        return { signature, defined_by, ...states("functions", signature, defined_by) };
      })
      .sort((a, b) => a.signature.localeCompare(b.signature));
    const policies = [...polChanged]
      .filter(([key]) => key in finalState.policies)
      .map(([key, defs]) => {
        const defined_by = inOrder(defs);
        const [schema, table, policy] = key.split("|");
        return { schema, table, policy, defined_by, ...states("policies", key, defined_by) };
      })
      .sort((a, b) => policyKey(a).localeCompare(policyKey(b)));
    const known_unledgered = knownUnledgered(root, from);
    const manifest = {
      format: MANIFEST_FORMAT,
      description:
        "Privacy release migrations in apply order. Checked by scripts/release-preflight.mjs; regenerate with --write-manifest --from <version> and review the diff.",
      release_range: {
        from,
        chosen_because:
          "Runbook section 2 step 0a (20261103100000) is the first migration of the privacy release. Section 1's first unledgered file (20260915214000) is not used: the 71 files from 20260915214000 to 20261030120000 are already in production by catalog evidence but have no ledger rows, and 20260926155719 is ledgered after them, so a range starting there would always look like a gap and would list historical files as pending. Their ledger rows are a separate owner decision, and historical files must never be re-run.",
      },
      ledger: LEDGER,
      generated: {
        majors: { [major]: { server_version_num: serverVersion } },
        search_path: "",
        method:
          "full local replay (stub + every earlier migration), catalog snapshot before the range and after each release file; states are md5(pg_get_functiondef) and md5 of pg_policies qual/with_check/cmd+permissive+roles, keyed by Postgres major (null = absent). expect_before = before the range, expect_steps[v] = after defining migration v, expect_after = after the whole range. Hashes are never compared across majors; add another major with --merge-hashes.",
      },
      known_unledgered_basis:
        "Runbook section 1 / docs/migration-history-reconciliation.md section 3: these historical files are in production by catalog evidence (docs/migration-evidence/ledger-evidence.csv) but have no ledger row. Only they may lack one; the sha256 is the reviewed file.",
      known_unledgered,
      known_ledger_rows_without_file: KNOWN_LEDGER_ROWS_WITHOUT_FILE,
      known_drizzle_rows_without_file: KNOWN_DRIZZLE_ROWS_WITHOUT_FILE,
      drift_captures: DRIFT_CAPTURES.filter((c) => entries.some((e) => e.version === c.version)),
      migrations: entries.map((e, i) => ({ order: i + 1, ...e })),
      protections: { functions, policies },
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    log(
      `Wrote ${relative(process.cwd(), manifestPath)}: ${entries.length} migrations, ${functions.length} protected functions, ${policies.length} protected policies.`,
    );
    return manifest;
  } finally {
    scratch.dropDb(db);
  }
}

// Explicit allow-lists, each from the reconciliation record. Anything not listed here fails closed.
const KNOWN_LEDGER_ROWS_WITHOUT_FILE = [
  {
    version: "20260708185350",
    name: "20260708185348_97d89a2e-6e82-4a38-b870-5da2e718a847",
    evidence:
      "docs/migration-evidence/original-sources/20260708185348_97d89a2e-6e82-4a38-b870-5da2e718a847.sql.orig",
    basis:
      "docs/migration-history-reconciliation.md section 1 (Lovable commit c3288250; never re-run)",
  },
  {
    version: "20260725025124",
    name: "20260725025123_dc6f1a08-f936-4a43-9806-de61c4ed9c77",
    evidence:
      "docs/migration-evidence/original-sources/20260725025123_dc6f1a08-f936-4a43-9806-de61c4ed9c77.sql.orig",
    basis:
      "docs/migration-history-reconciliation.md section 1 (Lovable commit b1553001; never re-run)",
  },
];
const KNOWN_DRIZZLE_ROWS_WITHOUT_FILE = [
  {
    created_at: "1792495848439",
    hash: "b266e30fd6947963a6fbe8aa0eaac5e5d0de4e06c574ed5ad2dfe9ba1ad98292",
    basis:
      "docs/migration-history-reconciliation.md section 2 (0021_hide_team_posts_moderation_hidden_at.sql, commit f97dd5f8, origin/lovable-sync only)",
  },
];
// Release migrations that write down a hand fix production already has (runbook section 1a). Until one is
// applied, the target may already hold the definition it records.
const DRIFT_CAPTURES = [
  {
    version: "20261103101000",
    basis: "runbook 1a item 4: enforce_gym_review system-update bypass",
  },
  { version: "20261103102000", basis: "runbook 1a item 5: review_ring_suspects mean_rating alias" },
  { version: "20261103103000", basis: "runbook 1a item 6: enforce_skill_vote EXECUTE" },
  { version: "20261103104000", basis: "runbook 1a item 2: enforce_review_integrity EXECUTE" },
  {
    version: "20261103110000",
    basis:
      "runbook 1a item 1: structured reviews (enforce_review_integrity, player_trait_counts, review_question_keys, review_tag_keys)",
  },
];
const UNLEDGERED_CSV = "docs/migration-evidence/ledger-evidence.csv";

/** The reviewed list of historical files without ledger rows, with the sha256 the evidence was taken on. */
function knownUnledgered(root, from) {
  const csv = join(root, UNLEDGERED_CSV);
  if (!existsSync(csv))
    throw new Error(`${UNLEDGERED_CSV} is missing; known_unledgered cannot be built`);
  const out = [];
  for (const line of readFileSync(csv, "utf8").split("\n").slice(1)) {
    const m = /^\d+,([^,]+\.sql),([0-9a-f]{64}),/.exec(line);
    if (!m) continue;
    const path = `supabase/migrations/${m[1]}`;
    if (!existsSync(join(root, path))) throw new Error(`${UNLEDGERED_CSV}: ${path} does not exist`);
    if (sha256File(join(root, path)) !== m[2])
      throw new Error(`${UNLEDGERED_CSV}: ${path} changed since its evidence was taken`);
    if (m[1].slice(0, 14) >= from)
      throw new Error(`${UNLEDGERED_CSV}: ${path} is inside the release range ${from}`);
    out.push({ version: m[1].slice(0, 14), path, sha256: m[2] });
  }
  return out;
}

/** Copies another manifest's per-major hashes into the base manifest; everything else must be identical. */
export function mergeHashes(baseManifestPath, otherManifestPath) {
  const base = loadManifest(baseManifestPath);
  const other = loadManifest(otherManifestPath);
  const structure = (m) => {
    const c = structuredClone(m);
    delete c.generated?.majors;
    delete c.description;
    for (const p of [...(c.protections?.functions ?? []), ...(c.protections?.policies ?? [])]) {
      delete p.expect_before;
      delete p.expect_after;
      delete p.expect_steps;
    }
    return JSON.stringify(c);
  };
  if (base.format !== MANIFEST_FORMAT || other.format !== MANIFEST_FORMAT)
    throw new Error(`both manifests must be format ${MANIFEST_FORMAT}`);
  if (structure(base) !== structure(other))
    throw new Error(
      "the manifests differ in more than their hashes (migrations, sha256s, requires/provides, protections, defined_by or allow-lists); regenerate both from the same checkout",
    );
  const key = (p) => (p.signature ? `f:${p.signature}` : `p:${policyKey(p)}`);
  const otherBy = new Map(
    [...other.protections.functions, ...other.protections.policies].map((p) => [key(p), p]),
  );
  const added = manifestMajors(other);
  for (const p of [...base.protections.functions, ...base.protections.policies]) {
    const o = otherBy.get(key(p));
    for (const mj of added) {
      p.expect_before[mj] = o.expect_before[mj];
      p.expect_steps[mj] = o.expect_steps[mj];
      p.expect_after[mj] = o.expect_after[mj];
    }
  }
  for (const mj of added) base.generated.majors[mj] = other.generated.majors[mj];
  base.generated.majors = Object.fromEntries(
    Object.entries(base.generated.majors).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(baseManifestPath, `${JSON.stringify(base, null, 2)}\n`);
  return { majors: manifestMajors(base), added };
}

function readFn(snap, name) {
  return name.includes("(") ? (name in snap.functions ? name : null) : null;
}

// ------------------------------------------------------------------------------------------- main

export function runPreflight({
  manifestPath,
  root = ROOT,
  dbUrl,
  offline = false,
  verifyAfter = false,
}) {
  const manifest = loadManifest(manifestPath);
  const report = {
    ok: false,
    read_only: true,
    manifest: {
      path: relative(root, manifestPath) || manifestPath,
      from: manifest.release_range?.from,
      migrations: manifest.migrations?.length ?? 0,
    },
    errors: [],
    warnings: [],
  };
  const stat = checkManifest(manifest, root);
  report.errors.push(...stat.errors);
  report.warnings.push(...stat.warnings);
  if (offline) {
    report.target = null;
    report.ok = report.errors.length === 0;
    return report;
  }
  const env = connEnvFromUrl(dbUrl);
  const target = readTarget(env, manifest);
  const ev = evaluate(manifest, target, { verifyAfter, root });
  report.target = {
    server_version_num: target.server_version_num,
    hashes_major: ev.hashes_major,
    ledger_rows: target.ledger_rows,
    ledger_versions_in_range: target.ledger_versions,
    drizzle_ledger_rows: target.drizzle ? target.drizzle_rows.length : null,
  };
  report.applied = ev.applied;
  report.pending = ev.pending;
  report.protections = {
    checked: ev.protections.length,
    matching: ev.protections.filter((p) => p.matches === true).length,
    mismatched: ev.protections.filter((p) => p.matches !== true).map((p) => p.name),
    recognized: ev.protections.filter((p) => p.recognized === true).length,
    unrecognized: ev.protections.filter((p) => p.recognized !== true).map((p) => p.name),
  };
  report.errors.push(...ev.errors);
  report.warnings.push(...ev.warnings);
  report.ok = report.errors.length === 0;
  return report;
}

function printHuman(r, { verifyAfter }) {
  const out = [];
  out.push(
    `Release preflight (read-only) - manifest ${r.manifest.path}, ${r.manifest.migrations} migrations from ${r.manifest.from}`,
  );
  if (r.target) {
    out.push(
      `Target: Postgres ${r.target.server_version_num} (manifest hashes for this major: ${r.target.hashes_major ? "yes" : "NO"}), ledger rows ${r.target.ledger_rows ?? "(no ledger)"}, in release range ${r.target.ledger_versions_in_range.length}`,
    );
    out.push(
      `Applied (${r.applied.length}): ${r.applied.map((a) => a.version).join(" ") || "none"}`,
    );
    out.push(
      `Pending (${r.pending.length}), apply exactly in this order, one file per transaction with its ledger row:`,
    );
    for (const p of r.pending)
      out.push(
        `  ${String(p.order).padStart(2)}. ${p.version}  ${p.path}  sha256 ${p.sha256.slice(0, 16)}`,
      );
    out.push(
      `Protections: ${r.protections.recognized}/${r.protections.checked} in a recognized state for the ledger; ${r.protections.matching}/${r.protections.checked} equal expect_after${verifyAfter ? " (all required)" : ""}`,
    );
  } else out.push("Offline: no database checks were run.");
  if (r.warnings.length) {
    out.push(`\nWarnings (${r.warnings.length}):`);
    for (const w of r.warnings) out.push(`  - ${w}`);
  }
  if (r.errors.length) {
    out.push(`\nFAILED (${r.errors.length}):`);
    for (const e of r.errors) out.push(`  x ${e}`);
  } else
    out.push(
      `\nPASS: all checks passed.${r.target ? " Nothing was written to the target (read-only session)." : ""}`,
    );
  console.log(out.join("\n"));
}

function main(argv) {
  const flag = (n) => argv.includes(n);
  const option = (n) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (flag("--help") || flag("-h")) {
    console.log(HELP);
    return 0;
  }
  const root = resolve(option("--root") ?? ROOT);
  const manifestPath = resolve(root, option("--manifest") ?? DEFAULT_MANIFEST);
  if (flag("--write-manifest")) {
    if (option("--db-url") || process.env.PREFLIGHT_DATABASE_URL) {
      console.error(
        "--write-manifest uses a local scratch database only; unset --db-url / PREFLIGHT_DATABASE_URL.",
      );
      return 2;
    }
    const from = option("--from");
    if (!/^\d{14}$/.test(from ?? "")) {
      console.error("--write-manifest needs --from <14-digit version>.");
      return 2;
    }
    return writeManifest({ from, root, manifestPath }).then(
      () => 0,
      (e) => {
        console.error(e.message);
        return 1;
      },
    );
  }
  if (option("--merge-hashes")) {
    try {
      const r = mergeHashes(manifestPath, resolve(option("--merge-hashes")));
      console.log(
        `Merged Postgres ${r.added.join(", ")} hashes into ${manifestPath}; it now carries ${r.majors.join(", ")}.`,
      );
      return 0;
    } catch (e) {
      console.error(`--merge-hashes refused: ${e.message}`);
      return 1;
    }
  }
  const offline = flag("--offline");
  const dbUrl = option("--db-url") ?? process.env.PREFLIGHT_DATABASE_URL;
  if (!offline && !dbUrl) {
    console.error(
      "No target: pass --db-url <url> or set PREFLIGHT_DATABASE_URL (or --offline for file checks only). See --help.",
    );
    return 2;
  }
  if (!existsSync(manifestPath)) {
    console.error(`Manifest not found: ${manifestPath}`);
    return 2;
  }
  let report;
  try {
    report = runPreflight({
      manifestPath,
      root,
      dbUrl,
      offline,
      verifyAfter: flag("--verify-after"),
    });
  } catch (e) {
    const msg = dbUrl ? String(e.message).split(dbUrl).join("<db-url>") : e.message;
    if (flag("--json")) console.log(JSON.stringify({ ok: false, fatal: msg }, null, 2));
    else console.error(`Preflight could not run: ${msg}`);
    return 2;
  }
  if (flag("--json")) console.log(JSON.stringify(report, null, 2));
  else printHuman(report, { verifyAfter: flag("--verify-after") });
  return report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  Promise.resolve(main(process.argv.slice(2))).then((code) => process.exit(code));
}
