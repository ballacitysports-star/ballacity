// A small stand-in for Supabase's API gateway (Kong) in the local E2E stack. It serves one
// origin on 127.0.0.1 and routes, as the hosted platform does:
//
//   /auth/v1/*      -> GoTrue
//   /rest/v1/*      -> PostgREST
//   /realtime/v1/*  -> Realtime (HTTP and WebSocket), when that service runs
//   /storage/v1/*   -> Storage, when that service runs (503 otherwise)
//
// Like Kong it refuses a request without a known API key (except the auth redirect
// endpoints), copies the key into Authorization when the client sent none, and answers
// CORS for the dev server's origin. It binds to loopback only.
//
// Run by stack.mjs with its configuration in LOCAL_GATEWAY_CONFIG (JSON); importable for tests.
import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { pathToFileURL } from "node:url";
import { apiKeyOf, corsHeaders, routeRequest, upstreamHeaders } from "./lib.mjs";

/** Realtime finds its tenant from the first label of the Host header (SEED_SELF_HOST tenant). */
const REALTIME_TENANT_HOST = "realtime-dev.localhost";

const DROP_UPSTREAM = /^access-control-/i;

function sendJson(res, status, body, cors) {
  res.writeHead(status, { "content-type": "application/json", ...cors });
  res.end(JSON.stringify(body));
}

/**
 * @param {{ upstreams: Record<string, string>, apiKeys: string[] }} config
 * @returns {import("node:http").Server}
 */
export function createGateway(config) {
  const known = new Set(config.apiKeys);

  const server = createServer((req, res) => {
    const cors = corsHeaders(req.headers.origin, req.headers["access-control-request-headers"]);
    if (req.method === "OPTIONS") {
      res.writeHead(200, cors);
      res.end();
      return;
    }
    const route = routeRequest(req.url ?? "/", config.upstreams);
    if ("status" in route) return sendJson(res, route.status, { message: route.message }, cors);
    const key = apiKeyOf(req.headers, req.url ?? "/");
    if (route.needsKey && (!key || !known.has(key))) {
      return sendJson(
        res,
        401,
        { message: key ? "Invalid API key" : "No API key found in request" },
        cors,
      );
    }
    const target = new URL(route.url);
    const host = route.service === "realtime" ? REALTIME_TENANT_HOST : target.host;
    const upstream = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        method: req.method,
        path: target.pathname + target.search,
        headers: upstreamHeaders(req.headers, key, host),
      },
      (up) => {
        const headers = {};
        for (const [k, v] of Object.entries(up.headers)) {
          if (!DROP_UPSTREAM.test(k) && v !== undefined) headers[k] = v;
        }
        res.writeHead(up.statusCode ?? 502, { ...headers, ...cors });
        up.pipe(res);
      },
    );
    upstream.on("error", (err) => {
      if (!res.headersSent)
        sendJson(res, 502, { message: `${route.service} unreachable: ${err.code}` }, cors);
      else res.destroy();
    });
    req.pipe(upstream);
  });

  // WebSockets (Realtime): check the key, then splice the raw connection to the upstream.
  server.on("upgrade", (req, socket, head) => {
    const route = routeRequest(req.url ?? "/", config.upstreams);
    const key = apiKeyOf(req.headers, req.url ?? "/");
    if ("status" in route || route.service !== "realtime" || !key || !known.has(key)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n");
      return;
    }
    const target = new URL(route.url);
    const up = connect(Number(target.port), target.hostname, () => {
      const lines = [`${req.method} ${target.pathname}${target.search} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i];
        if (name.toLowerCase() === "host") continue;
        lines.push(`${name}: ${req.rawHeaders[i + 1]}`);
      }
      lines.push(`Host: ${REALTIME_TENANT_HOST}`);
      up.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head?.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    const close = () => {
      up.destroy();
      socket.destroy();
    };
    up.on("error", close);
    socket.on("error", close);
  });

  return server;
}

/** Starts the gateway on 127.0.0.1 only. Resolves with the server once it listens. */
export function startGateway(config) {
  const server = createGateway(config);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port ?? 0, "127.0.0.1", () => resolve(server));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const config = JSON.parse(process.env.LOCAL_GATEWAY_CONFIG ?? "null");
  if (!config) {
    console.error("[local gateway] LOCAL_GATEWAY_CONFIG is not set; start it with stack.mjs up.");
    process.exit(2);
  }
  const server = await startGateway(config);
  console.log(`[local gateway] listening on http://127.0.0.1:${server.address().port}`);
}
