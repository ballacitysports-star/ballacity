/**
 * The dev server that E2E drives is started by Playwright itself, with an exact,
 * verified environment. It is never an already-running server somebody started
 * elsewhere.
 *
 * Why. The browser and the server read DIFFERENT variables:
 *   - the browser reads VITE_SUPABASE_* (inlined by vite.config.ts `define`);
 *   - server functions read process.env.SUPABASE_* (client.server.ts,
 *     auth-middleware.ts and the other readers in src/);
 *   - vite.config.ts fills any variable that is unset or empty from
 *     .env.production, which names PRODUCTION.
 * The test process cannot observe the dev server's own environment, so it cannot
 * check what the server functions will use. What it can do is decide that
 * environment: launch the server with every Supabase variable set explicitly and
 * consistently, and nothing else inherited from the parent shell.
 *
 * Playwright's webServer starts its command with `{ ...process.env, ...env }`, so
 * the parent shell's variables always leak through `env` alone. The command is
 * therefore e2e/safety/start-dev-server.mjs, which starts Vite with EXACTLY the
 * environment in the spec built here and nothing else.
 *
 * Nothing here contacts a Supabase project.
 */
import {
  E2eTargetError,
  normalizeRef,
  refFromSupabaseUrl,
  type E2eTarget,
  type Env,
} from "./target-guard";

/** The one command Playwright is allowed to run to start the dev server. */
export const DEV_SERVER_COMMAND = "node e2e/safety/start-dev-server.mjs";
/** The variable that carries the spec to the launcher. */
export const DEV_SERVER_SPEC_VAR = "E2E_DEV_SERVER_SPEC";

/** Placeholder for a local run that has no keys. Non-empty so .env.production cannot fill the gap. */
export const LOCAL_PLACEHOLDER_KEY = "e2e-local-placeholder-key-not-a-credential";

/**
 * Every variable the app reads to decide which Supabase project it talks to
 * (checked against src/ by a test, so a new reader fails the suite until it is
 * listed here). Each is set explicitly in the child environment or left unset.
 */
export const SERVER_URL_VAR = "SUPABASE_URL";
export const BROWSER_URL_VAR = "VITE_SUPABASE_URL";
export const SERVER_ID_VAR = "SUPABASE_PROJECT_ID";
export const BROWSER_ID_VAR = "VITE_SUPABASE_PROJECT_ID";
export const SERVER_KEY_VAR = "SUPABASE_PUBLISHABLE_KEY";
export const BROWSER_KEY_VAR = "VITE_SUPABASE_PUBLISHABLE_KEY";
export const SERVICE_ROLE_VAR = "SUPABASE_SERVICE_ROLE_KEY";
/** Read as a fallback by one server function; never inherited, never set. */
export const NEVER_SET_VARS = ["SUPABASE_ANON_KEY"] as const;

/** The variables .env.production would otherwise fill in. All must be non-empty in the child. */
export const MUST_BE_SET_VARS = [
  SERVER_URL_VAR,
  BROWSER_URL_VAR,
  SERVER_ID_VAR,
  BROWSER_ID_VAR,
  SERVER_KEY_VAR,
  BROWSER_KEY_VAR,
] as const;

export const KNOWN_SUPABASE_VARS: readonly string[] = [
  ...MUST_BE_SET_VARS,
  SERVICE_ROLE_VAR,
  ...NEVER_SET_VARS,
];

/**
 * What the dev server may inherit. Anything not listed is dropped, so no
 * stray credential, proxy trick or second Supabase variable reaches it.
 */
export const PASS_THROUGH_VARS: readonly string[] = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "TZ",
  "CI",
  "NODE_OPTIONS",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  // Windows needs these to start any process.
  "SystemRoot",
  "SYSTEMROOT",
  "ComSpec",
  "PATHEXT",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
];

export type DevServerSpec = {
  /** Arguments for `vite`. */
  args: string[];
  /** The complete environment of the dev server process. Nothing else is inherited. */
  env: Record<string, string>;
  /** Variables the launcher must find non-empty in `env` before it starts anything. */
  mustBeSet: string[];
};

function present(v: string | undefined): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/** `https://ref.supabase.co/` and `https://REF.supabase.co` are the same URL. */
export function canonicalUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

const LOCAL_LABEL = /^[a-z0-9_-]{1,32}$/;

/**
 * Builds the exact server environment from an environment the guard has already
 * accepted. It re-checks what only matters here: that the browser and server halves
 * are identical, not just aimed at the same project, and that nothing would be left
 * for .env.production to fill in. Throws E2eTargetError if not.
 */
export function buildDevServerSpec(env: Env, target: E2eTarget): DevServerSpec {
  const problems: string[] = [];
  const remote = target.kind === "sandbox";

  // --- URL: the same string for the browser and the server -----------------------
  const serverUrl = present(env[SERVER_URL_VAR]) ? canonicalUrl(env[SERVER_URL_VAR]!) : null;
  const browserUrl = present(env[BROWSER_URL_VAR]) ? canonicalUrl(env[BROWSER_URL_VAR]!) : null;
  if (!serverUrl)
    problems.push(
      `${SERVER_URL_VAR} is missing or not a URL: server functions would have no verified target.`,
    );
  if (!browserUrl)
    problems.push(
      `${BROWSER_URL_VAR} is missing or not a URL: the browser would have no verified target.`,
    );
  if (serverUrl && browserUrl && serverUrl !== browserUrl)
    problems.push(
      `${SERVER_URL_VAR} and ${BROWSER_URL_VAR} are different URLs. The browser and the server must use the same one.`,
    );

  // The URL must name exactly the project the guard verified (or a local instance).
  for (const [name, url] of [
    [SERVER_URL_VAR, serverUrl],
    [BROWSER_URL_VAR, browserUrl],
  ] as const) {
    if (!url) continue;
    const ref = refFromSupabaseUrl(url);
    const expected = remote ? target.ref : "local";
    if (ref !== expected)
      problems.push(
        `${name} does not name the verified target (${remote ? target.ref : "a local Supabase"}).`,
      );
  }

  // --- Project id -----------------------------------------------------------------
  let serverId = present(env[SERVER_ID_VAR]) ? normalizeRef(env[SERVER_ID_VAR]!) : null;
  let browserId = present(env[BROWSER_ID_VAR]) ? normalizeRef(env[BROWSER_ID_VAR]!) : null;
  if (remote) {
    if (!serverId)
      problems.push(`${SERVER_ID_VAR} is required to start a server for a remote target.`);
    if (!browserId)
      problems.push(`${BROWSER_ID_VAR} is required to start a server for a remote target.`);
    if (serverId && browserId && serverId !== browserId)
      problems.push(`${SERVER_ID_VAR} and ${BROWSER_ID_VAR} differ.`);
  } else {
    // A local instance's own label. Defaults to "local"; never an identity.
    serverId = serverId ?? browserId ?? "local";
    browserId = browserId ?? serverId;
    for (const [name, v] of [
      [SERVER_ID_VAR, serverId],
      [BROWSER_ID_VAR, browserId],
    ] as const) {
      if (!LOCAL_LABEL.test(v)) problems.push(`${name} is not a valid local project label.`);
    }
  }

  // --- Publishable key: one value for both halves ----------------------------------
  const serverKey = present(env[SERVER_KEY_VAR]) ? env[SERVER_KEY_VAR]!.trim() : null;
  const browserKey = present(env[BROWSER_KEY_VAR]) ? env[BROWSER_KEY_VAR]!.trim() : null;
  let key: string | null = serverKey ?? browserKey;
  if (serverKey && browserKey && serverKey !== browserKey) {
    problems.push(`${SERVER_KEY_VAR} and ${BROWSER_KEY_VAR} are different keys.`);
  }
  if (!key) {
    if (remote)
      problems.push(
        `${SERVER_KEY_VAR} and ${BROWSER_KEY_VAR} are required to start a server for a remote target.`,
      );
    else key = LOCAL_PLACEHOLDER_KEY;
  } else if (remote && (!serverKey || !browserKey)) {
    problems.push(`Both ${SERVER_KEY_VAR} and ${BROWSER_KEY_VAR} must be set for a remote target.`);
  }

  // --- Base URL / port for Vite -------------------------------------------------------
  let host = "localhost";
  let port = "8080";
  try {
    const b = new URL(present(env.E2E_BASE_URL) ? env.E2E_BASE_URL! : "http://localhost:8080");
    host = b.hostname.replace(/^\[|\]$/g, "");
    port = b.port || "8080";
  } catch {
    problems.push("E2E_BASE_URL is not a valid URL.");
  }

  if (problems.length > 0) throw new E2eTargetError(problems);

  // --- The child environment: allowlisted pass-through + the explicit set ------------
  const child: Record<string, string> = {};
  for (const name of PASS_THROUGH_VARS) {
    const v = env[name];
    if (typeof v === "string") child[name] = v;
  }
  child[SERVER_URL_VAR] = serverUrl!;
  child[BROWSER_URL_VAR] = browserUrl!;
  child[SERVER_ID_VAR] = serverId!;
  child[BROWSER_ID_VAR] = browserId!;
  child[SERVER_KEY_VAR] = key!;
  child[BROWSER_KEY_VAR] = key!;
  if (present(env[SERVICE_ROLE_VAR])) child[SERVICE_ROLE_VAR] = env[SERVICE_ROLE_VAR]!.trim();

  return {
    args: ["dev", "--host", host, "--port", port, "--strictPort"],
    env: child,
    mustBeSet: [...MUST_BE_SET_VARS],
  };
}

export type WebServerConfig = {
  command: string;
  url: string;
  reuseExistingServer: false;
  timeout: number;
  env: Record<string, string>;
};

/**
 * The Playwright `webServer` entry. `reuseExistingServer` is always false: a server
 * that was already running cannot be shown to use the verified environment, and
 * Playwright then refuses to start rather than adopt it.
 */
export function devServerWebServer(env: Env, target: E2eTarget): WebServerConfig {
  const spec = buildDevServerSpec(env, target);
  const base = present(env.E2E_BASE_URL) ? env.E2E_BASE_URL! : "http://localhost:8080";
  return {
    command: DEV_SERVER_COMMAND,
    url: base.endsWith("/") ? base : `${base}/`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { [DEV_SERVER_SPEC_VAR]: JSON.stringify(spec) },
  };
}

/**
 * For global setup: the running config must contain exactly the launcher entry this
 * module builds. A config that drops the webServer, reuses a server, or runs another
 * command is refused, because then nothing proves who started the dev server.
 */
export function assertLaunchedDevServer(webServer: unknown): void {
  const entries = Array.isArray(webServer) ? webServer : webServer ? [webServer] : [];
  const problems: string[] = [];
  if (entries.length !== 1) {
    problems.push(
      "The Playwright config does not start the dev server itself, so its Supabase environment is unverified.",
    );
  } else {
    const w = entries[0] as Partial<WebServerConfig>;
    if (w.command !== DEV_SERVER_COMMAND)
      problems.push("The dev server is not started by the E2E launcher.");
    if (w.reuseExistingServer !== false)
      problems.push("The config may reuse an already-running dev server.");
    try {
      const spec = JSON.parse(
        String(w.env?.[DEV_SERVER_SPEC_VAR] ?? "null"),
      ) as Partial<DevServerSpec> | null;
      const env = spec?.env;
      const ok =
        !!env &&
        MUST_BE_SET_VARS.every((n) => typeof env[n] === "string" && env[n].trim() !== "") &&
        spec.mustBeSet?.length === MUST_BE_SET_VARS.length;
      if (!ok) problems.push("The launcher spec does not set every Supabase variable explicitly.");
    } catch {
      problems.push("The launcher spec is unreadable.");
    }
  }
  if (problems.length > 0) throw new E2eTargetError(problems);
}
