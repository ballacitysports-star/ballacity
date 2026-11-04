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

const HELP = `release-preflight: read-only checks before applying the privacy release migrations.

Usage
  node scripts/release-preflight.mjs --db-url <conninfo URL> [--verify-after] [--json]
  PREFLIGHT_DATABASE_URL=<URL> node scripts/release-preflight.mjs [--verify-after] [--json]
  node scripts/release-preflight.mjs --offline [--json]             manifest/file checks only, no database
  node scripts/release-preflight.mjs --write-manifest --from <version>  regenerate the manifest (local scratch only)

Options
  --db-url <url>     target connection string (postgresql://user:pass@host:port/db?sslmode=require).
                     Defaults to PREFLIGHT_DATABASE_URL. Ambient PG* variables are ignored, so the tool
                     only ever connects to the database you name. The URL and password are never printed.
  --verify-after     after the release: every manifest migration must be applied, and every protected
                     function/policy must match the md5 recorded from a full replay (expect_after).
  --offline          skip the database; check the manifest against the checkout only.
  --json             print the full report as JSON instead of the human summary.
  --manifest <path>  manifest to use (default ${DEFAULT_MANIFEST}).
  --root <dir>       repository checkout to read migrations from (default: this checkout).
  --write-manifest   regenerate the manifest from the checkout; needs --from <version>. Replays the
                     migrations into a throwaway database on the LOCAL Postgres used by bun run test:db
                     (PGHOST must be a unix socket or localhost) and drops it afterwards. Refuses --db-url.

What it checks (each failure exits 1 with a message)
  1. Manifest integrity: every release file is listed in apply order with the sha256 of its bytes; a
     changed or missing file, an unlisted file in the release range, a duplicate or out-of-order
     version all fail.
  2. Dependencies: each migration's declared requires (functions as regprocedure signatures, tables,
     schemas, earlier migrations) must exist in the target or be provided by an earlier pending entry.
  3. Ledger: reads ${LEDGER} (and ${DRIZZLE_LEDGER} for drizzle files) and prints the
     exact pending list. Applied versions must be a prefix of the manifest order (no gaps); a ledger
     row in the release range that the manifest does not know fails.
  4. Protections: a pending migration that would overwrite a function or policy whose later definition
     is already applied fails; protections whose every definer is applied must match expect_after;
     --verify-after compares all of them.

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
  const re = /\bto_(regprocedure|regclass|regnamespace)\s*\(\s*'([^']+)'/gi;
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

const lit = (s) => {
  if (typeof s !== "string" || /['\\;\n\r]/.test(s))
    throw new Error(`Refusing unsafe manifest value: ${JSON.stringify(s)}`);
  return `'${s}'`;
};

/** Runs one SELECT returning a single JSON value, inside a read-only transaction. */
export function readOnlyQuery(env, select) {
  const script = `SET SESSION default_transaction_read_only = on;
BEGIN READ ONLY;
SET LOCAL search_path = '';
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
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
       'ledger_versions', ${head.ledger ? `(SELECT coalesce(json_agg(version::text ORDER BY version::text), '[]') FROM ${LEDGER} WHERE version::text >= ${lit(manifest.release_range.from)})` : "'[]'::json"},
       'drizzle_rows', ${head.drizzle ? `(SELECT coalesce(json_agg(json_build_object('hash', hash, 'created_at', created_at::text)), '[]') FROM ${DRIZZLE_LEDGER})` : "'[]'::json"},
       'requirements', ${reqSql},
       'functions', ${fnSql},
       'policies', ${polSql})`,
  );
  return { ...head, ...body };
}

/** Pure evaluation of the checks against data read from the target. */
export function evaluate(manifest, target, { verifyAfter = false, root = ROOT } = {}) {
  const errors = [];
  const warnings = [];
  const entries = manifest.migrations;
  const from = manifest.release_range.from;

  if (!target.ledger)
    errors.push(`ledger ${LEDGER} does not exist in the target; this is not the expected database`);
  const ledger = new Set(target.ledger_versions ?? []);
  const drizzleHashes = new Set((target.drizzle_rows ?? []).map((r) => r.hash));
  const drizzleWhen = new Set((target.drizzle_rows ?? []).map((r) => String(r.created_at)));
  const isApplied = (e) =>
    e.source === "drizzle"
      ? drizzleHashes.has(e.sha256) || drizzleWhen.has(String(e.when))
      : ledger.has(e.version);
  const applied = entries.filter(isApplied);
  const pending = entries.filter((e) => !isApplied(e));

  // 3. ledger rows in the release range the manifest does not know about
  const known = new Set(entries.filter((e) => e.source !== "drizzle").map((e) => e.version));
  for (const v of ledger)
    if (!known.has(v))
      errors.push(
        `ledger row ${v} is in the release range (>= ${from}) but not in the manifest: production has a migration this release does not know`,
      );

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

  // 4. protections
  const protections = [];
  for (const p of allProtections(manifest)) {
    const label = protectionLabel(p);
    const defs = p.defined_by ?? [];
    const defEntries = defs.map((v) => entries[order.get(v)]).filter(Boolean);
    const actual =
      p.kind === "function"
        ? (target.functions?.[p.signature] ?? null)
        : (target.policies?.[policyKey(p)] ?? null);
    const expected = p.expect_after;
    const matches =
      p.kind === "function"
        ? actual === expected
        : actual !== null &&
          actual.qual === expected.qual &&
          actual.with_check === expected.with_check &&
          actual.shape === expected.shape;
    const allApplied = defEntries.every(isApplied);
    const row = {
      kind: p.kind,
      name: label,
      expected,
      actual,
      matches,
      all_definers_applied: allApplied,
    };
    protections.push(row);

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
    if (!matches && (verifyAfter || allApplied)) {
      const what =
        actual === null
          ? "is missing from the target"
          : `differs from expect_after (target ${p.kind === "function" ? String(actual).slice(0, 12) : JSON.stringify(actual)}, expected ${p.kind === "function" ? String(expected).slice(0, 12) : JSON.stringify(expected)})`;
      errors.push(
        `protection ${label} ${what}${allApplied ? `; every migration that defines it (${defs.join(", ")}) is applied, so the target has drifted or was regressed` : ""}`,
      );
    }
  }
  if (verifyAfter && pending.length)
    errors.push(
      `--verify-after: ${pending.length} manifest migration(s) are not applied yet (first: ${pending[0].version} ${pending[0].path})`,
    );

  const genVer = manifest.generated?.server_version_num;
  if (
    genVer &&
    target.server_version_num &&
    Math.floor(genVer / 10000) !== Math.floor(target.server_version_num / 10000)
  )
    warnings.push(
      `expect_after hashes were generated on Postgres ${Math.floor(genVer / 10000)}, the target runs ${Math.floor(target.server_version_num / 10000)}; a deparsed definition (BEGIN ATOMIC SQL bodies, policy expressions) can differ between majors`,
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
    const functions = [...fnChanged]
      .filter(([sig]) => sig in finalState.functions)
      .map(([signature, defs]) => ({
        signature,
        expect_after: finalState.functions[signature],
        defined_by: inOrder(defs),
      }))
      .sort((a, b) => a.signature.localeCompare(b.signature));
    const policies = [...polChanged]
      .filter(([key]) => key in finalState.policies)
      .map(([key, defs]) => {
        const defined_by = inOrder(defs);
        const [schema, table, policy] = key.split("|");
        return { schema, table, policy, expect_after: finalState.policies[key], defined_by };
      })
      .sort((a, b) => policyKey(a).localeCompare(policyKey(b)));
    const manifest = {
      format: 1,
      description:
        "Privacy release migrations in apply order. Checked by scripts/release-preflight.mjs; regenerate with --write-manifest --from <version> and review the diff.",
      release_range: {
        from,
        chosen_because:
          "Runbook section 2 step 0a (20261103100000) is the first migration of the privacy release. Section 1's first unledgered file (20260915214000) is not used: the 71 files from 20260915214000 to 20261030120000 are already in production by catalog evidence but have no ledger rows, and 20260926155719 is ledgered after them, so a range starting there would always look like a gap and would list historical files as pending. Their ledger rows are a separate owner decision, and historical files must never be re-run.",
      },
      ledger: LEDGER,
      generated: {
        server_version_num: serverVersion,
        search_path: "",
        method:
          "full local replay (stub + every earlier migration), catalog snapshot after each release file; expect_after = md5(pg_get_functiondef) and md5 of pg_policies qual/with_check/cmd+permissive+roles in the final state",
      },
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
    ledger_rows: target.ledger_rows,
    ledger_versions_in_range: target.ledger_versions,
    drizzle_ledger_rows: target.drizzle ? target.drizzle_rows.length : null,
  };
  report.applied = ev.applied;
  report.pending = ev.pending;
  report.protections = {
    checked: ev.protections.length,
    matching: ev.protections.filter((p) => p.matches).length,
    mismatched: ev.protections.filter((p) => !p.matches).map((p) => p.name),
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
      `Target: Postgres ${r.target.server_version_num}, ledger rows ${r.target.ledger_rows ?? "(no ledger)"}, in release range ${r.target.ledger_versions_in_range.length}`,
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
      `Protections: ${r.protections.matching}/${r.protections.checked} match expect_after${verifyAfter ? "" : " (only fully applied ones are enforced without --verify-after)"}`,
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
