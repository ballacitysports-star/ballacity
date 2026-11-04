/**
 * The shipped state: `qkukefvzwlyusvspablz` (ballacity-staging) is designated for E2E, but its isolation
 * is not recorded, so every entry point refuses it before any client, fetch or fixture write. Production
 * stays refused whatever the records say. No module mock here: this is what CI runs with.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VERIFIED_E2E_SANDBOX_ISOLATION } from "../../e2e/safety/sandbox-isolation";
import {
  isolationRecorded,
  NON_PRODUCTION_E2E_PROJECT_REFS,
  PRODUCTION_PROJECT_REFS,
  resolveE2eTarget,
} from "../../e2e/safety/target-guard";
import { devServerWebServer } from "../../e2e/safety/dev-server";

const STAGING = "qkukefvzwlyusvspablz";
const OLD_UNVERIFIED = "olrbulvwexrkjcxddjxq";
const PROD = "cpqihhcqeivbgxqbzatv";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const key = (claims: Record<string, unknown>) =>
  `${b64({ alg: "HS256" })}.${b64(claims)}.sig-not-checked`;
const url = (ref: string) => `https://${ref}.supabase.co`;
const envFor = (ref: string) => ({
  E2E_BASE_URL: "http://localhost:8080",
  SUPABASE_URL: url(ref),
  VITE_SUPABASE_URL: url(ref),
  SUPABASE_PROJECT_ID: ref,
  VITE_SUPABASE_PROJECT_ID: ref,
  SUPABASE_PUBLISHABLE_KEY: key({ ref }),
  VITE_SUPABASE_PUBLISHABLE_KEY: key({ ref }),
  SUPABASE_SERVICE_ROLE_KEY: key({ ref, role: "service_role" }),
});

describe("designation", () => {
  it("designates exactly the staging project, and no longer the unverified one", () => {
    expect(NON_PRODUCTION_E2E_PROJECT_REFS).toEqual([STAGING]);
    expect(NON_PRODUCTION_E2E_PROJECT_REFS).not.toContain(OLD_UNVERIFIED);
  });

  it("keeps production blocked and never designated", () => {
    expect(PRODUCTION_PROJECT_REFS).toContain(PROD);
    expect(NON_PRODUCTION_E2E_PROJECT_REFS).not.toContain(PROD);
  });

  it("ships with no isolation record: the owner has not verified staging yet", () => {
    expect(VERIFIED_E2E_SANDBOX_ISOLATION).toEqual({});
  });

  it("supabase/config.e2e.toml names the same project, and no longer names the old one", () => {
    const toml = readFileSync("supabase/config.e2e.toml", "utf8");
    expect(/project_id\s*=\s*"([a-z0-9]{20})"/.exec(toml)?.[1]).toBe(STAGING);
    expect(toml).not.toContain(OLD_UNVERIFIED);
  });
});

describe("what counts as a recorded verification", () => {
  it("needs who, a YYYY-MM-DD date and where the evidence lives", () => {
    const ok = { verified_by: "owner", verified_on: "2026-11-04", evidence: "ticket OPS-1" };
    expect(isolationRecorded(ok)).toBe(true);
    expect(isolationRecorded(undefined)).toBe(false);
    expect(isolationRecorded({ ...ok, verified_on: "soon" })).toBe(false);
    expect(isolationRecorded({ ...ok, verified_by: " " })).toBe(false);
    expect(isolationRecorded({ ...ok, evidence: "" })).toBe(false);
  });
});

describe("an unverified designated sandbox is refused", () => {
  it("by the pure check, naming the missing isolation record", () => {
    const r = resolveE2eTarget(envFor(STAGING));
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.reasons.join("\n")).toMatch(
      /qkukefvzwlyusvspablz is a designated E2E sandbox, but its isolation .* has not been verified/,
    );
  });

  it("while the old, never-verified reference is not a sandbox at all", () => {
    const r = resolveE2eTarget(envFor(OLD_UNVERIFIED));
    expect(r.ok ? "" : r.reasons.join("\n")).toMatch(/is not a designated E2E sandbox/);
  });

  it("and production is refused as production", () => {
    const r = resolveE2eTarget(envFor(PROD));
    expect(r.ok ? "" : r.reasons.join("\n")).toMatch(/names the PRODUCTION project/);
  });

  it("a local backend still works without any record", () => {
    expect(
      resolveE2eTarget({
        SUPABASE_URL: "http://127.0.0.1:54321",
        VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).toEqual({ ok: true, target: { kind: "local" } });
  });
});

describe("no entry point gets as far as a write", () => {
  const createClient = vi.fn();
  const fetchSpy = vi.fn();
  beforeEach(() => {
    vi.resetModules();
    createClient.mockReset();
    fetchSpy.mockReset();
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));
    vi.stubGlobal("fetch", fetchSpy);
    for (const k of Object.keys(process.env)) {
      if (/SUPABASE|E2E_BASE_URL/.test(k)) vi.stubEnv(k, "");
    }
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock("@supabase/supabase-js");
  });
  const setEnv = (env: Record<string, string>) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  };

  it("the Playwright config refuses to load for the unverified staging project", async () => {
    setEnv(envFor(STAGING));
    await expect(import("../../playwright.config")).rejects.toMatchObject({
      name: "E2eTargetError",
    });
  });

  it("global setup stops before any client, fetch or fixture write", async () => {
    const env = envFor(STAGING);
    setEnv(env);
    const { default: globalSetup } = await import("../../e2e/global-setup");
    const webServer = devServerWebServer(env, { kind: "sandbox", ref: STAGING });
    await expect(globalSetup({ webServer })).rejects.toMatchObject({ name: "E2eTargetError" });
    expect(createClient).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
