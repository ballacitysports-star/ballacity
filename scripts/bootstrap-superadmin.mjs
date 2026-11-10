#!/usr/bin/env node
/**
 * Grants the superadmin role to one existing account, on purpose and on the record.
 *
 * Why this exists: the first superadmin was granted by migration 20260813172852,
 * which names one email address. That migration is production history, so it
 * stays. On a fresh database it inserts nothing because no accounts exist yet at
 * migration time. Every other environment (the E2E sandbox, a new staging project,
 * a rebuilt production) needs a deliberate way to make its first superadmin. Before
 * this script, the only way to do that was to write another migration naming a
 * person. See docs/superadmin-bootstrap.md.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/bootstrap-superadmin.mjs --email owner@example.com           # dry run
 *   ... node scripts/bootstrap-superadmin.mjs --email owner@example.com --apply
 *
 * Safety:
 *   - The default is a dry run. It prints what it would do and writes nothing.
 *   - The production project is refused unless --allow-production is also passed.
 *   - It only adds a role. It never removes or changes one.
 *   - The account must already exist. The script never creates one.
 *   - The service role key is read from the environment and never printed.
 */
import { pathToFileURL } from "node:url";

/** The live BallaCity project. Writing roles there needs a second, explicit flag. */
export const PRODUCTION_REF = "cpqihhcqeivbgxqbzatv";

const USAGE =
  "usage: node scripts/bootstrap-superadmin.mjs --email <address> [--apply] [--allow-production]";

/** Parses argv into options. Throws with the usage line on anything it does not recognise. */
export function parseArgs(argv) {
  const opts = { email: null, apply: false, allowProduction: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") opts.apply = true;
    else if (a === "--allow-production") opts.allowProduction = true;
    else if (a === "--email") opts.email = argv[++i] ?? null;
    else if (a.startsWith("--email=")) opts.email = a.slice("--email=".length);
    else throw new Error(`unknown argument ${JSON.stringify(a)}\n${USAGE}`);
  }
  opts.email = opts.email?.trim().toLowerCase() || null;
  if (!opts.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(opts.email)) {
    throw new Error(`--email <address> is required\n${USAGE}`);
  }
  return opts;
}

/**
 * The project ref from a Supabase URL (https://<ref>.supabase.co), or null for
 * any other host. Null counts as unknown, never as safe.
 */
export function projectRef(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  const m = /^([a-z0-9]{20})\.supabase\.co$/.exec(host);
  return m ? m[1] : null;
}

/**
 * Decides whether the run may go ahead, before any network call. Returns
 * { ok: true, ref } or { ok: false, reason }.
 */
export function preflight({ url, key, allowProduction }) {
  if (!url) return { ok: false, reason: "SUPABASE_URL is not set" };
  if (!key) return { ok: false, reason: "SUPABASE_SERVICE_ROLE_KEY is not set" };
  const ref = projectRef(url);
  if (!ref) {
    return {
      ok: false,
      reason: `SUPABASE_URL ${JSON.stringify(url)} is not a https://<ref>.supabase.co project URL`,
    };
  }
  if (ref === PRODUCTION_REF && !allowProduction) {
    return {
      ok: false,
      reason: `${ref} is production. Pass --allow-production as well if granting a superadmin there is intended.`,
    };
  }
  return { ok: true, ref };
}

/** Finds an account by email through the admin API, one page at a time. */
async function findUserByEmail(admin, email) {
  const perPage = 1000;
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listing accounts failed: ${error.message}`);
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < perPage) return null;
  }
  throw new Error("stopped after 100 pages of accounts without finding the address");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const gate = preflight({ url, key, allowProduction: opts.allowProduction });
  if (!gate.ok) throw new Error(gate.reason);

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`project ${gate.ref}${opts.apply ? "" : " (dry run: nothing will be written)"}`);
  const user = await findUserByEmail(admin, opts.email);
  if (!user) throw new Error(`no account with that email in ${gate.ref}; sign up first`);

  const { data: roles, error: readErr } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  if (readErr) throw new Error(`reading roles failed: ${readErr.message}`);
  const current = roles.map((r) => r.role).sort();
  console.log(`account ${user.id}: roles now [${current.join(", ")}]`);

  if (current.includes("superadmin")) {
    console.log("already a superadmin; nothing to do");
    return;
  }
  if (!opts.apply) {
    console.log("would add role superadmin. Re-run with --apply to write it.");
    return;
  }
  const { error: writeErr } = await admin
    .from("user_roles")
    .upsert(
      { user_id: user.id, role: "superadmin" },
      { onConflict: "user_id,role", ignoreDuplicates: true },
    );
  if (writeErr) throw new Error(`granting the role failed: ${writeErr.message}`);
  console.log("added role superadmin");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
