import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Black-box tests of .github/e2e-preflight.mjs, run the way the workflow runs it
 * (`node .github/e2e-preflight.mjs`) with dummy, non-secret values. No network, no
 * Supabase project, no real credential.
 */

const SANDBOX = "abcdefghijklmnopqrst";
const OTHER = "zyxwvutsrqponmlkjihg";
const PROD = /^\s*project_id\s*=\s*"([a-z0-9]{20})"/im.exec(
  readFileSync("supabase/config.toml", "utf8"),
)![1];

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims: Record<string, unknown>) =>
  `${b64({ alg: "HS256" })}.${b64(claims)}.dummy-signature`;
const url = (ref: string) => `https://${ref}.supabase.co`;

const PUBLISHABLE = jwt({ role: "anon", ref: SANDBOX });
const SERVICE = jwt({ role: "service_role", ref: SANDBOX });

const good = (
  over: Record<string, string | undefined> = {},
): Record<string, string | undefined> => ({
  E2E_SUPABASE_URL: url(SANDBOX),
  E2E_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
  E2E_SUPABASE_PROJECT_ID: SANDBOX,
  E2E_SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  E2E_SANDBOX_PROJECT_REF: SANDBOX,
  E2E_BASE_URL: "http://localhost:8080",
  ...over,
});

/**
 * A throwaway checkout whose path CONTAINS SPACES, holding the real CLI and lib plus
 * whatever repository files the test wants the preflight to read. The preflight reads
 * repo files relative to itself, so this is also how the "repo files name production"
 * tests work.
 */
function spacedCheckout(files: Record<string, string> = {}) {
  const root = join(mkdtempSync(join(tmpdir(), "pre flight ")), "my repo");
  mkdirSync(join(root, ".github"), { recursive: true });
  for (const f of ["e2e-preflight.mjs", "e2e-preflight-lib.mjs"])
    copyFileSync(resolve(".github", f), join(root, ".github", f));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}
const DEFAULT_ROOT = spacedCheckout();

function run(
  env: Record<string, string | undefined>,
  root: string = DEFAULT_ROOT,
  args: string[] = [],
) {
  const clean: Record<string, string> = { PATH: process.env.PATH ?? "" };
  for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v;
  const r = spawnSync(process.execPath, [join(root, ".github", "e2e-preflight.mjs"), ...args], {
    cwd: root,
    env: clean,
    encoding: "utf8",
    timeout: 20_000,
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

/** A failing run must stop the job and must not echo any configured value. */
function expectRefused(
  env: Record<string, string | undefined>,
  mention?: string,
  args: string[] = [],
) {
  const r = run(env, DEFAULT_ROOT, args);
  expect(r.code).toBe(1);
  expect(r.out).toContain("E2E preflight FAILED");
  if (mention) expect(r.out).toContain(mention);
  for (const v of Object.values(env)) {
    if (v && v.length >= 8) expect(r.out).not.toContain(v);
  }
  for (const ref of [SANDBOX, OTHER, PROD]) expect(r.out).not.toContain(ref);
  return r;
}

describe("a consistent, designated, non-production target passes", () => {
  it("exits 0 and says it does not prove isolation", () => {
    const r = run(good());
    expect(r.code).toBe(0);
    expect(r.out).toContain("(gate) passed");
    expect(r.out).toContain("does not prove the project is isolated");
  });

  it("ignores casing, whitespace and a trailing slash", () => {
    const env = good({
      E2E_SUPABASE_URL: ` ${url(SANDBOX).toUpperCase().replace("HTTPS", "https")}/ `,
      E2E_SUPABASE_PROJECT_ID: ` ${SANDBOX.toUpperCase()} `,
      E2E_SANDBOX_PROJECT_REF: SANDBOX.toUpperCase(),
    });
    expect(run(env).code).toBe(0);
  });

  it("accepts keys that are not readable JWTs, because the URL decides where requests go", () => {
    expect(
      run(
        good({
          E2E_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_dummy_value",
          E2E_SUPABASE_SERVICE_ROLE_KEY: "sb_secret_dummy_value",
        }),
      ).code,
    ).toBe(0);
  });
});

describe("missing or empty configuration stops the job", () => {
  it.each([
    "E2E_SUPABASE_URL",
    "E2E_SUPABASE_PUBLISHABLE_KEY",
    "E2E_SUPABASE_PROJECT_ID",
    "E2E_SUPABASE_SERVICE_ROLE_KEY",
    "E2E_SANDBOX_PROJECT_REF",
  ])("when %s is unset", (name) => {
    expectRefused(good({ [name]: undefined }), `${name} is missing or empty`);
  });

  it.each(["", "   ", "\n"])(
    "when a secret is blank (%j), which is what an unconfigured secret expands to",
    (blank) => {
      expectRefused(
        good({ E2E_SUPABASE_URL: blank, E2E_SUPABASE_PROJECT_ID: blank }),
        "is missing or empty",
      );
    },
  );

  it("when nothing is configured at all", () => {
    const r = expectRefused({});
    for (const name of [
      "E2E_SUPABASE_URL",
      "E2E_SUPABASE_PUBLISHABLE_KEY",
      "E2E_SUPABASE_PROJECT_ID",
      "E2E_SUPABASE_SERVICE_ROLE_KEY",
      "E2E_SANDBOX_PROJECT_REF",
    ]) {
      expect(r.out).toContain(name);
    }
  });
});

describe("an unknown or inconsistent target stops the job", () => {
  it.each([
    ["plain http", `http://${SANDBOX}.supabase.co`],
    ["a path", `${url(SANDBOX)}/rest/v1`],
    ["a port", `${url(SANDBOX)}:8443`],
    ["credentials in the URL", `https://user:pw@${SANDBOX}.supabase.co`],
    ["a custom domain", "https://api.example.com"],
    ["a look-alike host", `${url(SANDBOX)}.evil.test`],
    ["a local host", "http://127.0.0.1:54321"],
    ["no scheme", `${SANDBOX}.supabase.co`],
    ["a query string", `${url(SANDBOX)}?x=1`],
  ])("a URL with %s", (_label, bad) => {
    expectRefused(
      good({ E2E_SUPABASE_URL: bad }),
      "not a plain https://<project-ref>.supabase.co URL",
    );
  });

  it("when the project id names another project", () => {
    expectRefused(good({ E2E_SUPABASE_PROJECT_ID: OTHER }), "does not match");
  });

  it("when the owner's designation names another project", () => {
    expectRefused(
      good({ E2E_SANDBOX_PROJECT_REF: OTHER }),
      "E2E_SANDBOX_PROJECT_REF does not match",
    );
  });

  it("when a key carries another project's ref claim", () => {
    expectRefused(
      good({ E2E_SUPABASE_PUBLISHABLE_KEY: jwt({ role: "anon", ref: OTHER }) }),
      "belongs to a different project",
    );
    expectRefused(
      good({ E2E_SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role", ref: OTHER }) }),
      "belongs to a different project",
    );
  });

  it("when both keys are the same value", () => {
    expectRefused(good({ E2E_SUPABASE_SERVICE_ROLE_KEY: PUBLISHABLE }), "same value");
  });

  it("when the base URL is not local", () => {
    expectRefused(good({ E2E_BASE_URL: "https://ballacity.lovable.app" }), "not a local address");
  });
});

describe("a production project is refused however it is supplied", () => {
  const prodAll = (ref: string) => ({
    E2E_SUPABASE_URL: url(ref),
    E2E_SUPABASE_PROJECT_ID: ref,
    E2E_SANDBOX_PROJECT_REF: ref,
    E2E_SUPABASE_PUBLISHABLE_KEY: jwt({ role: "anon", ref }),
    E2E_SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role", ref }),
  });

  it("when everything consistently names it, including the owner's designation", () => {
    expectRefused(good(prodAll(PROD)), "PRODUCTION");
  });

  it("with mixed-case references", () => {
    const mixed = PROD.slice(0, 7).toUpperCase() + PROD.slice(7);
    expectRefused(
      good({ ...prodAll(mixed), E2E_SUPABASE_URL: `https://${mixed}.supabase.co` }),
      "PRODUCTION",
    );
  });

  it("when only a key claims it", () => {
    expectRefused(
      good({ E2E_SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role", ref: PROD }) }),
      "PRODUCTION",
    );
  });

  it("when only the URL, id and designation name it (keys that cannot be read)", () => {
    const opaque = {
      E2E_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_dummy_value",
      E2E_SUPABASE_SERVICE_ROLE_KEY: "sb_secret_dummy_value",
    };
    expectRefused(
      good({ ...prodAll(PROD), ...opaque }),
      "the configured target is a PRODUCTION project",
    );
  });

  it("uses the reference written in the repository's own files, not only a built-in one", () => {
    const opaque = {
      E2E_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_dummy_value",
      E2E_SUPABASE_SERVICE_ROLE_KEY: "sb_secret_dummy_value",
    };
    const asOther = { ...prodAll(OTHER), ...opaque };
    const withToml = spacedCheckout({ "supabase/config.toml": `project_id = "${OTHER}"\n` });
    expect(run(good(asOther), withToml).code).toBe(1);
    expect(run(good(asOther), withToml).out).toContain("PRODUCTION");
    // The same values pass when no file names it, which shows the file is what blocked it.
    expect(run(good(asOther), spacedCheckout()).code).toBe(0);
    const withEnv = spacedCheckout({ ".env.production": `SUPABASE_PROJECT_ID="${OTHER}"\n` });
    expect(run(good(asOther), withEnv).code).toBe(1);
  });
});

describe("the CLI always validates, wherever it lives (B1)", () => {
  it("lives at a path with spaces in this suite", () => {
    expect(DEFAULT_ROOT).toContain(" ");
  });

  it("refuses an empty environment from a spaced path (was: exit 0, no output)", () => {
    const r = run({});
    expect(r.code).toBe(1);
    expect(r.out).toContain("E2E preflight FAILED");
  });

  it("refuses a production target from a spaced path", () => {
    expect(
      run(
        good({
          E2E_SUPABASE_URL: url(PROD),
          E2E_SUPABASE_PROJECT_ID: PROD,
          E2E_SANDBOX_PROJECT_REF: PROD,
        }),
      ).code,
    ).toBe(1);
  });

  it("passes a valid dummy target from a spaced path", () => {
    expect(run(good()).code).toBe(0);
  });

  it("refuses an unknown argument rather than ignoring it", () => {
    expectRefused(good(), "unknown argument", ["--skip"]);
    expectRefused(good(), "unknown argument", ["--runtime", "--service"]);
  });

  it("fails closed on an unexpected error", () => {
    // A directory where the lib expects nothing special still must not exit 0 if the
    // script cannot do its job: run the CLI with its lib removed.
    const root = spacedCheckout();
    writeFileSync(join(root, ".github", "e2e-preflight-lib.mjs"), "throw new Error('boom');");
    const r = run(good(), root);
    expect(r.code).not.toBe(0);
    expect(r.out).not.toContain(SANDBOX);
  });
});

describe("the configuration the steps actually use is validated (B2)", () => {
  const runtimeEnv = (over: Record<string, string | undefined> = {}) => {
    const g = good();
    delete g.E2E_SUPABASE_SERVICE_ROLE_KEY;
    return {
      ...g,
      SUPABASE_URL: g.E2E_SUPABASE_URL,
      VITE_SUPABASE_URL: g.E2E_SUPABASE_URL,
      SUPABASE_PROJECT_ID: SANDBOX,
      VITE_SUPABASE_PROJECT_ID: SANDBOX,
      SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      ...over,
    };
  };
  const serviceEnv = (over: Record<string, string | undefined> = {}) =>
    runtimeEnv({
      E2E_SUPABASE_SERVICE_ROLE_KEY: SERVICE,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE,
      ...over,
    });

  it("runtime mode passes when every value equals the validated one", () => {
    expect(run(runtimeEnv(), DEFAULT_ROOT, ["--runtime"]).code).toBe(0);
  });

  it("service mode passes when every value equals the validated one", () => {
    expect(run(serviceEnv(), DEFAULT_ROOT, ["--service"]).code).toBe(0);
  });

  it.each([
    "SUPABASE_URL",
    "VITE_SUPABASE_URL",
    "SUPABASE_PROJECT_ID",
    "VITE_SUPABASE_PROJECT_ID",
    "SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
  ])("runtime mode refuses when %s is unset or blank", (name) => {
    expectRefused(runtimeEnv({ [name]: undefined }), `${name} is missing`, ["--runtime"]);
    expectRefused(runtimeEnv({ [name]: "  " }), `${name} is missing`, ["--runtime"]);
  });

  it.each([
    ["SUPABASE_URL", url(OTHER)],
    ["VITE_SUPABASE_URL", url(OTHER)],
    ["SUPABASE_URL", url(PROD)],
    ["VITE_SUPABASE_URL", url(PROD)],
    ["SUPABASE_PROJECT_ID", OTHER],
    ["VITE_SUPABASE_PROJECT_ID", PROD],
    ["SUPABASE_PUBLISHABLE_KEY", jwt({ role: "anon", ref: PROD })],
    ["VITE_SUPABASE_PUBLISHABLE_KEY", jwt({ role: "anon", ref: OTHER })],
  ])("runtime mode refuses a contradictory %s", (name, value) => {
    const r = expectRefused(runtimeEnv({ [name]: value }), "does not match", ["--runtime"]);
    expect(r.out).toContain(name);
  });

  it("refuses a contradictory value even when the E2E_* values themselves are fine (gate would pass)", () => {
    expect(run(good()).code).toBe(0);
    expect(
      run(runtimeEnv({ VITE_SUPABASE_URL: url(PROD) }), DEFAULT_ROOT, ["--runtime"]).code,
    ).toBe(1);
  });

  it("runtime mode refuses the service role key under any name", () => {
    for (const name of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "E2E_SUPABASE_SERVICE_ROLE_KEY",
      "VITE_SUPABASE_SERVICE_ROLE_KEY",
    ]) {
      expectRefused(runtimeEnv({ [name]: SERVICE }), "must not be set in this step", ["--runtime"]);
    }
  });

  it("service mode refuses a service key that differs from the validated one", () => {
    expectRefused(
      serviceEnv({ SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role", ref: OTHER }) }),
      "SUPABASE_SERVICE_ROLE_KEY does not match",
      ["--service"],
    );
    expectRefused(serviceEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined }), "is missing", [
      "--service",
    ]);
  });

  it("refuses the service role key in any VITE_* (browser bundle) variable", () => {
    expectRefused(serviceEnv({ VITE_LEAK: SERVICE }), "carries the service role key", [
      "--service",
    ]);
  });

  it("checks roles where a key is a readable JWT", () => {
    expectRefused(
      good({ E2E_SUPABASE_PUBLISHABLE_KEY: jwt({ role: "service_role", ref: SANDBOX }) }),
      "not an anon-role key",
    );
    expectRefused(
      good({ E2E_SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "anon", ref: SANDBOX }) }),
      "not a service_role key",
    );
  });

  it("never prints a value for any of it", () => {
    const r = run(runtimeEnv({ VITE_SUPABASE_URL: url(PROD) }), DEFAULT_ROOT, ["--runtime"]);
    for (const v of [PROD, OTHER, SANDBOX, PUBLISHABLE, SERVICE]) expect(r.out).not.toContain(v);
  });
});

describe("production-seeded variables cannot enter the build (F1)", () => {
  const LIVE = "pk_live_dummyvalue1234567890";
  const envFile = (extra = "") =>
    `VITE_PAYMENTS_CLIENT_TOKEN=${LIVE}\nVITE_SUPABASE_URL=${url(PROD)}\n${extra}`;
  const root = () => spacedCheckout({ ".env.production": envFile() });
  const base = () => {
    const g = good();
    delete g.E2E_SUPABASE_SERVICE_ROLE_KEY;
    return {
      ...g,
      SUPABASE_URL: g.E2E_SUPABASE_URL,
      VITE_SUPABASE_URL: g.E2E_SUPABASE_URL,
      SUPABASE_PROJECT_ID: SANDBOX,
      VITE_SUPABASE_PROJECT_ID: SANDBOX,
      SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
    };
  };

  it("refuses when the variable is unset (it would be seeded from .env.production)", () => {
    const r = run(base(), root(), ["--runtime"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("VITE_PAYMENTS_CLIENT_TOKEN is not set");
    expect(r.out).not.toContain(LIVE);
  });

  it("refuses when the variable is empty, which vite.config.ts also seeds over", () => {
    const r = run({ ...base(), VITE_PAYMENTS_CLIENT_TOKEN: "" }, root(), ["--runtime"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("would be seeded");
  });

  it("refuses when the variable equals the production value", () => {
    const r = run({ ...base(), VITE_PAYMENTS_CLIENT_TOKEN: LIVE }, root(), ["--runtime"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("equals the production value");
    expect(r.out).not.toContain(LIVE);
  });

  it("refuses a live payments key under any name", () => {
    const r = run(
      {
        ...base(),
        VITE_PAYMENTS_CLIENT_TOKEN: "e2e-payments-disabled",
        OTHER_VAR: "sk_live_abc123",
      },
      root(),
      ["--runtime"],
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain("OTHER_VAR holds a live payments key");
  });

  it.each([
    ["uppercase", "PK_LIVE_ABCDEF123456"],
    ["padded", "   pk_live_abcdef123456   "],
    ["embedded in text", 'config={"key":"pk_live_abcdef123456"}'],
    ["after a separator", "token:sk_live_abcdef123456"],
    ["a restricted key", "rk_live_abcdef123456"],
  ])("refuses a live payments key that is %s, without printing it", (_label, value) => {
    const r = run({ ...base(), VITE_PAYMENTS_CLIENT_TOKEN: value }, root(), ["--runtime"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("VITE_PAYMENTS_CLIENT_TOKEN holds a live payments key");
    expect(r.out).not.toContain("abcdef123456");
  });

  it("does not mistake a longer word for a live key", () => {
    const r = run({ ...base(), VITE_PAYMENTS_CLIENT_TOKEN: "e2e-payments-disabled" }, root(), [
      "--runtime",
    ]);
    expect(r.code).toBe(0);
  });

  it("passes with an explicit placeholder", () => {
    const r = run({ ...base(), VITE_PAYMENTS_CLIENT_TOKEN: "e2e-payments-disabled" }, root(), [
      "--runtime",
    ]);
    expect(r.code).toBe(0);
  });

  it("the workflow sets the placeholder in every credentialed step", () => {
    const wf = readFileSync(".github/workflows/e2e.yml", "utf8");
    expect(wf.match(/VITE_PAYMENTS_CLIENT_TOKEN: e2e-payments-disabled/g)?.length).toBe(3);
  });

  it("covers every variable the real .env.production would seed", () => {
    const names = [...readFileSync(".env.production", "utf8").matchAll(/^\s*([A-Z_]+)\s*=/gm)].map(
      (m) => m[1],
    );
    const wf = readFileSync(".github/workflows/e2e.yml", "utf8");
    for (const n of names) expect(wf).toContain(`${n}:`);
  });
});

describe("the E2E placeholder keeps payments disabled in the app itself", () => {
  it("is not recognized as a Stripe key, so billing stays in the sandbox partition", async () => {
    const { paymentsConfiguredFor, billingEnvironmentFor } = await import("./stripe");
    const placeholder = "e2e-payments-disabled";
    expect(paymentsConfiguredFor(placeholder)).toBe(false);
    expect(billingEnvironmentFor(placeholder)).toBe("sandbox");
    // The app recognizes only an exact lowercase prefix; the preflight is stricter on purpose.
    expect(billingEnvironmentFor("PK_LIVE_abc")).toBe("sandbox");
    expect(billingEnvironmentFor(" pk_live_abc")).toBe("sandbox");
    expect(billingEnvironmentFor("pk_live_abc")).toBe("live");
  });
});

describe("the workflow gives each step only what it needs", () => {
  const wf = readFileSync(".github/workflows/e2e.yml", "utf8");
  const stepBlock = (name: string) => {
    const start = wf.indexOf(`- name: ${name}`);
    expect(start).toBeGreaterThan(-1);
    // A step ends at the next step or at the comment block that introduces it.
    const rest = wf.slice(start + 5);
    const m = /\n\n? {6}(?:- |#)/.exec(rest);
    return wf.slice(start, m ? start + 5 + m.index : undefined);
  };
  const jobEnv = wf.slice(wf.indexOf("    env:\n"), wf.indexOf("    steps:"));

  it("holds no Supabase value at job level", () => {
    expect(jobEnv).not.toMatch(/SUPABASE|secrets\./);
  });

  it("keeps the service role key out of install, build, browsers, summary and upload", () => {
    for (const n of [
      "Install dependencies",
      "Install Playwright browsers",
      "Build (dev mode)",
      "Summarise results",
      "Stop dev server",
      "Upload Playwright report",
    ]) {
      expect(stepBlock(n)).not.toMatch(/SERVICE_ROLE/);
    }
    expect(wf).not.toMatch(/VITE_[A-Z_]*SERVICE/);
  });

  it("runs Playwright without traces (F2)", () => {
    expect(stepBlock("Run Playwright tests")).toContain("playwright test --trace=off");
  });

  it("sanitizes into a separate file and gates the upload on that success (B5)", () => {
    const iRedact = wf.indexOf("- name: Redact report");
    expect(iRedact).toBeGreaterThan(wf.indexOf("- name: Run Playwright tests"));
    expect(iRedact).toBeLessThan(wf.indexOf("- name: Summarise results"));
    expect(iRedact).toBeLessThan(wf.indexOf("- name: Upload Playwright report"));
    const redact = stepBlock("Redact report");
    expect(redact).toContain("id: redact");
    expect(redact).toContain("--in playwright-report/results.json --out ci-sanitized/results.json");
    expect(redact).not.toContain("--in-place");
    // The success flag is written only on the line after the redactor, never before or elsewhere.
    const lines = redact.split("\n").map((l) => l.trim());
    const node = lines.findIndex((l) => l.startsWith("node .github/ci-redact.mjs"));
    const flag = lines.findIndex((l) => l.includes("sanitized=true"));
    expect(node).toBeGreaterThan(-1);
    expect(flag).toBe(node + 1);
    expect(wf.match(/sanitized=true/g)?.length).toBe(1);
    // The shell must stop on a redactor failure: no `|| true`, no custom shell.
    expect(redact).not.toMatch(/\|\|\s*(true|:)|continue-on-error|shell:/);

    const upload = stepBlock("Upload Playwright report");
    expect(upload).toMatch(/if: always\(\) && steps\.redact\.outputs\.sanitized == 'true'/);
    expect(upload.split("\n").filter((l) => /^\s*path:/.test(l))).toEqual([
      "          path: ci-sanitized/results.json",
    ]);
    expect(upload).toContain("if-no-files-found: error");
    expect(upload).not.toContain("continue-on-error");
  });

  it("hands the report-redaction step no secrets at all (B3)", () => {
    const redact = stepBlock("Redact report");
    expect(redact).not.toMatch(/\benv:|secrets\.|SERVICE_ROLE|E2E_|SUPABASE/);
  });

  it("nothing after the redactor reads or uploads the raw report", () => {
    const after = wf
      .slice(wf.indexOf("- name: Summarise results"))
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    expect(after).not.toMatch(/playwright-report\/results\.json/);
    expect(after).not.toMatch(/test-results/);
  });

  it("prints only redacted dev-server output (F4)", () => {
    const step = stepBlock("Start dev server");
    expect(step).toContain("ci-redact.mjs --tail");
    expect(step).not.toMatch(/\bcat dev-server\.log/);
  });

  it("global-setup removes the service key from the environment before any use (F3)", () => {
    const gs = readFileSync("e2e/global-setup.ts", "utf8");
    const del = gs.indexOf("delete process.env.SUPABASE_SERVICE_ROLE_KEY");
    expect(del).toBeGreaterThan(-1);
    expect(del).toBeLessThan(gs.indexOf("export default async function globalSetup"));
    expect(gs.match(/process\.env\.SUPABASE_SERVICE_ROLE_KEY/g)?.length).toBe(2); // read + delete
  });

  it("preflights the same step that receives credentials", () => {
    expect(stepBlock("Build (dev mode)")).toContain("e2e-preflight.mjs --runtime");
    expect(stepBlock("Start dev server")).toContain("e2e-preflight.mjs --service");
    expect(stepBlock("Run Playwright tests")).toContain("e2e-preflight.mjs --service");
  });
});

describe("the script itself", () => {
  const files = [".github/e2e-preflight.mjs", ".github/e2e-preflight-lib.mjs"].map((f) =>
    readFileSync(f, "utf8"),
  );
  const source = files.join("\n");

  it("imports nothing that can reach a network or run code", () => {
    const imports = [...source.matchAll(/^import .* from "([^"]+)";/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["./e2e-preflight-lib.mjs", "node:fs", "node:url"]);
    expect(source).not.toMatch(
      /\bfetch\(|XMLHttpRequest|child_process|node:(net|http|https|dns|tls)/,
    );
  });

  it("has no entrypoint detection to get wrong", () => {
    expect(source).not.toMatch(/import\.meta\.url\s*===|process\.argv\[1\]/);
  });

  it("never logs a variable's value", () => {
    const logs = [...source.matchAll(/(?:console\.(?:log|error)|io\.(?:out|err))\(([^;]*)\)/g)].map(
      (m) => m[1],
    );
    for (const l of logs) expect(l).not.toMatch(/env[.[]/);
  });
});
