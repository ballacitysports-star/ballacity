/**
 * Starts the Vite dev server for E2E with EXACTLY the environment that
 * playwright.config.ts verified, and nothing inherited from the parent shell.
 *
 * Playwright's webServer always starts its command with `{ ...process.env, ...env }`,
 * so the shell's own SUPABASE_* variables would leak into the server, and
 * vite.config.ts would fill any unset one from .env.production (production). This
 * wrapper receives the verified environment as a JSON spec and starts Vite with
 * that and only that.
 *
 * It refuses to start without a spec, so running it by hand, or from a config that
 * did not verify anything, does nothing. It reads no Supabase project and prints no
 * value from the spec.
 *
 * See e2e/safety/dev-server.ts for how the spec is built.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

function refuse(message) {
  console.error(`[e2e dev server] refusing to start: ${message}`);
  process.exit(2);
}

let spec = null;
try {
  spec = JSON.parse(process.env.E2E_DEV_SERVER_SPEC ?? "null");
} catch {
  /* handled below */
}
if (
  !spec ||
  typeof spec.env !== "object" ||
  spec.env === null ||
  !Array.isArray(spec.args) ||
  !Array.isArray(spec.mustBeSet)
) {
  refuse(
    "no verified server environment was provided (E2E_DEV_SERVER_SPEC). Run `playwright test`; it starts this itself.",
  );
}
// Repeats PAYMENTS_VAR / PAYMENTS_PLACEHOLDER / LIVE_PAYMENTS_KEY from dev-server.ts (a test
// keeps them equal). vite.config.ts would otherwise fill the payments token from
// .env.production, which holds a live Stripe key.
const PAYMENTS_VAR = "VITE_PAYMENTS_CLIENT_TOKEN";
const PAYMENTS_PLACEHOLDER = "e2e-payments-disabled";
const LIVE_PAYMENTS_KEY = /(?:^|[^a-z0-9])(?:pk|sk|rk)_live_/i;
if (spec.env[PAYMENTS_VAR] !== PAYMENTS_PLACEHOLDER) {
  refuse(
    `${PAYMENTS_VAR} is not the E2E placeholder, so vite.config.ts could fill it from .env.production.`,
  );
}
for (const [name, value] of Object.entries(spec.env)) {
  if (LIVE_PAYMENTS_KEY.test(String(value))) refuse(`${name} holds a live payments key.`);
}
// The service role key is never serialized into the spec (Playwright writes webServer.env
// into its JSON report). A spec that carries one is refused.
if ("SUPABASE_SERVICE_ROLE_KEY" in spec.env) {
  refuse("the spec carries a service role key; it must come from the inherited environment.");
}
for (const name of spec.mustBeSet) {
  if (typeof spec.env[name] !== "string" || spec.env[name].trim() === "") {
    refuse(
      `${name} is not set in the verified environment, so vite.config.ts would fill it from .env.production.`,
    );
  }
}

// Vite does not export its bin file, so find it next to its package.json.
const vite = join(
  dirname(createRequire(import.meta.url).resolve("vite/package.json")),
  "bin",
  "vite.js",
);
// The key the guard validated is taken from THIS process's inherited environment, only
// when the spec says the verified environment had one.
const childEnv = { ...spec.env };
const inheritedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (
  spec.inheritServiceKey === true &&
  typeof inheritedKey === "string" &&
  inheritedKey.trim() !== ""
) {
  childEnv.SUPABASE_SERVICE_ROLE_KEY = inheritedKey.trim();
}
const child = spawn(process.execPath, [vite, ...spec.args], { env: childEnv, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
