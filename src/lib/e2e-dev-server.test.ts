import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertLaunchedDevServer,
  buildDevServerSpec,
  DEV_SERVER_COMMAND,
  DEV_SERVER_SPEC_VAR,
  devServerWebServer,
  KNOWN_SUPABASE_VARS,
  LOCAL_PLACEHOLDER_KEY,
  MUST_BE_SET_VARS,
  LIVE_PAYMENTS_KEY,
  PASS_THROUGH_VARS,
  PAYMENTS_PLACEHOLDER,
  PAYMENTS_VAR,
} from "../../e2e/safety/dev-server";
import {
  E2eTargetError,
  NON_PRODUCTION_E2E_PROJECT_REFS,
  PRODUCTION_PROJECT_REFS,
} from "../../e2e/safety/target-guard";

const PROD = PRODUCTION_PROJECT_REFS[0];
const SANDBOX = NON_PRODUCTION_E2E_PROJECT_REFS[0];
const SB_TARGET = { kind: "sandbox", ref: SANDBOX } as const;
const LOCAL_TARGET = { kind: "local" } as const;
const url = (ref: string) => `https://${ref}.supabase.co`;
const KEY = "fake-publishable-key-value";

const sandboxEnv = (over: Record<string, string | undefined> = {}) =>
  ({
    E2E_BASE_URL: "http://localhost:8080",
    PATH: "/usr/bin",
    SUPABASE_URL: url(SANDBOX),
    VITE_SUPABASE_URL: url(SANDBOX),
    SUPABASE_PROJECT_ID: SANDBOX,
    VITE_SUPABASE_PROJECT_ID: SANDBOX,
    SUPABASE_PUBLISHABLE_KEY: KEY,
    VITE_SUPABASE_PUBLISHABLE_KEY: KEY,
    ...over,
  }) as Record<string, string | undefined>;

const localEnv = (over: Record<string, string | undefined> = {}) =>
  ({
    E2E_BASE_URL: "http://127.0.0.1:8080",
    PATH: "/usr/bin",
    SUPABASE_URL: "http://127.0.0.1:54321",
    VITE_SUPABASE_URL: "http://127.0.0.1:54321",
    ...over,
  }) as Record<string, string | undefined>;

const problemsOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(E2eTargetError);
    return (e as Error).message;
  }
  throw new Error("expected the builder to refuse");
};

describe("browser and server configuration agree", () => {
  it("gives the server and the browser the same URL, id and key", () => {
    const spec = buildDevServerSpec(sandboxEnv(), SB_TARGET);
    expect(spec.env.SUPABASE_URL).toBe(spec.env.VITE_SUPABASE_URL);
    expect(spec.env.SUPABASE_PROJECT_ID).toBe(SANDBOX);
    expect(spec.env.VITE_SUPABASE_PROJECT_ID).toBe(SANDBOX);
    expect(spec.env.SUPABASE_PUBLISHABLE_KEY).toBe(KEY);
    expect(spec.env.VITE_SUPABASE_PUBLISHABLE_KEY).toBe(KEY);
    expect(spec.args).toEqual(["dev", "--host", "localhost", "--port", "8080", "--strictPort"]);
  });

  it("treats a trailing slash and host casing as the same URL", () => {
    const env = sandboxEnv({
      VITE_SUPABASE_URL: `${url(SANDBOX).toUpperCase().replace("HTTPS", "https")}/`,
    });
    expect(buildDevServerSpec(env, SB_TARGET).env.VITE_SUPABASE_URL).toBe(url(SANDBOX));
  });

  it("sets every variable .env.production would otherwise fill in, non-empty", () => {
    for (const target of [SB_TARGET, LOCAL_TARGET]) {
      const env = target.kind === "local" ? localEnv() : sandboxEnv();
      const spec = buildDevServerSpec(env, target);
      expect(spec.mustBeSet).toEqual([...MUST_BE_SET_VARS]);
      for (const name of MUST_BE_SET_VARS) expect(spec.env[name]?.trim()).toBeTruthy();
    }
  });
});

describe("missing or conflicting configuration fails closed", () => {
  it.each([
    "SUPABASE_URL",
    "VITE_SUPABASE_URL",
    "SUPABASE_PROJECT_ID",
    "VITE_SUPABASE_PROJECT_ID",
    "SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
  ])("refuses a remote target when %s is missing", (name) => {
    expect(
      problemsOf(() => buildDevServerSpec(sandboxEnv({ [name]: undefined }), SB_TARGET)),
    ).toContain(name);
  });

  it("refuses an empty value, because vite.config.ts treats empty as unset", () => {
    expect(
      problemsOf(() => buildDevServerSpec(sandboxEnv({ SUPABASE_URL: "   " }), SB_TARGET)),
    ).toContain("SUPABASE_URL");
  });

  it("refuses different URLs for the browser and the server", () => {
    const text = problemsOf(() =>
      buildDevServerSpec(sandboxEnv({ VITE_SUPABASE_URL: `${url(SANDBOX)}/other` }), SB_TARGET),
    );
    expect(text).toContain("different URLs");
  });

  it("refuses different keys or ids for the browser and the server", () => {
    expect(
      problemsOf(() =>
        buildDevServerSpec(sandboxEnv({ VITE_SUPABASE_PUBLISHABLE_KEY: "another-key" }), SB_TARGET),
      ),
    ).toContain("different keys");
    expect(
      problemsOf(() =>
        buildDevServerSpec(
          sandboxEnv({ VITE_SUPABASE_PROJECT_ID: "abcdefghijklmnopqrst" }),
          SB_TARGET,
        ),
      ),
    ).toContain("differ");
  });

  it("refuses a URL that names some other project than the verified target", () => {
    for (const ref of [PROD, "abcdefghijklmnopqrst"]) {
      const env = sandboxEnv({ SUPABASE_URL: url(ref), VITE_SUPABASE_URL: url(ref) });
      expect(problemsOf(() => buildDevServerSpec(env, SB_TARGET))).toContain(
        "does not name the verified target",
      );
    }
  });

  it("refuses a remote URL when the verified target is local, and the reverse", () => {
    expect(problemsOf(() => buildDevServerSpec(sandboxEnv(), LOCAL_TARGET))).toContain(
      "verified target",
    );
    expect(problemsOf(() => buildDevServerSpec(localEnv(), SB_TARGET))).toContain(
      "verified target",
    );
  });

  it("never prints a key", () => {
    const text = problemsOf(() =>
      buildDevServerSpec(
        sandboxEnv({ VITE_SUPABASE_PUBLISHABLE_KEY: "SECRET-OTHER-KEY" }),
        SB_TARGET,
      ),
    );
    expect(text).not.toContain("SECRET-OTHER-KEY");
    expect(text).not.toContain(KEY);
  });
});

describe("nothing leaks in from the parent shell", () => {
  const parent = sandboxEnv({
    SUPABASE_ANON_KEY: "inherited-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: undefined,
    SUPABASE_DB_URL: `postgres://x@db.${PROD}.supabase.co:5432/postgres`,
    NEXT_PUBLIC_SUPABASE_URL: url(PROD),
    SUPABASE_ACCESS_TOKEN: "sbp_inherited",
    STRIPE_SECRET_KEY: "sk_inherited",
    AWS_SECRET_ACCESS_KEY: "aws_inherited",
    LOVABLE_BROWSER_SUPABASE_SESSION_JSON: '{"access_token":"x"}',
    E2E_DEV_SERVER_SPEC: "stale",
    HTTPS_PROXY: "http://proxy.local:3128",
  });

  it("drops every variable that is not allowlisted, including look-alike Supabase names", () => {
    const { env } = buildDevServerSpec(parent, SB_TARGET);
    for (const name of [
      "SUPABASE_ANON_KEY",
      "SUPABASE_DB_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_ACCESS_TOKEN",
      "STRIPE_SECRET_KEY",
      "AWS_SECRET_ACCESS_KEY",
      "LOVABLE_BROWSER_SUPABASE_SESSION_JSON",
      DEV_SERVER_SPEC_VAR,
    ]) {
      expect(env).not.toHaveProperty(name);
    }
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HTTPS_PROXY).toBe("http://proxy.local:3128");
  });

  it("only ever contains allowlisted names plus the explicit Supabase set", () => {
    const { env } = buildDevServerSpec(parent, SB_TARGET);
    const allowed = new Set([...PASS_THROUGH_VARS, ...KNOWN_SUPABASE_VARS]);
    for (const name of Object.keys(env)) expect(allowed.has(name)).toBe(true);
  });

  it("never puts the service-role key in the spec, only whether the launcher should inherit one", () => {
    const without = buildDevServerSpec(parent, SB_TARGET);
    expect(without.inheritServiceKey).toBe(false);
    expect(without.env).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
    const withKey = buildDevServerSpec(
      { ...parent, SUPABASE_SERVICE_ROLE_KEY: "SYNTH-OPAQUE-SERVICE-VALUE" },
      SB_TARGET,
    );
    expect(withKey.inheritServiceKey).toBe(true);
    expect(withKey.env).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
    expect(JSON.stringify(withKey)).not.toContain("SYNTH-OPAQUE-SERVICE-VALUE");
    expect(
      JSON.stringify(
        devServerWebServer(
          { ...parent, SUPABASE_SERVICE_ROLE_KEY: "SYNTH-OPAQUE-SERVICE-VALUE" },
          SB_TARGET,
        ),
      ),
    ).not.toContain("SYNTH-OPAQUE-SERVICE-VALUE");
  });

  it("a production value in the parent shell cannot reach the child under any name it reads", () => {
    const poisoned = sandboxEnv({ SUPABASE_ANON_KEY: url(PROD) });
    const { env } = buildDevServerSpec(poisoned, SB_TARGET);
    expect(JSON.stringify(env)).not.toContain(PROD);
  });
});

describe(".env.production cannot silently redirect the dev server", () => {
  const names = (file: string) =>
    readFileSync(file, "utf8")
      .split("\n")
      .map((l) => /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l)?.[1])
      .filter((n): n is string => !!n);

  it("every Supabase variable in .env.production is explicitly set in the child", () => {
    const supabaseNames = names(".env.production").filter((n) => /SUPABASE/.test(n));
    expect(supabaseNames.length).toBeGreaterThan(0);
    for (const target of [SB_TARGET, LOCAL_TARGET]) {
      const spec = buildDevServerSpec(target.kind === "local" ? localEnv() : sandboxEnv(), target);
      for (const n of supabaseNames) {
        expect(MUST_BE_SET_VARS as readonly string[]).toContain(n);
        expect(spec.env[n]?.trim()).toBeTruthy();
      }
    }
  });

  it("vite.config.ts still fills only unset or empty variables, which is what this relies on", () => {
    const source = readFileSync("vite.config.ts", "utf8");
    expect(source).toContain("if (process.env[key]) continue;");
    expect(source).toContain("seedEnvFromProductionFile();");
  });

  it("no source file reads a Supabase variable the launcher does not control", () => {
    const found = new Set<string>();
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const text = readFileSync(p, "utf8");
          for (const m of text.matchAll(
            /(?:process\.env|import\.meta\.env)\.((?:VITE_)?SUPABASE_[A-Z_]+)/g,
          ))
            found.add(m[1]);
        }
      }
    };
    walk("src");
    expect(found.size).toBeGreaterThan(0);
    for (const n of found) expect(KNOWN_SUPABASE_VARS).toContain(n);
  });
});

describe("local Supabase stays usable", () => {
  it("starts with a placeholder key when none is set, so nothing is filled from production", () => {
    const { env } = buildDevServerSpec(localEnv(), LOCAL_TARGET);
    expect(env.SUPABASE_PUBLISHABLE_KEY).toBe(LOCAL_PLACEHOLDER_KEY);
    expect(env.VITE_SUPABASE_PUBLISHABLE_KEY).toBe(LOCAL_PLACEHOLDER_KEY);
    expect(env.SUPABASE_PROJECT_ID).toBe("local");
  });

  it("keeps real local keys and labels", () => {
    const { env } = buildDevServerSpec(
      localEnv({
        SUPABASE_PROJECT_ID: "127",
        VITE_SUPABASE_PROJECT_ID: "127",
        SUPABASE_PUBLISHABLE_KEY: "local-anon",
        VITE_SUPABASE_PUBLISHABLE_KEY: "local-anon",
      }),
      LOCAL_TARGET,
    );
    expect(env.SUPABASE_PROJECT_ID).toBe("127");
    expect(env.SUPABASE_PUBLISHABLE_KEY).toBe("local-anon");
  });

  it("still refuses a local label that is not a plain label", () => {
    expect(
      problemsOf(() => buildDevServerSpec(localEnv({ SUPABASE_PROJECT_ID: "a b!" }), LOCAL_TARGET)),
    ).toContain("not a valid local project label");
  });
});

describe("Playwright is what starts the dev server", () => {
  it("builds one webServer entry that cannot adopt a running server", () => {
    const w = devServerWebServer(sandboxEnv(), SB_TARGET);
    expect(w.command).toBe(DEV_SERVER_COMMAND);
    expect(w.reuseExistingServer).toBe(false);
    expect(w.url).toBe("http://localhost:8080/");
    expect(Object.keys(w.env)).toEqual([DEV_SERVER_SPEC_VAR]);
    expect(() => assertLaunchedDevServer(w)).not.toThrow();
    expect(() => assertLaunchedDevServer([w])).not.toThrow();
  });

  it.each([
    ["no webServer", undefined],
    ["an empty list", []],
    ["two servers", "two"],
    ["another command", { command: "bun run dev" }],
    ["a reusable server", "reuse"],
    ["a spec with an empty variable", "empty"],
    ["an unreadable spec", "garbage"],
  ])("global setup refuses %s", (_label, kind) => {
    const good = devServerWebServer(sandboxEnv(), SB_TARGET);
    let value: unknown = kind;
    if (kind === "two") value = [good, good];
    if (kind === "reuse") value = { ...good, reuseExistingServer: true };
    if (kind === "empty") {
      const spec = JSON.parse(good.env[DEV_SERVER_SPEC_VAR]);
      spec.env.SUPABASE_URL = "";
      value = { ...good, env: { [DEV_SERVER_SPEC_VAR]: JSON.stringify(spec) } };
    }
    if (kind === "garbage") value = { ...good, env: { [DEV_SERVER_SPEC_VAR]: "{" } };
    expect(() => assertLaunchedDevServer(value)).toThrow(E2eTargetError);
  });

  it("the launcher refuses to start without a verified spec, or with a variable unset", () => {
    const run = (spec: string | undefined) =>
      spawnSync(process.execPath, ["e2e/safety/start-dev-server.mjs"], {
        env: {
          PATH: process.env.PATH ?? "",
          ...(spec === undefined ? {} : { E2E_DEV_SERVER_SPEC: spec }),
        },
        encoding: "utf8",
        timeout: 20_000,
      });
    const none = run(undefined);
    expect(none.status).toBe(2);
    expect(none.stderr).toContain("refusing to start");
    const good = JSON.parse(devServerWebServer(sandboxEnv(), SB_TARGET).env[DEV_SERVER_SPEC_VAR]);
    good.env.VITE_SUPABASE_URL = "";
    const empty = run(JSON.stringify(good));
    expect(empty.status).toBe(2);
    expect(empty.stderr).toContain("VITE_SUPABASE_URL");
    expect(empty.stderr).not.toContain(KEY);
  });
});

describe("the Playwright config", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const k of Object.keys(process.env))
      if (/SUPABASE|E2E_BASE_URL/.test(k)) vi.stubEnv(k, "");
  });
  afterEach(() => vi.unstubAllEnvs());
  const load = async (env: Record<string, string | undefined>) => {
    // Start every load from a blank slate: stubbed values persist between loads.
    vi.unstubAllEnvs();
    vi.resetModules();
    for (const k of Object.keys(process.env))
      if (/SUPABASE|E2E_BASE_URL/.test(k)) vi.stubEnv(k, "");
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v ?? "");
    return (await import("../../playwright.config")).default as {
      webServer?: { command: string; reuseExistingServer: boolean };
    };
  };

  it("launches the controlled dev server for a verified sandbox and for local Supabase", async () => {
    for (const env of [sandboxEnv(), localEnv()]) {
      vi.resetModules();
      const cfg = await load(env);
      expect(cfg.webServer?.command).toBe(DEV_SERVER_COMMAND);
      expect(cfg.webServer?.reuseExistingServer).toBe(false);
    }
  });

  it("does not load for a sandbox missing the keys the server needs", async () => {
    await expect(
      load(
        sandboxEnv({
          SUPABASE_PUBLISHABLE_KEY: undefined,
          VITE_SUPABASE_PUBLISHABLE_KEY: undefined,
        }),
      ),
    ).rejects.toMatchObject({ name: "E2eTargetError" });
  });

  it("does not load for production, however the variables are supplied", async () => {
    await expect(
      load(
        sandboxEnv({
          SUPABASE_URL: url(PROD),
          VITE_SUPABASE_URL: url(PROD),
          SUPABASE_PROJECT_ID: PROD,
          VITE_SUPABASE_PROJECT_ID: PROD,
        }),
      ),
    ).rejects.toMatchObject({ name: "E2eTargetError" });
    vi.resetModules();
    await expect(load(sandboxEnv({ VITE_SUPABASE_URL: url(PROD) }))).rejects.toMatchObject({
      name: "E2eTargetError",
    });
    vi.resetModules();
    await expect(load({})).rejects.toMatchObject({ name: "E2eTargetError" });
  });
});

describe("the payments token cannot fall back to .env.production (Blocker A)", () => {
  const live = "pk_live_SYNTHETICvalue123456";

  it("always gives the child the fixed E2E placeholder, for sandbox and local targets", () => {
    for (const [env, target] of [
      [sandboxEnv(), SB_TARGET],
      [localEnv(), LOCAL_TARGET],
    ] as const) {
      const spec = buildDevServerSpec(env, target);
      expect(spec.env[PAYMENTS_VAR]).toBe(PAYMENTS_PLACEHOLDER);
      expect(spec.env[PAYMENTS_VAR]).toBe("e2e-payments-disabled");
      expect(spec.mustBeSet).toContain(PAYMENTS_VAR);
    }
  });

  it("accepts the placeholder from the parent, and ignores nothing else about it", () => {
    const spec = buildDevServerSpec(
      sandboxEnv({ [PAYMENTS_VAR]: "  e2e-payments-disabled " }),
      SB_TARGET,
    );
    expect(spec.env[PAYMENTS_VAR]).toBe(PAYMENTS_PLACEHOLDER);
  });

  it.each([
    ["a live key", live],
    ["an uppercase live key", "PK_LIVE_SYNTHETICvalue123456"],
    ["a live key embedded in text", `config=${live};`],
    ["a test key", "pk_test_SYNTHETICvalue123456"],
    ["an altered placeholder", "e2e-payments-enabled"],
  ])("refuses a parent value that is %s, without printing it", (_label, value) => {
    const text = problemsOf(() =>
      buildDevServerSpec(sandboxEnv({ [PAYMENTS_VAR]: value }), SB_TARGET),
    );
    expect(text).toContain(PAYMENTS_VAR);
    expect(text).not.toContain("SYNTHETICvalue");
  });

  it("an empty parent value is replaced by the placeholder, never passed through", () => {
    expect(
      buildDevServerSpec(sandboxEnv({ [PAYMENTS_VAR]: "" }), SB_TARGET).env[PAYMENTS_VAR],
    ).toBe(PAYMENTS_PLACEHOLDER);
  });

  it("no child value holds a live payments key, whatever the parent has", () => {
    const { env } = buildDevServerSpec(
      sandboxEnv({
        STRIPE_LIVE_API_KEY: live,
        STRIPE_SECRET_KEY: live,
        NODE_OPTIONS: "--max-old-space-size=4096",
      }),
      SB_TARGET,
    );
    for (const v of Object.values(env)) expect(LIVE_PAYMENTS_KEY.test(v)).toBe(false);
  });

  it("every variable .env.production would seed is set explicitly in the child", () => {
    const names = readFileSync(".env.production", "utf8")
      .split("\n")
      .map((l) => /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l)?.[1])
      .filter((n): n is string => !!n);
    expect(names).toContain(PAYMENTS_VAR);
    for (const target of [SB_TARGET, LOCAL_TARGET]) {
      const { env } = buildDevServerSpec(
        target.kind === "local" ? localEnv() : sandboxEnv(),
        target,
      );
      for (const n of names) expect(env[n]?.trim(), n).toBeTruthy();
    }
  });

  it("the child never receives the value written in .env.production", () => {
    const file = readFileSync(".env.production", "utf8");
    const value = new RegExp(`^\\s*${PAYMENTS_VAR}\\s*=\\s*(.*)$`, "m")
      .exec(file)?.[1]
      ?.trim()
      .replace(/^(['"])(.*)\1$/, "$2");
    expect(value).toBeTruthy();
    const { env } = buildDevServerSpec(sandboxEnv(), SB_TARGET);
    expect(JSON.stringify(env)).not.toContain(value!);
  });

  it("the global-setup check refuses a spec without the placeholder or with a live key", () => {
    const good = devServerWebServer(sandboxEnv(), SB_TARGET);
    expect(() => assertLaunchedDevServer(good)).not.toThrow();
    const tamper = (mutate: (e: Record<string, string>) => void) => {
      const spec = JSON.parse(good.env[DEV_SERVER_SPEC_VAR]);
      mutate(spec.env);
      return { ...good, env: { [DEV_SERVER_SPEC_VAR]: JSON.stringify(spec) } };
    };
    expect(() => assertLaunchedDevServer(tamper((e) => delete e[PAYMENTS_VAR]))).toThrow(
      /placeholder|required variable/,
    );
    expect(() => assertLaunchedDevServer(tamper((e) => (e[PAYMENTS_VAR] = live)))).toThrow(
      /placeholder/,
    );
    expect(() => assertLaunchedDevServer(tamper((e) => (e.OTHER = live)))).toThrow(
      /live payments key/,
    );
  });

  it("the plain-JavaScript launcher refuses a missing, altered or live payments value, and prints nothing from the spec", () => {
    const base = buildDevServerSpec(sandboxEnv(), SB_TARGET);
    const launch = (mutate: (e: Record<string, string>) => void) => {
      const spec = JSON.parse(JSON.stringify(base));
      mutate(spec.env);
      return spawnSync(process.execPath, ["e2e/safety/start-dev-server.mjs"], {
        env: { PATH: process.env.PATH ?? "", [DEV_SERVER_SPEC_VAR]: JSON.stringify(spec) },
        encoding: "utf8",
        timeout: 20_000,
      });
    };
    for (const mutate of [
      (e: Record<string, string>) => delete e[PAYMENTS_VAR],
      (e: Record<string, string>) => (e[PAYMENTS_VAR] = ""),
      (e: Record<string, string>) => (e[PAYMENTS_VAR] = live),
      (e: Record<string, string>) => (e[PAYMENTS_VAR] = "e2e-payments-disabled-x"),
      (e: Record<string, string>) => (e.OTHER = live),
    ]) {
      const r = launch(mutate);
      expect(r.status).toBe(2);
      expect(`${r.stdout}${r.stderr}`).toContain("refusing to start");
      expect(`${r.stdout}${r.stderr}`).not.toContain("SYNTHETICvalue");
    }
  });

  it("the launcher's constants equal the module's", () => {
    const src = readFileSync("e2e/safety/start-dev-server.mjs", "utf8");
    expect(src).toContain(`const PAYMENTS_VAR = "${PAYMENTS_VAR}";`);
    expect(src).toContain(`const PAYMENTS_PLACEHOLDER = "${PAYMENTS_PLACEHOLDER}";`);
    expect(src).toContain(`const LIVE_PAYMENTS_KEY = ${LIVE_PAYMENTS_KEY.toString()};`);
  });

  it("does not change production files or payment behavior", () => {
    const stripe = readFileSync("src/lib/stripe.ts", "utf8");
    expect(stripe).toContain('token?.startsWith("pk_live_")');
    const vite = readFileSync("vite.config.ts", "utf8");
    expect(vite).toContain("if (process.env[key]) continue;");
  });
});

describe("the service-role key is not serialized (Blocker B)", () => {
  it("the launcher refuses a spec that carries it", () => {
    const base = buildDevServerSpec(sandboxEnv(), SB_TARGET);
    const spec = JSON.parse(JSON.stringify(base));
    spec.env.SUPABASE_SERVICE_ROLE_KEY = "SYNTH-OPAQUE-SERVICE-VALUE";
    const r = spawnSync(process.execPath, ["e2e/safety/start-dev-server.mjs"], {
      env: { PATH: process.env.PATH ?? "", [DEV_SERVER_SPEC_VAR]: JSON.stringify(spec) },
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(r.status).toBe(2);
    expect(`${r.stdout}${r.stderr}`).not.toContain("SYNTH-OPAQUE-SERVICE-VALUE");
  });

  it("the global-setup check refuses a config whose spec carries it", () => {
    const good = devServerWebServer(sandboxEnv(), SB_TARGET);
    const spec = JSON.parse(good.env[DEV_SERVER_SPEC_VAR]);
    spec.env.SUPABASE_SERVICE_ROLE_KEY = "SYNTH-OPAQUE-SERVICE-VALUE";
    expect(() =>
      assertLaunchedDevServer({ ...good, env: { [DEV_SERVER_SPEC_VAR]: JSON.stringify(spec) } }),
    ).toThrow(/service role key/);
  });

  it("global-setup reads the key only after the guard and removes it from the environment", () => {
    const gs = readFileSync("e2e/global-setup.ts", "utf8");
    const guard = gs.indexOf("assertLaunchedDevServer(config?.webServer)");
    const read = gs.indexOf(
      "const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;",
    );
    const del = gs.indexOf("delete process.env.SUPABASE_SERVICE_ROLE_KEY;");
    expect(guard).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(guard);
    expect(del).toBeGreaterThan(read);
    // No module-level read left to run before the guard.
    expect(gs.match(/process\.env\.SUPABASE_SERVICE_ROLE_KEY/g)?.length).toBe(2);
  });
});
