/**
 * Local-only proof that the E2E launcher gives the dev server's SERVER functions
 * the environment that was verified, not the parent shell's and not
 * .env.production's.
 *
 * Everything is local: a fake HTTP server stands in for Supabase on 127.0.0.1, the
 * real launcher starts the real Vite dev server on another local port, and the
 * parent environment carries conflicting values that point at dead local ports.
 * No Supabase project is contacted. The server environment is read back from the
 * process the launcher started (/proc) and the test stops before sending any
 * request if it is not what was verified, so a regression cannot reach a real
 * project through this test.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { buildDevServerSpec, DEV_SERVER_SPEC_VAR } from "../../e2e/safety/dev-server";
import { verifyServedAppTarget } from "../../e2e/safety/target-guard";

const FAKE_KEY = "fake-publishable-key-for-local-proof-only";
const linux = process.platform === "linux";

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });

const childrenOf = (pid: number): number[] =>
  readdirSync("/proc")
    .filter((d) => /^\d+$/.test(d))
    .filter((d) => {
      try {
        return Number(readFileSync(`/proc/${d}/stat`, "utf8").split(") ")[1].split(" ")[1]) === pid;
      } catch {
        return false;
      }
    })
    .map(Number);

const initialEnv = (pid: number): Record<string, string> =>
  Object.fromEntries(
    readFileSync(`/proc/${pid}/environ`, "utf8")
      .split("\0")
      .filter(Boolean)
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1)];
      }),
  );

let launcher: ChildProcess | undefined;
let fake: http.Server | undefined;

afterAll(async () => {
  launcher?.kill("SIGTERM");
  await new Promise<void>((r) => (fake ? fake.close(() => r()) : r()));
});

describe("the launched dev server's server functions use the verified environment", () => {
  it.skipIf(!linux)(
    "reaches the verified (fake, local) Supabase and ignores a conflicting parent shell and .env.production",
    async () => {
      const received: Array<{ url: string; apikeyMatches: boolean }> = [];
      fake = http.createServer((req, res) => {
        received.push({
          url: (req.url ?? "").split("?")[0],
          apikeyMatches: req.headers.apikey === FAKE_KEY,
        });
        res.setHeader("content-type", "application/json");
        res.end("[]");
      });
      await new Promise<void>((r) => fake!.listen(0, "127.0.0.1", r));
      const fakePort = (fake.address() as net.AddressInfo).port;
      const devPort = await freePort();
      const supabaseUrl = `http://127.0.0.1:${fakePort}`;

      // The verified environment: what playwright.config.ts would hand the launcher.
      const verified = {
        E2E_BASE_URL: `http://127.0.0.1:${devPort}`,
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        SUPABASE_URL: supabaseUrl,
        VITE_SUPABASE_URL: supabaseUrl,
        SUPABASE_PUBLISHABLE_KEY: FAKE_KEY,
        VITE_SUPABASE_PUBLISHABLE_KEY: FAKE_KEY,
      };
      const spec = buildDevServerSpec(verified, { kind: "local" });

      // The parent shell disagrees on every variable. All dead local ports; nothing remote.
      launcher = spawn(process.execPath, ["e2e/safety/start-dev-server.mjs"], {
        env: {
          ...process.env,
          SUPABASE_URL: "http://127.0.0.1:1",
          VITE_SUPABASE_URL: "http://127.0.0.1:2",
          SUPABASE_PROJECT_ID: "inherited-id",
          SUPABASE_ANON_KEY: "inherited-anon-key",
          SUPABASE_SERVICE_ROLE_KEY: "inherited-service-key",
          [DEV_SERVER_SPEC_VAR]: JSON.stringify(spec),
        },
        stdio: "ignore",
      });

      const base = `http://127.0.0.1:${devPort}`;
      let ready = false;
      for (let i = 0; i < 100 && !ready; i++) {
        try {
          ready = (await fetch(`${base}/`)).ok;
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      expect(ready).toBe(true);

      // 1. What the server process was actually started with.
      const [viteProcess] = childrenOf(launcher.pid!);
      expect(viteProcess).toBeTruthy();
      const env = initialEnv(viteProcess);
      expect(env.SUPABASE_URL).toBe(supabaseUrl);
      expect(env.VITE_SUPABASE_URL).toBe(supabaseUrl);
      expect(env.SUPABASE_PUBLISHABLE_KEY).toBe(FAKE_KEY);
      expect(env.VITE_SUPABASE_PUBLISHABLE_KEY).toBe(FAKE_KEY);
      expect(env.SUPABASE_PROJECT_ID).toBe("local");
      for (const leaked of [
        "SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        DEV_SERVER_SPEC_VAR,
      ]) {
        expect(env).not.toHaveProperty(leaked);
      }
      // Stop here, before any request, if the environment is not the verified one.

      // 2. The browser half, as Vite serves it.
      await expect(
        verifyServedAppTarget(base, { kind: "local" }, (u) => fetch(u), {
          publishableKey: FAKE_KEY,
        }),
      ).resolves.toBeUndefined();

      // 3. The server half: a public server function reads process.env.SUPABASE_URL
      // inside the dev server. Its request must arrive at the verified (fake) server.
      const id = Buffer.from(
        JSON.stringify({
          file: "/src/lib/legal-documents.functions.ts?tss-serverfn-split",
          export: "getPublishedLegalDocuments_createServerFn_handler",
        }),
      ).toString("base64url");
      await fetch(`${base}/_serverFn/${id}`, {
        headers: { "x-tsr-serverfn": "true", accept: "application/json" },
      });
      for (let i = 0; i < 60 && received.length === 0; i++)
        await new Promise((r) => setTimeout(r, 500));
      expect(received.length).toBeGreaterThan(0);
      expect(received.every((r) => r.url.startsWith("/rest/v1/"))).toBe(true);
      expect(received.every((r) => r.apikeyMatches)).toBe(true);
    },
    240_000,
  );

  it.skipIf(!linux)(
    "gives the server the inherited service key without serializing it, and the payments placeholder instead of .env.production's live token",
    async () => {
      const OPAQUE = "SYNTH-OPAQUE-SERVICE-VALUE-0123456789";
      const devPort = await freePort();
      const base = `http://127.0.0.1:${devPort}`;
      const supabaseUrl = "http://127.0.0.1:1";
      const verified = {
        E2E_BASE_URL: base,
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        SUPABASE_URL: supabaseUrl,
        VITE_SUPABASE_URL: supabaseUrl,
        SUPABASE_PUBLISHABLE_KEY: FAKE_KEY,
        VITE_SUPABASE_PUBLISHABLE_KEY: FAKE_KEY,
        SUPABASE_SERVICE_ROLE_KEY: OPAQUE,
      };
      const spec = buildDevServerSpec(verified, { kind: "local" });
      // The serialized spec, which Playwright would write into its report, has no key.
      expect(JSON.stringify(spec)).not.toContain(OPAQUE);
      expect(spec.inheritServiceKey).toBe(true);

      launcher = spawn(process.execPath, ["e2e/safety/start-dev-server.mjs"], {
        // What Playwright does: the runner's environment (here carrying the key) plus the spec.
        env: {
          ...process.env,
          SUPABASE_SERVICE_ROLE_KEY: OPAQUE,
          [DEV_SERVER_SPEC_VAR]: JSON.stringify(spec),
        },
        stdio: "ignore",
      });
      let ready = false;
      for (let i = 0; i < 100 && !ready; i++) {
        try {
          ready = (await fetch(`${base}/`)).ok;
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      expect(ready).toBe(true);

      const [viteProcess] = childrenOf(launcher.pid!);
      const env = initialEnv(viteProcess);
      // The server needs the key (its server functions build an admin client from it) ...
      expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe(OPAQUE);
      // ... and gets the placeholder, never the live token from .env.production.
      const fromFile = /^\s*VITE_PAYMENTS_CLIENT_TOKEN\s*=\s*(.*)$/m
        .exec(readFileSync(".env.production", "utf8"))?.[1]
        ?.trim()
        .replace(/^(['"])(.*)\1$/, "$2");
      expect(fromFile).toBeTruthy();
      expect(env.VITE_PAYMENTS_CLIENT_TOKEN).toBe("e2e-payments-disabled");
      expect(JSON.stringify(env)).not.toContain(fromFile!);
      // What the browser would be served: the placeholder is inlined, the live token is not.
      const served = await (await fetch(`${base}/src/lib/stripe.ts`)).text();
      expect(served).toContain("e2e-payments-disabled");
      expect(served).not.toContain(fromFile!);
    },
    240_000,
  );
});
