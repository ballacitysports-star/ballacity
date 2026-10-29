/**
 * Local-only proof, through Playwright's real reporter path, that the service role
 * key is not written into the JSON report, the logs, a worker's environment or a
 * worker's child process. Synthetic OPAQUE key (no JWT or `sb_` shape), so nothing
 * here depends on pattern-based redaction.
 *
 * The web server is a stub; the config is built with the real devServerWebServer()
 * so what Playwright serializes is what the real config would serialize. The real
 * launcher's forwarding of the inherited key is proven separately in
 * e2e-dev-server.integration.test.ts. No Supabase project is contacted.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const KEY = "SYNTH-OPAQUE-SERVICE-VALUE-0123456789";
const freePort = () =>
  new Promise<number>((res, rej) => {
    const s = net.createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => res(port));
    });
  });

function runPlaywright(serializeKey: boolean) {
  return freePort().then((port) => {
    const dir = mkdtempSync(join(tmpdir(), "svc key "));
    const devServer = resolve("e2e/safety/dev-server.ts").replace(/\\/g, "/");
    writeFileSync(
      join(dir, "stub.mjs"),
      `import http from "node:http"; http.createServer((q, r) => r.end("ok")).listen(${port}, "127.0.0.1");`,
    );
    writeFileSync(
      join(dir, "setup.ts"),
      // Mirrors e2e/global-setup.ts: read once, remove from the environment.
      `export default async function () { const k = process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY; if (!k) throw new Error("setup never saw the key"); }`,
    );
    writeFileSync(
      join(dir, "playwright.config.ts"),
      `import { defineConfig } from "@playwright/test";
import { devServerWebServer } from ${JSON.stringify(devServer)};
const real = devServerWebServer(process.env, { kind: "local" });
const env = ${serializeKey} ? { ...real.env, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY! } : real.env;
export default defineConfig({
  testDir: ".", testMatch: "k.spec.ts", globalSetup: "./setup.ts", workers: 1,
  reporter: [["line"], ["json", { outputFile: "report.json" }]],
  webServer: { ...real, command: "node stub.mjs", env },
});`,
    );
    writeFileSync(
      join(dir, "k.spec.ts"),
      `import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
test("the worker and its children do not have the key", ({}, testInfo) => {
  expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  expect(execSync("printenv SUPABASE_SERVICE_ROLE_KEY || echo none").toString().trim()).toBe("none");
  expect(JSON.stringify(testInfo.config.webServer)).not.toContain(${JSON.stringify(KEY)});
});`,
    );
    const url = `http://127.0.0.1:${port}`;
    const r = spawnSync(
      process.execPath,
      [
        resolve("node_modules/@playwright/test/cli.js"),
        "test",
        "-c",
        join(dir, "playwright.config.ts"),
      ],
      {
        cwd: dir,
        encoding: "utf8",
        timeout: 120_000,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          NODE_PATH: resolve("node_modules"),
          E2E_BASE_URL: url,
          SUPABASE_URL: url,
          VITE_SUPABASE_URL: url,
          SUPABASE_PUBLISHABLE_KEY: "fake-publishable-key",
          VITE_SUPABASE_PUBLISHABLE_KEY: "fake-publishable-key",
          SUPABASE_SERVICE_ROLE_KEY: KEY,
        },
      },
    );
    return { r, report: readFileSync(join(dir, "report.json"), "utf8") };
  });
}

describe("the service role key and Playwright's reporter", () => {
  it("is absent from the JSON report, the logs, the worker and its children", async () => {
    const { r, report } = await runPlaywright(false);
    expect(r.status, `${r.stdout}\n${r.stderr}`.replaceAll(KEY, "<key>")).toBe(0);
    expect(report).not.toContain(KEY);
    expect(`${r.stdout}${r.stderr}`).not.toContain(KEY);
    expect(JSON.parse(report).config.webServer.env.E2E_DEV_SERVER_SPEC).toBeTruthy();
  }, 150_000);

  it("control: the old behavior (key inside webServer.env) would have been written to the report", async () => {
    const { report } = await runPlaywright(true).catch(() => ({ report: "" }));
    expect(report).toContain(KEY);
  }, 150_000);
});
