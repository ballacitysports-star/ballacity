/**
 * Cutover probe: checks from OUTSIDE the database, the way an app user or a visitor would, that the privacy cutovers
 * F06, F07 and F08 are in effect on a Supabase project. Each check goes through the public REST and Storage APIs with
 * the publishable key, and with a signed-in test account where that matters. A masked view says nothing about what the
 * underlying table still lets anyone read, which is why these checks exist (audit F07/F08).
 *
 *   bun scripts/staging/cutover-probe.ts [--allow-writes] [--only F06,F07,F08] [--json]
 *
 * Environment (values are never printed):
 *   PROBE_SUPABASE_URL              https://<ref>.supabase.co, or a local Supabase (http://127.0.0.1:54321)
 *   PROBE_SUPABASE_PUBLISHABLE_KEY  the project's publishable (anon) key. A service-role or secret key is refused.
 *   PROBE_USER_JWT                  optional: an access token of an ordinary signed-in test account that hosts and
 *                                   plays in nothing and is not staff. Without it, only anonymous checks run.
 *   PROBE_HIDDEN_HOST_ID            optional: the account id of a host who is not a confirmed adult and who uploaded a
 *                                   custom game cover (a staging fixture). Enables the F08 storage-listing check.
 *
 * Reads only, by default. They are what any visitor or signed-in user can already do, so they may run against any
 * project, production included; output is counts and pass/fail, never row values, ids or keys.
 * --allow-writes adds the F06 upload attempt. It is refused unless the target is a local Supabase or a designated E2E
 * sandbox whose isolation the owner has recorded (e2e/safety/target-guard.ts, e2e/safety/sandbox-isolation.ts). Never
 * production. An upload that succeeds (switch still open) is deleted at once.
 *
 * Result per check: PASS (the protection holds), EXPOSED (it does not), ERROR (could not tell), SKIP.
 * Exit code: 0 all PASS or SKIP, 1 any EXPOSED or ERROR, 2 refused to run.
 * Before a cutover, EXPOSED is the expected baseline for that finding; run again after it.
 */
import {
  NON_PRODUCTION_E2E_PROJECT_REFS,
  PRODUCTION_PROJECT_REFS,
  isolationRecorded,
  normalizeRef,
  refFromSupabaseUrl,
} from "../../e2e/safety/target-guard";
import {
  VERIFIED_E2E_SANDBOX_ISOLATION,
  type SandboxIsolation,
} from "../../e2e/safety/sandbox-isolation";

export type Finding = "F06" | "F07" | "F08";
export type Status = "pass" | "exposed" | "error" | "skip";
export type CheckResult = { id: string; finding: Finding; status: Status; detail: string };

export type ProbeConfig = {
  url: string;
  publishableKey: string;
  userJwt?: string;
  hiddenHostId?: string;
  allowWrites?: boolean;
  only?: Finding[];
};

export type ProbeDeps = {
  fetch: typeof fetch;
  isolation?: Readonly<Record<string, SandboxIsolation>>;
  now?: () => number;
};

// ------------------------------------------------------------------------------------------------ target guard

function jwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.trim().split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const obj = JSON.parse(json);
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Why this configuration may not run (empty: it may). Never echoes a key or token. */
export function probeTargetProblems(
  cfg: ProbeConfig,
  isolation: Readonly<Record<string, SandboxIsolation>> = VERIFIED_E2E_SANDBOX_ISOLATION,
): string[] {
  const problems: string[] = [];
  const ref = cfg.url ? refFromSupabaseUrl(cfg.url) : null;
  if (!ref)
    problems.push(
      "PROBE_SUPABASE_URL is not a Supabase project URL (https://<ref>.supabase.co) or a local one.",
    );
  if (!cfg.publishableKey) problems.push("PROBE_SUPABASE_PUBLISHABLE_KEY is not set.");
  else if (
    /^sb_secret_/.test(cfg.publishableKey) ||
    jwtPayload(cfg.publishableKey)?.role === "service_role"
  )
    problems.push(
      "PROBE_SUPABASE_PUBLISHABLE_KEY is a service-role or secret key; the probe must act as a client.",
    );
  if (cfg.userJwt) {
    const p = jwtPayload(cfg.userJwt);
    if (!p || p.role !== "authenticated" || typeof p.sub !== "string")
      problems.push(
        "PROBE_USER_JWT is not an access token of a signed-in user (role authenticated).",
      );
    else if (ref && ref !== "local") {
      const iss =
        typeof p.iss === "string" ? refFromSupabaseUrl(p.iss.replace(/\/auth\/v1\/?$/, "")) : null;
      if (iss !== ref)
        problems.push("PROBE_USER_JWT was not issued by the project in PROBE_SUPABASE_URL.");
    }
  }
  if (cfg.allowWrites) {
    if (!cfg.userJwt)
      problems.push("--allow-writes needs PROBE_USER_JWT (the upload is made as that account).");
    if (ref && ref !== "local") {
      const r = normalizeRef(ref);
      const production = PRODUCTION_PROJECT_REFS.map(normalizeRef).includes(r);
      const designated = NON_PRODUCTION_E2E_PROJECT_REFS.map(normalizeRef).includes(r);
      if (production) problems.push("--allow-writes is refused against production.");
      else if (!designated)
        problems.push(
          "--allow-writes needs a designated E2E sandbox (e2e/safety/target-guard.ts).",
        );
      else if (!isolationRecorded(isolation[r]))
        problems.push(
          "--allow-writes needs the owner's isolation record for this sandbox (VERIFIED_E2E_SANDBOX_ISOLATION).",
        );
    }
  }
  return problems;
}

// ------------------------------------------------------------------------------------------------ helpers

/** Strip anything that looks like a token or key, and keep it short. */
export function sanitize(text: string): string {
  return text
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[token]")
    .replace(/sb_(publishable|secret)_[\w-]+/g, "[key]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[id]")
    .replace(/\s+/g, " ")
    .slice(0, 160);
}

type Who = "anon" | "user";

function headers(cfg: ProbeConfig, who: Who, extra: Record<string, string> = {}) {
  const bearer = who === "user" && cfg.userJwt ? cfg.userJwt : cfg.publishableKey;
  return { apikey: cfg.publishableKey, authorization: `Bearer ${bearer}`, ...extra };
}

async function body(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorText(b: unknown): string {
  if (b && typeof b === "object") {
    const o = b as Record<string, unknown>;
    return sanitize([o.code, o.error, o.message, o.statusCode].filter(Boolean).join(" "));
  }
  return sanitize(String(b));
}

/** A PostgREST read of one column: readable (EXPOSED), refused by privileges (PASS), or something else (ERROR). */
async function columnCheck(
  cfg: ProbeConfig,
  deps: ProbeDeps,
  who: Who,
  table: string,
  column: string,
): Promise<CheckResult> {
  const id = `F08 ${who} ${table}.${column}`;
  const res = await deps.fetch(`${cfg.url}/rest/v1/${table}?select=${column}&limit=1`, {
    headers: headers(cfg, who),
  });
  const b = await body(res);
  if (res.ok)
    return { id, finding: "F08", status: "exposed", detail: "column is readable through the API" };
  if ((res.status === 401 || res.status === 403) && (b as { code?: string })?.code === "42501")
    return { id, finding: "F08", status: "pass", detail: "permission denied (42501)" };
  return { id, finding: "F08", status: "error", detail: `HTTP ${res.status}: ${errorText(b)}` };
}

const F08_COLUMNS: Array<[string, string]> = [
  ["hosted_games", "host_id"],
  ["hosted_games", "image"],
  ["hosted_games", "host_snapshot"],
  ["join_requests", "host_id"],
  ["game_payment_settings", "host_id"],
  ["user_reports", "reported_id"],
  ["game_position_waitlist", "reviewed_by"],
];

const F08_VIEWS = ["hosted_games_public", "join_requests_visible", "game_payment_settings_visible"];

/** The coarse public label of a youth game (private_sec.coarse_game_label). */
export function coarseLabel(neighborhood: unknown): string {
  const n = typeof neighborhood === "string" ? neighborhood.trim() : "";
  return n !== "" ? n : "Location shared after you join";
}

/** At most two decimal places (round(x, 2) leaves it unchanged). */
export function roundedTo2(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return false;
  const frac = s.split(".")[1] ?? "";
  return frac.replace(/0+$/, "").length <= 2;
}

/** public.game_age_range_is_adult_only. */
export function adultOnly(minAge: unknown, maxAge: unknown): boolean {
  if (typeof minAge !== "number") return false;
  return (
    minAge >= 18 &&
    (maxAge === null || maxAge === undefined || (typeof maxAge === "number" && maxAge >= minAge))
  );
}

async function pagedRows(
  cfg: ProbeConfig,
  deps: ProbeDeps,
  who: Who,
  path: string,
  maxRows = 50_000,
): Promise<{ rows: Record<string, unknown>[] } | { error: string }> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < maxRows; from += 1000) {
    const res = await deps.fetch(`${cfg.url}/rest/v1/${path}`, {
      headers: headers(cfg, who, { range: `${from}-${from + 999}`, "range-unit": "items" }),
    });
    const b = await body(res);
    if (!res.ok || !Array.isArray(b)) return { error: `HTTP ${res.status}: ${errorText(b)}` };
    rows.push(...(b as Record<string, unknown>[]));
    if (b.length < 1000) break;
  }
  return { rows };
}

// ------------------------------------------------------------------------------------------------ checks

async function f08(cfg: ProbeConfig, deps: ProbeDeps): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const whos: Who[] = cfg.userJwt ? ["anon", "user"] : ["anon"];
  for (const who of whos)
    for (const [t, c] of F08_COLUMNS) out.push(await columnCheck(cfg, deps, who, t, c));
  if (!cfg.userJwt)
    out.push({
      id: "F08 user columns",
      finding: "F08",
      status: "skip",
      detail: "no PROBE_USER_JWT",
    });
  // the app's read paths must keep working after the cutover
  for (const view of F08_VIEWS) {
    const who: Who = cfg.userJwt ? "user" : "anon";
    const res = await deps.fetch(`${cfg.url}/rest/v1/${view}?select=*&limit=1`, {
      headers: headers(cfg, who),
    });
    const b = await body(res);
    out.push(
      res.ok
        ? {
            id: `F08 ${who} ${view} readable`,
            finding: "F08",
            status: "pass",
            detail: "the app's read view works",
          }
        : {
            id: `F08 ${who} ${view} readable`,
            finding: "F08",
            status: "error",
            detail: `HTTP ${res.status}: ${errorText(b)}`,
          },
    );
  }
  // storage: a hidden organizer's cover folder (its name is their account id) must not be listable by others
  if (cfg.userJwt && cfg.hiddenHostId) {
    const res = await deps.fetch(`${cfg.url}/storage/v1/object/list/game-covers`, {
      method: "POST",
      headers: headers(cfg, "user", { "content-type": "application/json" }),
      body: JSON.stringify({ prefix: `${cfg.hiddenHostId}/`, limit: 5, offset: 0 }),
    });
    const b = await body(res);
    out.push(
      !res.ok
        ? {
            id: "F08 user game-covers listing",
            finding: "F08",
            status: "error",
            detail: `HTTP ${res.status}: ${errorText(b)}`,
          }
        : Array.isArray(b) && b.length === 0
          ? {
              id: "F08 user game-covers listing",
              finding: "F08",
              status: "pass",
              detail: "the hidden host's cover folder lists nothing",
            }
          : {
              id: "F08 user game-covers listing",
              finding: "F08",
              status: "exposed",
              detail: `the hidden host's cover folder lists ${Array.isArray(b) ? b.length : "?"} object(s)`,
            },
    );
  } else
    out.push({
      id: "F08 user game-covers listing",
      finding: "F08",
      status: "skip",
      detail: "needs PROBE_USER_JWT and PROBE_HIDDEN_HOST_ID",
    });
  return out;
}

async function f07(cfg: ProbeConfig, deps: ProbeDeps): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  // anonymous visitors see adult-only games only
  const anon = await pagedRows(
    cfg,
    deps,
    "anon",
    "hosted_games?select=id,min_age,max_age&order=id",
  );
  if ("error" in anon)
    out.push({
      id: "F07 anon youth games hidden",
      finding: "F07",
      status: "error",
      detail: anon.error,
    });
  else {
    const youth = anon.rows.filter((r) => !adultOnly(r.min_age, r.max_age)).length;
    out.push({
      id: "F07 anon youth games hidden",
      finding: "F07",
      status: youth === 0 ? "pass" : "exposed",
      detail: `${anon.rows.length} game(s) visible, ${youth} youth-inclusive`,
    });
  }
  if (!cfg.userJwt) {
    out.push({
      id: "F07 user youth locations coarse",
      finding: "F07",
      status: "skip",
      detail: "no PROBE_USER_JWT",
    });
    out.push({
      id: "F07 user private locations hidden",
      finding: "F07",
      status: "skip",
      detail: "no PROBE_USER_JWT",
    });
    return out;
  }
  // a signed-in account that is not involved sees only the coarse form of a youth game's location
  const user = await pagedRows(
    cfg,
    deps,
    "user",
    "hosted_games?select=id,location,lat,lng,neighborhood,min_age,max_age&order=id",
  );
  if ("error" in user)
    out.push({
      id: "F07 user youth locations coarse",
      finding: "F07",
      status: "error",
      detail: user.error,
    });
  else {
    const youth = user.rows.filter((r) => !adultOnly(r.min_age, r.max_age));
    const exact = youth.filter(
      (r) => r.location !== coarseLabel(r.neighborhood) || !roundedTo2(r.lat) || !roundedTo2(r.lng),
    ).length;
    out.push({
      id: "F07 user youth locations coarse",
      finding: "F07",
      status: exact === 0 ? "pass" : "exposed",
      detail: `${youth.length} youth-inclusive game(s) visible, ${exact} with an exact location in public columns`,
    });
  }
  // and nothing from the private exact-location table
  const priv = await deps.fetch(`${cfg.url}/rest/v1/hosted_game_private?select=game_id&limit=1`, {
    headers: headers(cfg, "user"),
  });
  const pb = await body(priv);
  out.push(
    priv.ok && Array.isArray(pb) && pb.length === 0
      ? {
          id: "F07 user private locations hidden",
          finding: "F07",
          status: "pass",
          detail: "no exact locations readable",
        }
      : priv.ok
        ? {
            id: "F07 user private locations hidden",
            finding: "F07",
            status: "exposed",
            detail:
              "exact locations readable by an uninvolved account (or the probe account is involved in a game)",
          }
        : (priv.status === 401 || priv.status === 403) &&
            (pb as { code?: string })?.code === "42501"
          ? {
              id: "F07 user private locations hidden",
              finding: "F07",
              status: "pass",
              detail: "permission denied (42501)",
            }
          : {
              id: "F07 user private locations hidden",
              finding: "F07",
              status: "error",
              detail: `HTTP ${priv.status}: ${errorText(pb)}`,
            },
  );
  return out;
}

const PNG_1X1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

async function f06(cfg: ProbeConfig, deps: ProbeDeps): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  // the switches are server-only settings
  for (const who of (cfg.userJwt ? ["anon", "user"] : ["anon"]) as Who[]) {
    const res = await deps.fetch(
      `${cfg.url}/rest/v1/app_settings?select=key&key=in.(image_direct_uploads,youth_location_privacy)`,
      { headers: headers(cfg, who) },
    );
    const b = await body(res);
    out.push(
      res.ok && Array.isArray(b) && b.length === 0
        ? {
            id: `F06 ${who} switches not readable`,
            finding: "F06",
            status: "pass",
            detail: "no rows",
          }
        : res.ok
          ? {
              id: `F06 ${who} switches not readable`,
              finding: "F06",
              status: "exposed",
              detail: `${Array.isArray(b) ? b.length : "?"} row(s) readable`,
            }
          : {
              id: `F06 ${who} switches not readable`,
              finding: "F06",
              status: "error",
              detail: `HTTP ${res.status}: ${errorText(b)}`,
            },
    );
  }
  if (!cfg.allowWrites) {
    out.push({
      id: "F06 user direct upload refused",
      finding: "F06",
      status: "skip",
      detail: "writes not allowed (--allow-writes)",
    });
    return out;
  }
  // a signed-in client uploading straight into a public image bucket must be refused by the closed switch
  const sub = String(jwtPayload(cfg.userJwt as string)?.sub);
  const stamp = (deps.now ?? Date.now)();
  for (const bucket of ["avatars", "covers"]) {
    const path = `${sub}/cutover-probe-${stamp}.png`;
    const res = await deps.fetch(`${cfg.url}/storage/v1/object/${bucket}/${path}`, {
      method: "POST",
      headers: headers(cfg, "user", { "content-type": "image/png", "x-upsert": "false" }),
      body: PNG_1X1,
    });
    const b = await body(res);
    const id = `F06 user direct upload refused (${bucket})`;
    if (res.ok) {
      const del = await deps.fetch(`${cfg.url}/storage/v1/object/${bucket}`, {
        method: "DELETE",
        headers: headers(cfg, "user", { "content-type": "application/json" }),
        body: JSON.stringify({ prefixes: [path] }),
      });
      out.push({
        id,
        finding: "F06",
        status: "exposed",
        detail: `upload accepted (switch open); probe object ${del.ok ? "deleted" : "NOT deleted, remove it by hand"}`,
      });
    } else if (/DIRECT_IMAGE_UPLOAD_CLOSED/.test(JSON.stringify(b)))
      out.push({ id, finding: "F06", status: "pass", detail: "refused by the closed switch" });
    else
      out.push({
        id,
        finding: "F06",
        status: "error",
        detail: `refused, but not by the switch (HTTP ${res.status}: ${errorText(b)}); check bucket limits and policies`,
      });
  }
  return out;
}

export async function runCutoverProbe(cfg: ProbeConfig, deps: ProbeDeps): Promise<CheckResult[]> {
  const problems = probeTargetProblems(cfg, deps.isolation);
  if (problems.length) throw new ProbeRefused(problems);
  const want = (f: Finding) => !cfg.only || cfg.only.includes(f);
  const results: CheckResult[] = [];
  if (want("F06")) results.push(...(await f06(cfg, deps)));
  if (want("F07")) results.push(...(await f07(cfg, deps)));
  if (want("F08")) results.push(...(await f08(cfg, deps)));
  return results;
}

export class ProbeRefused extends Error {
  constructor(readonly problems: string[]) {
    super(`cutover probe refused to run:\n  - ${problems.join("\n  - ")}`);
  }
}

export function formatResults(results: CheckResult[]): string {
  const label: Record<Status, string> = {
    pass: "PASS   ",
    exposed: "EXPOSED",
    error: "ERROR  ",
    skip: "SKIP   ",
  };
  return results.map((r) => `${label[r.status]} ${r.id}: ${r.detail}`).join("\n");
}

export function exitCode(results: CheckResult[]): 0 | 1 {
  return results.some((r) => r.status === "exposed" || r.status === "error") ? 1 : 0;
}

// ------------------------------------------------------------------------------------------------ CLI

async function main(argv: string[], env: Record<string, string | undefined>) {
  const onlyArg =
    argv.find((a) => a.startsWith("--only="))?.slice(7) ?? argv[argv.indexOf("--only") + 1];
  const only = argv.some((a) => a.startsWith("--only"))
    ? (String(onlyArg)
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => ["F06", "F07", "F08"].includes(s)) as Finding[])
    : undefined;
  const cfg: ProbeConfig = {
    url: (env.PROBE_SUPABASE_URL ?? "").replace(/\/+$/, ""),
    publishableKey: env.PROBE_SUPABASE_PUBLISHABLE_KEY ?? "",
    userJwt: env.PROBE_USER_JWT || undefined,
    hiddenHostId: env.PROBE_HIDDEN_HOST_ID || undefined,
    allowWrites: argv.includes("--allow-writes"),
    only,
  };
  try {
    const results = await runCutoverProbe(cfg, { fetch });
    console.log(
      argv.includes("--json") ? JSON.stringify(results, null, 2) : formatResults(results),
    );
    process.exit(exitCode(results));
  } catch (e) {
    if (e instanceof ProbeRefused) {
      console.error(e.message);
      process.exit(2);
    }
    console.error(`cutover probe failed: ${sanitize(String((e as Error)?.message ?? e))}`);
    process.exit(1);
  }
}

// Bun sets import.meta.main for the entry file; importing this module (tests) runs nothing.
if ((import.meta as { main?: boolean }).main) void main(process.argv.slice(2), process.env);
