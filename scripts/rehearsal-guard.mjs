#!/usr/bin/env node
// Rehearsal guard: run before EVERY sandbox step of docs/release/r4-staging-rehearsal.md.
//
//   SANDBOX_PROJECT_REF=<20-letter Supabase project ref> node scripts/rehearsal-guard.mjs
//
// It refuses (exit 1) unless SANDBOX_PROJECT_REF is set, is a well-formed Supabase project ref, is not a production
// identifier, and is listed in docs/release/verified-sandboxes.json with the owner's verification and sign-off. It
// also refuses when a Supabase URL or a readable JWT in the environment names a different project or a production one.
//
// It connects to nothing: no network, no database, no Supabase API. It reads only the environment and repository
// files, and prints only the sandbox ref and the names of failed checks, never another variable's value or a key.
// Passing the guard does not prove a project is isolated; the owner proves that in the Supabase dashboard
// (docs/release/sandbox-verification.md) and records it in the allow-list through a reviewed commit.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ALLOW_LIST = "docs/release/verified-sandboxes.json";

/**
 * Production identifiers. 9bd576a8-... is the Lovable project id of the production app; cpqihhcqeivbgxqbzatv is the
 * production Supabase project ref (runbook section 4, sandbox-verification.md). Refs written in supabase/config.toml
 * and .env.production are added at run time, because those files describe the production project.
 */
export const PRODUCTION_IDENTIFIERS = [
  "9bd576a8-703f-4180-84d6-2cd32f2a851b",
  "cpqihhcqeivbgxqbzatv",
];

const REF_FORMAT = /^[a-z]{20}$/;
const REQUIRED_ENTRY_FIELDS = ["project_ref", "verified_by", "verified_on", "owner_signoff"];
const norm = (s) =>
  String(s ?? "")
    .trim()
    .toLowerCase();

/** Production identifiers, including any documented in the checkout's production config files. */
export function productionIdentifiers(root = ROOT) {
  const out = new Set(PRODUCTION_IDENTIFIERS.map(norm));
  const read = (rel) => {
    const p = join(root, rel);
    try {
      return existsSync(p) ? readFileSync(p, "utf8") : null;
    } catch {
      return null;
    }
  };
  const toml = read("supabase/config.toml");
  const m = toml ? /^\s*project_id\s*=\s*"([a-z0-9]{20})"/im.exec(toml) : null;
  if (m) out.add(norm(m[1]));
  const env = read(".env.production");
  for (const x of (env ?? "").matchAll(
    /^\s*(?:VITE_)?SUPABASE_PROJECT_ID\s*=\s*"?([a-z0-9]{20})"?/gim,
  ))
    out.add(norm(x[1]));
  return out;
}

/** Reads the allow-list; anything but a JSON array is an error (fail closed). */
export function loadAllowList(path) {
  if (!existsSync(path)) throw new Error(`allow-list ${path} does not exist`);
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`allow-list ${path} must be a JSON array`);
  return parsed;
}

function jwtRef(value) {
  const parts = String(value).split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload?.ref === "string" ? norm(payload.ref) : null;
  } catch {
    return null;
  }
}

/** The project ref a Supabase API or database URL names (api host, db.<ref> host, or pooler user postgres.<ref>). */
function urlRef(value) {
  try {
    const url = new URL(String(value).trim());
    const host = url.hostname.toLowerCase();
    const m = /^(?:db\.)?([a-z0-9]+)\.supabase\.(co|in)$/.exec(host);
    if (m) return m[1];
    if (/\.pooler\.supabase\.com$/.test(host)) {
      const u = /\.([a-z0-9]{20})$/.exec(decodeURIComponent(url.username).toLowerCase());
      return u ? u[1] : "";
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Pure check. Returns { ok, ref, entry, failures } where failures are messages that never contain another
 * variable's value.
 */
export function checkSandbox({ ref, allowList, env = {}, production }) {
  const failures = [];
  const prod = production ?? new Set(PRODUCTION_IDENTIFIERS.map(norm));
  const r = norm(ref);
  if (!r) {
    failures.push("SANDBOX_PROJECT_REF is not set");
    return { ok: false, ref: null, entry: null, failures };
  }
  if (!REF_FORMAT.test(r))
    failures.push("SANDBOX_PROJECT_REF is not a Supabase project ref (20 lower-case letters)");
  for (const p of prod)
    if (r === p || r.includes(p) || p.includes(r))
      failures.push("SANDBOX_PROJECT_REF is a production identifier");

  // The allow-list itself must not name production, and every entry must be complete.
  let entry = null;
  if (!Array.isArray(allowList)) failures.push("the allow-list is not a list");
  else {
    if (allowList.length === 0)
      failures.push(
        `${ALLOW_LIST} is empty: no sandbox has been verified by the owner, so no sandbox step may run`,
      );
    for (const [i, e] of allowList.entries()) {
      const blob = norm(JSON.stringify(e));
      if ([...prod].some((p) => blob.includes(p)))
        failures.push(
          `allow-list entry #${i + 1} names a production identifier; the list is refused`,
        );
    }
    const matches = allowList.filter((e) => norm(e?.project_ref) === r);
    if (allowList.length && matches.length === 0)
      failures.push("SANDBOX_PROJECT_REF is not in the owner-verified allow-list");
    if (matches.length > 1) failures.push("SANDBOX_PROJECT_REF is listed more than once");
    if (matches.length === 1) {
      entry = matches[0];
      for (const f of REQUIRED_ENTRY_FIELDS)
        if (typeof entry[f] !== "string" || entry[f].trim() === "")
          failures.push(`allow-list entry for the sandbox has no ${f}`);
      if (entry.verified_on && !/^\d{4}-\d{2}-\d{2}$/.test(entry.verified_on))
        failures.push("allow-list entry verified_on must be YYYY-MM-DD");
      if (entry.revoked === true) failures.push("allow-list entry for the sandbox is revoked");
    }
  }

  // Nothing in the environment may point at another project: URLs and readable JWT claims must name the sandbox.
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== "string" || value === "" || name === "SANDBOX_PROJECT_REF") continue;
    const v = norm(value);
    if ([...prod].some((p) => v.includes(p)))
      failures.push(`environment variable ${name} contains a production identifier`);
    const u = /SUPABASE|_URL$/i.test(name) ? urlRef(value) : null;
    if (u && u !== r)
      failures.push(`environment variable ${name} is a Supabase URL for another project`);
    const j = jwtRef(value);
    if (j && j !== r) failures.push(`environment variable ${name} holds a key for another project`);
  }
  return { ok: failures.length === 0, ref: r, entry, failures: [...new Set(failures)] };
}

export function main({
  env = process.env,
  root = ROOT,
  log = console.log,
  error = console.error,
} = {}) {
  let allowList;
  try {
    allowList = loadAllowList(join(root, ALLOW_LIST));
  } catch (e) {
    error(`REFUSED: ${e.message}`);
    return 1;
  }
  const res = checkSandbox({
    ref: env.SANDBOX_PROJECT_REF,
    allowList,
    env,
    production: productionIdentifiers(root),
  });
  if (!res.ok) {
    error("REFUSED: this is not a verified sandbox. Do not run any rehearsal step.");
    for (const f of res.failures) error(`  x ${f}`);
    return 1;
  }
  log(
    `OK: sandbox ${res.ref} is on the owner-verified allow-list (verified by ${res.entry.verified_by} on ${res.entry.verified_on}). Nothing was contacted.`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main());
}
