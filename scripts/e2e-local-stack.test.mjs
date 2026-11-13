// The local E2E Supabase stack (e2e/local-stack): its keys, the environment it prints, and the
// gateway that stands in for Supabase's Kong. No Docker here: the gateway is exercised against
// stub upstreams on ephemeral loopback ports.
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { connect } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startGateway } from "../e2e/local-stack/gateway.mjs";
import {
  envExports,
  generateSecrets,
  LOCAL_PROJECT_LABEL,
  localApiKeys,
  mintJwt,
  routeRequest,
} from "../e2e/local-stack/lib.mjs";
import { buildDevServerSpec } from "../e2e/safety/dev-server";
import { assertSafeE2eTarget, resolveE2eTarget } from "../e2e/safety/target-guard";

const claims = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

describe("keys", () => {
  it("mints HS256 tokens that verify against the secret", () => {
    const jwt = mintJwt("s3cret", { role: "anon" });
    const [h, b, sig] = jwt.split(".");
    expect(createHmac("sha256", "s3cret").update(`${h}.${b}`).digest("base64url")).toBe(sig);
    expect(claims(jwt)).toEqual({ role: "anon" });
  });

  it("generates fresh secrets on every run", () => {
    const a = generateSecrets();
    const b = generateSecrets();
    expect(a.jwtSecret).not.toBe(b.jwtSecret);
    expect(a.dbPassword).not.toBe(b.dbPassword);
    expect(a.jwtSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(a.realtimeEncKey).toHaveLength(16);
  });

  it("mints anon and service_role keys that name no project", () => {
    const keys = localApiKeys("x".repeat(64), 1_000);
    expect(claims(keys.anon)).toMatchObject({ role: "anon", iat: 1_000 });
    expect(claims(keys.serviceRole)).toMatchObject({ role: "service_role" });
    for (const k of [keys.anon, keys.serviceRole]) {
      expect(claims(k)).not.toHaveProperty("ref");
      expect(claims(k).iss).not.toMatch(/supabase\.(co|in)/);
    }
  });
});

describe("the environment the stack prints", () => {
  const keys = localApiKeys("y".repeat(64));
  const env = Object.fromEntries(
    envExports({ apiUrl: "http://127.0.0.1:54321", keys })
      .split("\n")
      .map((line) => /^export ([A-Z0-9_]+)='(.*)'$/.exec(line))
      .map((m) => [m[1], m[2]]),
  );

  it("is accepted by the E2E target guard as a local target, and only as that", () => {
    expect(assertSafeE2eTarget(env)).toEqual({ kind: "local" });
    expect(env.SUPABASE_PROJECT_ID).toBe(LOCAL_PROJECT_LABEL);
  });

  it("builds the dev server's environment without the service role key in the spec", () => {
    const spec = buildDevServerSpec(env, { kind: "local" });
    expect(spec.env.VITE_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(spec.env.SUPABASE_PUBLISHABLE_KEY).toBe(keys.anon);
    expect(spec.env).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
    expect(spec.inheritServiceKey).toBe(true);
  });

  it("names the storage key supabase-js derives from the loopback API host", () => {
    // global-setup injects the session as sb-<SUPABASE_PROJECT_ID>-auth-token; the browser
    // client reads sb-<first label of the API host>-auth-token.
    expect(`sb-${env.SUPABASE_PROJECT_ID}-auth-token`).toBe(
      `sb-${new URL(env.SUPABASE_URL).hostname.split(".")[0]}-auth-token`,
    );
  });

  it("is still refused when pointed anywhere but loopback", () => {
    const remote = { ...env, SUPABASE_URL: "http://10.1.2.3:54321" };
    expect(resolveE2eTarget(remote).ok).toBe(false);
  });
});

describe("routing", () => {
  const up = { auth: "http://127.0.0.1:1", rest: "http://127.0.0.1:2" };

  it("strips the service prefix and keeps the query", () => {
    expect(routeRequest("/rest/v1/games?select=*", up)).toEqual({
      service: "rest",
      url: "http://127.0.0.1:2/games?select=*",
      needsKey: true,
    });
    expect(routeRequest("/auth/v1/token?grant_type=password", up).url).toBe(
      "http://127.0.0.1:1/token?grant_type=password",
    );
  });

  it("serves the auth redirect endpoints and storage without an API key, as Supabase does", () => {
    expect(routeRequest("/auth/v1/verify?token=t", up).needsKey).toBe(false);
    expect(routeRequest("/auth/v1/user", up).needsKey).toBe(true);
    expect(routeRequest("/storage/v1/object/public/a/b", { storage: "http://s:1" }).needsKey).toBe(
      false,
    );
  });

  it("maps realtime to its socket and API paths", () => {
    const rt = { realtime: "http://127.0.0.1:3" };
    expect(routeRequest("/realtime/v1/websocket?vsn=1.0.0", rt).url).toBe(
      "http://127.0.0.1:3/socket/websocket?vsn=1.0.0",
    );
    expect(routeRequest("/realtime/v1/api/broadcast", rt).url).toBe(
      "http://127.0.0.1:3/api/broadcast",
    );
  });

  it("answers 503 for a service that is not running and 404 for anything else", () => {
    expect(routeRequest("/storage/v1/bucket", up)).toMatchObject({ status: 503 });
    expect(routeRequest("/functions/v1/x", up)).toMatchObject({ status: 404 });
    expect(routeRequest("/rest/v2/x", up)).toMatchObject({ status: 404 });
  });
});

describe("gateway", () => {
  const ANON = "anon-key";
  const SERVICE = "service-key";
  let rest;
  let realtime;
  let gateway;
  let base;
  const seen = [];

  const listen = (server) =>
    new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

  beforeAll(async () => {
    rest = createServer((req, res) => {
      seen.push({ url: req.url, headers: req.headers });
      res.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "https://upstream.example",
      });
      res.end(JSON.stringify({ path: req.url }));
    });
    realtime = createServer();
    realtime.on("upgrade", (req, socket) => {
      seen.push({ upgrade: req.url, host: req.headers.host });
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: upgrade\r\n\r\n",
      );
      socket.on("data", (d) => socket.write(d));
    });
    const restPort = await listen(rest);
    const rtPort = await listen(realtime);
    gateway = await startGateway({
      port: 0,
      upstreams: {
        auth: `http://127.0.0.1:${restPort}`,
        rest: `http://127.0.0.1:${restPort}`,
        realtime: `http://127.0.0.1:${rtPort}`,
      },
      apiKeys: [ANON, SERVICE],
    });
    base = `http://127.0.0.1:${gateway.address().port}`;
  });

  afterAll(() => {
    gateway?.close();
    rest?.close();
    realtime?.close();
  });

  it("listens on loopback only", () => {
    expect(gateway.address().address).toBe("127.0.0.1");
  });

  it("forwards a keyed request and adds Authorization from the key", async () => {
    const res = await fetch(`${base}/rest/v1/hosted_games?select=id`, {
      headers: { apikey: ANON },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: "/hosted_games?select=id" });
    expect(seen.at(-1).headers.authorization).toBe(`Bearer ${ANON}`);
  });

  it("keeps the client's own Authorization", async () => {
    await fetch(`${base}/rest/v1/x`, {
      headers: { apikey: ANON, authorization: "Bearer user-jwt" },
    });
    expect(seen.at(-1).headers.authorization).toBe("Bearer user-jwt");
  });

  it("refuses a missing or unknown API key", async () => {
    expect((await fetch(`${base}/rest/v1/x`)).status).toBe(401);
    expect((await fetch(`${base}/rest/v1/x`, { headers: { apikey: "nope" } })).status).toBe(401);
    expect((await fetch(`${base}/auth/v1/user?apikey=nope`)).status).toBe(401);
    expect((await fetch(`${base}/auth/v1/verify`)).status).toBe(200);
  });

  it("answers CORS itself and replaces the upstream's CORS headers", async () => {
    const pre = await fetch(`${base}/rest/v1/x`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:8080", "access-control-request-headers": "apikey" },
    });
    expect(pre.status).toBe(200);
    expect(pre.headers.get("access-control-allow-origin")).toBe("http://localhost:8080");
    expect(pre.headers.get("access-control-allow-headers")).toBe("apikey");
    const res = await fetch(`${base}/rest/v1/x`, {
      headers: { apikey: ANON, origin: "http://localhost:8080" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:8080");
  });

  it("splices a keyed WebSocket upgrade to Realtime with the tenant host, and refuses one without a key", async () => {
    const { port } = gateway.address();
    const handshake = (path) =>
      new Promise((resolve) => {
        const s = connect(port, "127.0.0.1", () =>
          s.write(
            `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`,
          ),
        );
        let buf = "";
        s.on("data", (d) => {
          buf += d;
          if (buf.includes("\r\n\r\n") && !buf.endsWith("ping")) {
            if (buf.startsWith("HTTP/1.1 101")) s.write("ping");
            else {
              s.destroy();
              resolve(buf);
            }
          } else if (buf.endsWith("ping")) {
            s.destroy();
            resolve(buf);
          }
        });
        s.on("close", () => resolve(buf));
      });
    const ok = await handshake(`/realtime/v1/websocket?apikey=${ANON}&vsn=1.0.0`);
    expect(ok.startsWith("HTTP/1.1 101")).toBe(true);
    expect(ok.endsWith("ping")).toBe(true);
    expect(seen.at(-1)).toEqual({
      upgrade: `/socket/websocket?apikey=${ANON}&vsn=1.0.0`,
      host: "realtime-dev.localhost",
    });
    const refused = await handshake("/realtime/v1/websocket?vsn=1.0.0");
    expect(refused.startsWith("HTTP/1.1 401")).toBe(true);
  });
});
