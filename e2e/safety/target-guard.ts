/**
 * Fail-closed guard: E2E runs may only ever target a local Supabase or a project
 * that is explicitly designated as a non-production test sandbox.
 *
 * Why this exists. The E2E suite signs in as fixture accounts, seeds rows with the
 * service-role key and deletes rows it created. vite.config.ts falls back to the
 * production backend whenever the environment names none, so a run with a missing
 * or mistyped variable would aim all of that at production. The rules below refuse
 * to start unless every source of project identity agrees and names a safe target.
 *
 * Identity comes from the project reference, not from a label the developer
 * supplies. Each source is read independently and they must agree:
 *   - the Supabase URL (`<ref>.supabase.co`),
 *   - the project id variable,
 *   - the `ref` claim inside the publishable and service-role keys (JWT payloads
 *     Supabase signs; decoded only, never logged),
 *   - the issuer and storage key of a pre-injected browser session.
 *
 * Nothing in this file reads secrets out to a log: errors name project references
 * and hosts only.
 *
 * Enforced from playwright.config.ts (every `playwright test` run, whatever the
 * entry point) and again as the first statement of e2e/global-setup.ts.
 */

/** Project references that serve real users. Always blocked. */
export const PRODUCTION_PROJECT_REFS: readonly string[] = ["cpqihhcqeivbgxqbzatv"];

/**
 * Projects designated for E2E. Must never overlap PRODUCTION_PROJECT_REFS.
 * `olrbulvwexrkjcxddjxq` is the E2E sandbox named in supabase/config.e2e.toml and
 * docs/supabase-cli.md. Add a ref here only after confirming the project is not
 * production, and review that change like a security change.
 */
export const NON_PRODUCTION_E2E_PROJECT_REFS: readonly string[] = ["olrbulvwexrkjcxddjxq"];

/** Hosts the app under test may be served from. Everything else is refused. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export type Env = Record<string, string | undefined>;

export type E2eTarget = { kind: "local" } | { kind: "sandbox"; ref: string };

export class E2eTargetError extends Error {
  constructor(readonly reasons: string[]) {
    super(
      [
        "E2E refused to start: the test target is not a verified non-production backend.",
        "",
        ...reasons.map((r) => `  - ${r}`),
        "",
        "To run E2E, point BOTH the test process and the dev server at one of:",
        "  1. A local Supabase (`supabase start`): SUPABASE_URL / VITE_SUPABASE_URL=http://127.0.0.1:54321",
        "     with the local keys from `supabase status`.",
        "  2. The designated E2E sandbox project: set SUPABASE_URL, VITE_SUPABASE_URL,",
        "     SUPABASE_PROJECT_ID, VITE_SUPABASE_PROJECT_ID and the matching publishable key",
        "     (and, to seed fixtures, the service-role key) for that project, and serve the",
        "     app with the same values. Its reference must be listed in",
        "     NON_PRODUCTION_E2E_PROJECT_REFS in e2e/safety/target-guard.ts.",
        "Also serve the app from localhost (E2E_BASE_URL). Playwright starts the dev server itself,",
        "from exactly this environment, and refuses to use one that is already running: stop any dev server on that port first.",
        "There is deliberately no override flag. If a variable is unset, vite.config.ts",
        "falls back to the PRODUCTION backend, so an empty environment is refused too.",
      ].join("\n"),
    );
    this.name = "E2eTargetError";
  }
}

/**
 * Every project reference is compared in one canonical form, so casing can never
 * hide a production reference or make two sources look like they disagree.
 */
export function normalizeRef(ref: string): string {
  return ref.trim().toLowerCase();
}

const REF_SHAPE = /^[a-z0-9]{20}$/;
/** What a local Supabase instance may call itself (e.g. "local", "127"). Never an identity. */
const LOCAL_LABEL_SHAPE = /^[a-z0-9_-]{1,32}$/;

function present(v: string | undefined): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/** `<ref>` for https://<ref>.supabase.co, "local" for a local host, null if unknown. */
export function refFromSupabaseUrl(raw: string): string | "local" | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (LOCAL_HOSTS.has(host)) return "local";
  const m = /^([a-z0-9]{20})\.supabase\.(co|in)$/.exec(host);
  return m ? normalizeRef(m[1]) : null;
}

function decodePayload(token: string): Record<string, unknown> | null {
  const parts = token.trim().split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = decodeURIComponent(
      atob(padded)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );
    const obj = JSON.parse(json);
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The `ref` claim of a Supabase API key, or the project in an access token's issuer. */
export function refFromJwt(token: string): string | null {
  const p = decodePayload(token);
  if (!p) return null;
  if (typeof p.ref === "string" && p.ref.trim()) return normalizeRef(p.ref);
  if (typeof p.iss === "string") {
    const m = /^https:\/\/([a-z0-9]{20})\.supabase\.(co|in)\//i.exec(p.iss);
    if (m) return normalizeRef(m[1]);
  }
  return null;
}

/** `sb-<ref>-auth-token` -> `<ref>`. */
export function refFromStorageKey(key: string): string | null {
  const m = /^sb-([a-z0-9]{20})-auth-token$/i.exec(key.trim());
  return m ? normalizeRef(m[1]) : null;
}

function refFromInjectedSession(env: Env): string | null | undefined {
  const raw = env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
  if (!present(raw)) return undefined;
  try {
    const s = JSON.parse(raw) as { access_token?: unknown };
    return typeof s.access_token === "string" ? refFromJwt(s.access_token) : null;
  } catch {
    return null;
  }
}

/**
 * Base URLs the specs may drive. The suite writes real rows through the app it
 * loads, so a production site URL is as dangerous as a production database.
 */
export function checkBaseUrl(raw: string | undefined): string[] {
  const value = present(raw) ? raw : "http://localhost:8080";
  let host: string;
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return [`E2E_BASE_URL is not a valid URL.`];
  }
  if (LOCAL_HOSTS.has(host)) return [];
  return [
    `E2E_BASE_URL host "${host}" is not local. Run the suite against a dev server on localhost, never a deployed site.`,
  ];
}

export type Resolution = { ok: true; target: E2eTarget } | { ok: false; reasons: string[] };

const URL_VARS = ["SUPABASE_URL", "VITE_SUPABASE_URL"] as const;
const ID_VARS = ["SUPABASE_PROJECT_ID", "VITE_SUPABASE_PROJECT_ID"] as const;
const KEY_VARS = [
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

/**
 * Decide whether this environment may run E2E. Pure: reads only `env`.
 *
 * Both halves of the app read their own variables. The browser reads VITE_*, the
 * dev server's functions read SUPABASE_*, and vite.config.ts fills whichever is
 * unset from .env.production, which names production. So a target is accepted only
 * when BOTH URLs are set and agree. A remote target must also set BOTH project ids
 * and every source must name the same designated sandbox. A local target must have
 * both URLs local; a project id is then only a label, and is refused if it looks
 * like a real project reference.
 *
 * @param extraProductionRefs references documented elsewhere in the repo as
 *   production (see documentedProductionRefs); merged into the block list.
 */
export function resolveE2eTarget(
  env: Env,
  extraProductionRefs: readonly string[] = [],
): Resolution {
  const reasons: string[] = [];
  const production = new Set(
    [...PRODUCTION_PROJECT_REFS, ...extraProductionRefs].map(normalizeRef),
  );
  const sandboxes = new Set(NON_PRODUCTION_E2E_PROJECT_REFS.map(normalizeRef));

  for (const ref of sandboxes) {
    if (production.has(ref)) {
      reasons.push(
        `Project ${ref} is listed as both production and an E2E sandbox. Fix target-guard.ts.`,
      );
    }
  }

  reasons.push(...checkBaseUrl(env.E2E_BASE_URL));

  // --- URLs: both must be set. A missing one silently falls back to production. ---
  const setUrls = URL_VARS.filter((k) => present(env[k]));
  if (setUrls.length === 0) {
    reasons.push(
      "No Supabase URL is configured. The app would fall back to the production backend (vite.config.ts), so an unconfigured run is refused.",
    );
  } else {
    for (const k of URL_VARS) {
      if (!present(env[k])) {
        reasons.push(
          `${k} is not set. Both SUPABASE_URL (server functions) and VITE_SUPABASE_URL (browser) must be set: whichever is missing is filled in from .env.production, which names production.`,
        );
      }
    }
  }

  const claimed: Array<{ source: string; ref: string }> = [];
  let anyLocal = false;
  let anyRemote = false;
  for (const k of setUrls) {
    const ref = refFromSupabaseUrl(env[k]!);
    if (ref === "local") anyLocal = true;
    else if (ref) {
      anyRemote = true;
      claimed.push({ source: k, ref });
    } else {
      reasons.push(
        `${k} does not name a Supabase project the guard can identify (host is neither local nor <ref>.supabase.co).`,
      );
    }
  }
  if (anyLocal && anyRemote) {
    reasons.push("A local Supabase URL is set alongside a remote one. Use one or the other.");
  }
  // Local only when the URLs themselves say so; a project id can never make a target local.
  const localTarget = anyLocal && !anyRemote;

  // --- Project ids ---
  for (const k of ID_VARS) {
    if (!present(env[k])) continue;
    const id = normalizeRef(env[k]!);
    if (localTarget && !REF_SHAPE.test(id)) {
      // A local instance's own label (e.g. "local", "127"). It identifies nothing.
      if (!LOCAL_LABEL_SHAPE.test(id)) reasons.push(`${k} is not a valid local project label.`);
    } else {
      claimed.push({ source: k, ref: id });
    }
  }
  if (anyRemote && !anyLocal) {
    for (const k of ID_VARS) {
      if (!present(env[k])) {
        reasons.push(
          `${k} is not set. A remote target needs both SUPABASE_PROJECT_ID and VITE_SUPABASE_PROJECT_ID, matching its URL.`,
        );
      }
    }
  }

  // --- Keys carry a signed ref claim when they are JWTs ---
  for (const k of KEY_VARS) {
    if (!present(env[k])) continue;
    const ref = refFromJwt(env[k]!);
    if (ref) claimed.push({ source: `${k} (ref claim)`, ref });
    // Keys with no ref claim (local demo keys, newer opaque key formats) add nothing.
  }

  // --- A pre-injected browser session names its project too ---
  const session = refFromInjectedSession(env);
  if (session === null) {
    reasons.push(
      "LOVABLE_BROWSER_SUPABASE_SESSION_JSON is set but its project cannot be identified.",
    );
  } else if (session) claimed.push({ source: "injected browser session (issuer)", ref: session });
  if (present(env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY)) {
    const ref = refFromStorageKey(env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY!);
    if (ref) claimed.push({ source: "injected storage key", ref });
    else reasons.push("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY does not match sb-<ref>-auth-token.");
  }

  // 1. Production anywhere is final.
  for (const c of claimed) {
    if (production.has(c.ref)) {
      reasons.push(`${c.source} names the PRODUCTION project (${c.ref}).`);
    }
  }

  // 2. Every source must name one project.
  const refs = [...new Set(claimed.map((c) => c.ref))];
  if (refs.length > 1) {
    reasons.push(
      `The configured sources disagree about the project: ${claimed.map((c) => `${c.source}=${c.ref}`).join(", ")}.`,
    );
  }
  if (localTarget && refs.length > 0) {
    reasons.push(
      `A local Supabase URL is set alongside a remote project reference (${refs.join(", ")}). Remove it or use a local label such as "local".`,
    );
  }

  if (reasons.length > 0) return { ok: false, reasons };

  if (localTarget) return { ok: true, target: { kind: "local" } };

  // 3. Remote: one agreed reference, and it must be a designated sandbox.
  const ref = refs[0];
  if (!ref || !sandboxes.has(ref)) {
    reasons.push(`Project ${ref ?? "(unknown)"} is not a designated E2E sandbox.`);
    return { ok: false, reasons };
  }
  return { ok: true, target: { kind: "sandbox", ref } };
}

/** Throws E2eTargetError unless the environment names a safe target. Returns the target. */
export function assertSafeE2eTarget(
  env: Env,
  extraProductionRefs: readonly string[] = [],
): E2eTarget {
  const r = resolveE2eTarget(env, extraProductionRefs);
  if (!r.ok) throw new E2eTargetError(r.reasons);
  return r.target;
}

/**
 * Production references documented in the repo: `project_id` in supabase/config.toml
 * and the project id in .env.production. Merging them into the block list means a
 * production reference recorded there is blocked even if PRODUCTION_PROJECT_REFS
 * lags behind. `readText` returns a file's text or null.
 */
export function documentedProductionRefs(readText: (path: string) => string | null): string[] {
  const out = new Set<string>();
  const toml = readText("supabase/config.toml");
  const m1 = toml ? /^\s*project_id\s*=\s*"([a-z0-9]{20})"/im.exec(toml) : null;
  if (m1) out.add(normalizeRef(m1[1]));
  const env = readText(".env.production");
  if (env) {
    for (const m of env.matchAll(/^\s*(?:VITE_)?SUPABASE_PROJECT_ID\s*=\s*"?([a-z0-9]{20})"?/gm))
      out.add(normalizeRef(m[1]));
  }
  return [...out];
}

type FetchLike = (url: string) => Promise<{ ok: boolean; text(): Promise<string> }>;

/**
 * Looks at what the BROWSER half of the running app will talk to. The environment
 * checked above is the test process's; the dev server may have been started elsewhere
 * with different values. In dev, Vite serves the Supabase client module with its
 * environment inlined, so any `<ref>.supabase.co` it names is the project the
 * browser will use. Every reference found must equal the target, at least one must
 * be found, and a local target must find none. When `expect.publishableKey` is given
 * the served module must also contain that exact key (compared, never printed),
 * which ties the served build to this environment rather than to a look-alike.
 *
 * What this CANNOT see: the dev server's own process environment. Server functions
 * read SUPABASE_URL there (client.server.ts, auth-middleware.ts and the other
 * `process.env.SUPABASE_URL` readers), and no served file or endpoint reports it.
 * It is therefore not inferred from this check. playwright.config.ts starts the dev
 * server itself, with an exact environment, and global setup refuses to run unless
 * the config did so (e2e/safety/dev-server.ts). This check is the cross-check that
 * the server it started is serving that environment to the browser.
 */
export async function verifyServedAppTarget(
  baseUrl: string,
  target: E2eTarget,
  fetchText: FetchLike,
  expect: { publishableKey?: string } = {},
): Promise<void> {
  const base = baseUrl.replace(/\/+$/, "");
  const seen = new Set<string>();
  let sawLocal = false;
  let readAny = false;
  let keyMatched = false;
  const wantedKey = present(expect.publishableKey) ? expect.publishableKey.trim() : null;
  for (const path of ["/src/integrations/supabase/client.ts", "/"]) {
    try {
      const res = await fetchText(`${base}${path}`);
      if (!res.ok) continue;
      readAny = true;
      const body = await res.text();
      if (wantedKey && body.includes(wantedKey)) keyMatched = true;
      for (const m of body.matchAll(/https?:\/\/([a-z0-9]{20})\.supabase\.(?:co|in)/gi))
        seen.add(m[1].toLowerCase());
      if (/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(body) && /supabase/i.test(body))
        sawLocal = true;
    } catch {
      /* unreachable: handled below */
    }
  }
  const problems: string[] = [];
  if (!readAny) {
    problems.push(
      `Could not read the running app at ${base} to confirm which backend it uses. Start the dev server first (E2E_BASE_URL).`,
    );
  } else if (target.kind === "sandbox") {
    const others = [...seen].filter((r) => r !== target.ref);
    if (others.length > 0)
      problems.push(
        `The running app is configured for project ${others.join(", ")}, not ${target.ref}.`,
      );
    if (!seen.has(target.ref))
      problems.push(
        `The running app does not reference project ${target.ref}; its backend cannot be confirmed.`,
      );
  } else {
    if (seen.size > 0)
      problems.push(
        `The running app is configured for remote project ${[...seen].join(", ")}, but the test environment is local.`,
      );
    if (!sawLocal && seen.size === 0)
      problems.push(
        "The running app does not appear to use a local Supabase; its backend cannot be confirmed.",
      );
  }
  if (readAny && wantedKey && !keyMatched) {
    problems.push(
      "The running app was not built with the publishable key from this environment (VITE_SUPABASE_PUBLISHABLE_KEY). It may have been started from a different environment.",
    );
  }
  if (problems.length > 0) throw new E2eTargetError(problems);
}
