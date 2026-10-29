/**
 * Validation logic for the E2E target preflight. Importing this file never runs
 * anything: the CLI is .github/e2e-preflight.mjs, which calls run() unconditionally.
 * (An earlier design detected "am I the entrypoint" by comparing import.meta.url with
 * a hand-built file:// URL; that comparison silently failed for paths with spaces and
 * let the preflight exit 0 without checking anything. There is no such comparison now.)
 *
 * Why the preflight exists. vite.config.ts fills any unset or EMPTY Supabase variable
 * from .env.production (production) and bakes production literals into the client when
 * VITE_* is empty. So an E2E run whose secrets are missing would not fail: it would
 * quietly aim at production. The preflight refuses to continue unless the environment
 * names one project, consistently, that the repository owner has explicitly designated,
 * and that is not a production project.
 *
 * Modes (one per kind of workflow step):
 *   gate     all five E2E_* inputs. Runs first, before install/build/server/browser.
 *   runtime  steps that start or build the app. The E2E_* inputs except the service
 *            role key, plus the SUPABASE_* / VITE_SUPABASE_* values that step will use,
 *            which must equal the E2E_* values. The service role key must be ABSENT.
 *   service  the step that seeds fixtures. As runtime, plus SUPABASE_SERVICE_ROLE_KEY,
 *            which must equal E2E_SUPABASE_SERVICE_ROLE_KEY.
 *
 * It does NOT prove a project is isolated from production, and decoding a key does not
 * either: it proves a run cannot start unless the owner designated one project in
 * independent places and none of them is a known production reference. A key that is
 * not a readable JWT (e.g. sb_secret_*) exposes no project identity, so only equality
 * and the URL are checked for it. The owner still verifies the project in the Supabase
 * dashboard (docs/ci-security.md).
 *
 * Output rules: only check names and variable NAMES are printed. Never a value, a
 * reference, a host or any part of a key. No network access. No dependencies.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Known production project references. Documented repo references are added below. */
const BUILT_IN_PRODUCTION_REFS = ["cpqihhcqeivbgxqbzatv"];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const norm = (s) => String(s).trim().toLowerCase();
const blank = (v) => typeof v !== "string" || v.trim() === "";

/** Repository files are read relative to this file (.github/..), never the cwd. */
function readText(rel) {
  try {
    return readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
  } catch {
    return null;
  }
}

/** Production references written down in the repository itself. */
function documentedProductionRefs() {
  const out = new Set(BUILT_IN_PRODUCTION_REFS.map(norm));
  const toml = readText("supabase/config.toml");
  const m = toml ? /^\s*project_id\s*=\s*"([a-z0-9]{20})"/im.exec(toml) : null;
  if (m) out.add(norm(m[1]));
  const envFile = readText(".env.production");
  if (envFile) {
    for (const x of envFile.matchAll(
      /^\s*(?:VITE_)?SUPABASE_PROJECT_ID\s*=\s*"?([a-z0-9]{20})"?/gim,
    )) {
      out.add(norm(x[1]));
    }
  }
  return out;
}

/** Variables .env.production would seed: name -> value (values never printed). */
function documentedSeededVars() {
  const out = new Map();
  const text = readText(".env.production");
  if (!text) return out;
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m) out.set(m[1], m[2].trim().replace(/^(['"])(.*)\1$/, "$2"));
  }
  return out;
}

/** `https://<ref>.supabase.co` (optional trailing slash) -> ref, else null. */
function refFromUrl(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port || u.search || u.hash)
    return null;
  if (u.pathname !== "/" && u.pathname !== "") return null;
  const m = /^([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname.toLowerCase());
  return m ? m[1] : null;
}

/** The `ref` claim of a Supabase JWT key, or null when the key is not a readable JWT. */
function refFromJwt(token) {
  const parts = String(token).trim().split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload && typeof payload.ref === "string" && payload.ref.trim()
      ? norm(payload.ref)
      : null;
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {Set<string>} productionRefs
 * @param {"gate" | "runtime" | "service"} mode
 * @returns {string[]} names of failed checks. Empty means the target may proceed.
 */
export function preflight(env, productionRefs = documentedProductionRefs(), mode = "gate") {
  if (mode !== "gate" && mode !== "runtime" && mode !== "service") {
    return ["unknown preflight mode"];
  }
  const failures = [];
  const fail = (msg) => failures.push(msg);

  const needsServiceKey = mode !== "runtime";
  const required = [
    "E2E_SUPABASE_URL",
    "E2E_SUPABASE_PUBLISHABLE_KEY",
    "E2E_SUPABASE_PROJECT_ID",
    ...(needsServiceKey ? ["E2E_SUPABASE_SERVICE_ROLE_KEY"] : []),
    "E2E_SANDBOX_PROJECT_REF",
  ];
  if (mode !== "gate") {
    required.push(
      "SUPABASE_URL",
      "SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_PROJECT_ID",
      "VITE_SUPABASE_URL",
      "VITE_SUPABASE_PUBLISHABLE_KEY",
      "VITE_SUPABASE_PROJECT_ID",
    );
    if (mode === "service") required.push("SUPABASE_SERVICE_ROLE_KEY");
  }
  const missing = required.filter((n) => blank(env[n]));
  for (const n of missing) {
    fail(
      `${n} is missing or empty` +
        (n === "E2E_SANDBOX_PROJECT_REF"
          ? " (an environment variable, not a secret: the owner's explicit designation of the sandbox)"
          : ""),
    );
  }
  if (missing.length > 0) return failures; // nothing else can be checked reliably

  const urlRef = refFromUrl(env.E2E_SUPABASE_URL);
  if (!urlRef) fail("E2E_SUPABASE_URL is not a plain https://<project-ref>.supabase.co URL");

  const idRef = norm(env.E2E_SUPABASE_PROJECT_ID);
  const designated = norm(env.E2E_SANDBOX_PROJECT_REF);

  if (urlRef && idRef !== urlRef)
    fail("E2E_SUPABASE_PROJECT_ID does not match the project in E2E_SUPABASE_URL");
  if (urlRef && designated !== urlRef) {
    fail("E2E_SANDBOX_PROJECT_REF does not match the project in E2E_SUPABASE_URL");
  }
  if (idRef !== designated) fail("E2E_SUPABASE_PROJECT_ID does not match E2E_SANDBOX_PROJECT_REF");

  const refs = [urlRef, idRef, designated].filter(Boolean);
  if (refs.some((r) => productionRefs.has(r))) {
    fail("the configured target is a PRODUCTION project");
  }

  const keyNames = ["E2E_SUPABASE_PUBLISHABLE_KEY"];
  if (needsServiceKey) keyNames.push("E2E_SUPABASE_SERVICE_ROLE_KEY");
  for (const name of keyNames) {
    const claim = refFromJwt(env[name]);
    if (claim && urlRef && claim !== urlRef)
      fail(`${name} belongs to a different project than E2E_SUPABASE_URL`);
    if (claim && productionRefs.has(claim)) fail(`${name} belongs to a PRODUCTION project`);
  }
  // Where a key is a readable JWT its role must be the expected one.
  const roleOf = (t) => {
    try {
      const p = JSON.parse(Buffer.from(String(t).trim().split(".")[1], "base64url").toString());
      return typeof p?.role === "string" ? p.role : null;
    } catch {
      return null;
    }
  };
  const pubRole = roleOf(env.E2E_SUPABASE_PUBLISHABLE_KEY);
  if (pubRole && pubRole !== "anon") fail("E2E_SUPABASE_PUBLISHABLE_KEY is not an anon-role key");
  if (needsServiceKey) {
    const svcRole = roleOf(env.E2E_SUPABASE_SERVICE_ROLE_KEY);
    if (svcRole && svcRole !== "service_role")
      fail("E2E_SUPABASE_SERVICE_ROLE_KEY is not a service_role key");
    if (norm(env.E2E_SUPABASE_PUBLISHABLE_KEY) === norm(env.E2E_SUPABASE_SERVICE_ROLE_KEY)) {
      fail("E2E_SUPABASE_PUBLISHABLE_KEY and E2E_SUPABASE_SERVICE_ROLE_KEY are the same value");
    }
  }

  if (mode !== "gate") {
    // The values this step will actually use must be exactly the validated ones.
    for (const name of ["SUPABASE_URL", "VITE_SUPABASE_URL"]) {
      if (refFromUrl(env[name]) !== urlRef || norm(env[name]) !== norm(env.E2E_SUPABASE_URL))
        fail(`${name} does not match E2E_SUPABASE_URL`);
    }
    for (const name of ["SUPABASE_PROJECT_ID", "VITE_SUPABASE_PROJECT_ID"]) {
      if (norm(env[name]) !== idRef) fail(`${name} does not match E2E_SUPABASE_PROJECT_ID`);
    }
    for (const name of ["SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"]) {
      if (String(env[name]).trim() !== String(env.E2E_SUPABASE_PUBLISHABLE_KEY).trim())
        fail(`${name} does not match E2E_SUPABASE_PUBLISHABLE_KEY`);
    }
    if (mode === "service") {
      if (
        String(env.SUPABASE_SERVICE_ROLE_KEY).trim() !==
        String(env.E2E_SUPABASE_SERVICE_ROLE_KEY).trim()
      )
        fail("SUPABASE_SERVICE_ROLE_KEY does not match E2E_SUPABASE_SERVICE_ROLE_KEY");
    } else {
      // Build and server steps must not hold the privileged key under any name.
      for (const [name, value] of Object.entries(env)) {
        if (/SERVICE_ROLE|SERVICE_KEY|SECRET_KEY/i.test(name) && !blank(value))
          fail(`${name} must not be set in this step`);
      }
    }
    // vite.config.ts fills every variable that is unset OR EMPTY from .env.production,
    // not just the Supabase ones (it also holds a live payments key). So each such
    // variable must be set here, explicitly, to something other than the production
    // value. The Supabase ones are compared above.
    const validatedElsewhere = new Set([
      "SUPABASE_URL",
      "SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_PROJECT_ID",
      "VITE_SUPABASE_URL",
      "VITE_SUPABASE_PUBLISHABLE_KEY",
      "VITE_SUPABASE_PROJECT_ID",
    ]);
    for (const [name, prodValue] of documentedSeededVars()) {
      if (validatedElsewhere.has(name)) continue;
      if (blank(env[name])) {
        fail(`${name} is not set, so it would be seeded from .env.production`);
      } else if (prodValue && String(env[name]).trim() === prodValue) {
        fail(`${name} equals the production value in .env.production`);
      }
    }
    // A live payment key must never reach an E2E build, whatever it is called.
    for (const [name, value] of Object.entries(env)) {
      if (/(?:^|[^a-z0-9])(?:pk|sk|rk)_live_/i.test(String(value)))
        fail(`${name} holds a live payments key`);
    }

    // A browser-bundle variable must never carry the privileged key.
    if (needsServiceKey) {
      const svc = String(env.E2E_SUPABASE_SERVICE_ROLE_KEY).trim();
      for (const [name, value] of Object.entries(env)) {
        if (name.startsWith("VITE_") && String(value).trim() === svc)
          fail(`${name} carries the service role key`);
      }
    }
  }

  if (!blank(env.E2E_BASE_URL)) {
    let host = null;
    try {
      host = new URL(env.E2E_BASE_URL).hostname.toLowerCase();
    } catch {
      /* handled below */
    }
    if (!host || !LOCAL_HOSTS.has(host)) fail("E2E_BASE_URL is not a local address");
  }
  return failures;
}

const MODES = { "--runtime": "runtime", "--service": "service" };

/**
 * The CLI body. Returns an exit code and never throws: anything unexpected is a failure.
 * @param {string[]} args
 * @param {Record<string, string | undefined>} env
 * @param {{ out: (s: string) => void, err: (s: string) => void }} io
 */
export function run(args, env, io) {
  try {
    if (args.length > 1 || (args.length === 1 && !(args[0] in MODES))) {
      io.err("E2E preflight FAILED: unknown argument. Use no argument, --runtime or --service.");
      return 1;
    }
    const mode = args.length ? MODES[args[0]] : "gate";
    const failures = preflight(env, documentedProductionRefs(), mode);
    if (failures.length > 0) {
      io.err("E2E preflight FAILED. No browser, fixture or database step will run.\n");
      for (const f of failures) io.err(`  - ${f}`);
      io.err(
        "\nThis job needs the E2E_* secrets and the E2E_SANDBOX_PROJECT_REF variable in the e2e-sandbox\n" +
          "Environment, all naming one project the owner has verified as a non-production sandbox.\n" +
          "See docs/ci-security.md. No value was printed.",
      );
      return 1;
    }
    io.out(
      `E2E preflight (${mode}) passed: the configured target is consistent, designated and not production.`,
    );
    io.out(
      "This does not prove the project is isolated; the owner verifies that in the Supabase dashboard.",
    );
    return 0;
  } catch {
    io.err("E2E preflight FAILED: unexpected internal error (no value printed).");
    return 1;
  }
}
