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
        "Also serve the app from localhost (E2E_BASE_URL).",
        "There is deliberately no override flag. If a variable is unset, vite.config.ts",
        "falls back to the PRODUCTION backend, so an empty environment is refused too.",
      ].join("\n"),
    );
    this.name = "E2eTargetError";
  }
}

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
  return m ? m[1] : null;
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
  if (typeof p.ref === "string" && p.ref) return p.ref;
  if (typeof p.iss === "string") {
    const m = /^https:\/\/([a-z0-9]{20})\.supabase\.(co|in)\//.exec(p.iss);
    if (m) return m[1];
  }
  return null;
}

/** `sb-<ref>-auth-token` -> `<ref>`. */
export function refFromStorageKey(key: string): string | null {
  const m = /^sb-([a-z0-9]{20})-auth-token$/.exec(key.trim());
  return m ? m[1] : null;
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

/**
 * Decide whether this environment may run E2E. Pure: reads only `env`.
 *
 * @param extraProductionRefs references documented elsewhere in the repo as
 *   production (see documentedProductionRefs); merged into the block list.
 */
export function resolveE2eTarget(
  env: Env,
  extraProductionRefs: readonly string[] = [],
): Resolution {
  const reasons: string[] = [];
  const production = new Set([...PRODUCTION_PROJECT_REFS, ...extraProductionRefs]);
  const sandboxes = new Set(NON_PRODUCTION_E2E_PROJECT_REFS);

  for (const ref of sandboxes) {
    if (production.has(ref)) {
      reasons.push(
        `Project ${ref} is listed as both production and an E2E sandbox. Fix target-guard.ts.`,
      );
    }
  }

  reasons.push(...checkBaseUrl(env.E2E_BASE_URL));

  // Every place a project can be named, labelled by where it came from.
  const urls: Array<[string, string]> = [];
  for (const k of ["SUPABASE_URL", "VITE_SUPABASE_URL"])
    if (present(env[k])) urls.push([k, env[k]!]);
  const ids: Array<[string, string]> = [];
  for (const k of ["SUPABASE_PROJECT_ID", "VITE_SUPABASE_PROJECT_ID"])
    if (present(env[k])) ids.push([k, env[k]!.trim()]);
  const keys: Array<[string, string]> = [];
  for (const k of [
    "SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ])
    if (present(env[k])) keys.push([k, env[k]!]);

  const claimed: Array<{ source: string; ref: string }> = [];
  let sawLocalUrl = false;

  for (const [name, value] of urls) {
    const ref = refFromSupabaseUrl(value);
    if (ref === "local") sawLocalUrl = true;
    else if (ref) claimed.push({ source: name, ref });
    else
      reasons.push(
        `${name} does not name a Supabase project the guard can identify (host is neither local nor <ref>.supabase.co).`,
      );
  }
  for (const [name, value] of ids) claimed.push({ source: name, ref: value });
  for (const [name, value] of keys) {
    const ref = refFromJwt(value);
    if (ref) claimed.push({ source: `${name} (ref claim)`, ref });
    // Keys with no ref claim (local demo keys, newer opaque key formats) add nothing.
  }
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

  // 2. The remote sources must name one project, and it must be a designated sandbox.
  const refs = [...new Set(claimed.map((c) => c.ref))];
  if (refs.length > 1) {
    reasons.push(
      `The configured sources disagree about the project: ${claimed.map((c) => `${c.source}=${c.ref}`).join(", ")}.`,
    );
  }

  if (sawLocalUrl && refs.length > 0) {
    reasons.push(
      "A local Supabase URL is set alongside a remote project reference. Use one or the other.",
    );
  }

  if (reasons.length > 0) return { ok: false, reasons };

  if (sawLocalUrl) {
    // Every URL set must have been local, or it would have produced a ref above.
    return { ok: true, target: { kind: "local" } };
  }

  if (urls.length === 0) {
    reasons.push(
      "No Supabase URL is configured. The app would fall back to the production backend (vite.config.ts), so an unconfigured run is refused.",
    );
    return { ok: false, reasons };
  }

  const ref = refs[0];
  if (!ref || !sandboxes.has(ref)) {
    reasons.push(`Project ${ref ?? "(unknown)"} is not a designated E2E sandbox.`);
    return { ok: false, reasons };
  }

  // The URL named it; require at least one independent source to agree.
  const corroborated = claimed.some((c) => !c.source.endsWith("SUPABASE_URL"));
  if (!corroborated) {
    reasons.push(
      `Project ${ref} is named only by the URL. Also set SUPABASE_PROJECT_ID (or a key carrying a ref claim) so the identity is confirmed by a second source.`,
    );
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
  const m1 = toml ? /^\s*project_id\s*=\s*"([a-z0-9]{20})"/m.exec(toml) : null;
  if (m1) out.add(m1[1]);
  const env = readText(".env.production");
  if (env) {
    for (const m of env.matchAll(/^\s*(?:VITE_)?SUPABASE_PROJECT_ID\s*=\s*"?([a-z0-9]{20})"?/gm))
      out.add(m[1]);
  }
  return [...out];
}

type FetchLike = (url: string) => Promise<{ ok: boolean; text(): Promise<string> }>;

/**
 * Looks at what the RUNNING app will actually talk to. The environment checked
 * above is the test process's; the dev server may have been started elsewhere with
 * different values. In dev, Vite serves the Supabase client module with its
 * environment inlined, so any `<ref>.supabase.co` it names is the project the
 * browser will use. Every reference found must equal `expected`, and at least one
 * must be found; a local target must find none.
 */
export async function verifyServedAppTarget(
  baseUrl: string,
  target: E2eTarget,
  fetchText: FetchLike,
): Promise<void> {
  const base = baseUrl.replace(/\/+$/, "");
  const seen = new Set<string>();
  let sawLocal = false;
  let readAny = false;
  for (const path of ["/src/integrations/supabase/client.ts", "/"]) {
    try {
      const res = await fetchText(`${base}${path}`);
      if (!res.ok) continue;
      readAny = true;
      const body = await res.text();
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
  if (problems.length > 0) throw new E2eTargetError(problems);
}
