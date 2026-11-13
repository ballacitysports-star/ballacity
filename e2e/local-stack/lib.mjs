// Pure helpers for the local E2E Supabase stack (stack.mjs, gateway.mjs). No I/O here, so
// scripts/e2e-local-stack.test.mjs can exercise them directly.
import { createHmac, randomBytes } from "node:crypto";

/** Issuer of the API keys minted here. Not a Supabase project, and it carries no `ref` claim. */
export const LOCAL_KEY_ISSUER = "ballacity-e2e-local";

/**
 * The project label for a local run. supabase-js names its storage key after the first label
 * of the API host (`sb-127-auth-token` for 127.0.0.1), and global-setup builds the injected
 * session's key from SUPABASE_PROJECT_ID, so the two agree only when this is "127".
 */
export const LOCAL_PROJECT_LABEL = "127";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** HS256 JWT. */
export function mintJwt(secret, payload) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

/** Fresh random secrets for one run of the stack. Nothing is reused between runs. */
export function generateSecrets(rand = randomBytes) {
  return {
    jwtSecret: rand(32).toString("hex"),
    dbPassword: rand(24).toString("hex"),
    // Realtime wants exactly 16 bytes for its encryption key and at least 64 for the cookie key.
    realtimeEncKey: rand(8).toString("hex"),
    realtimeSecretKeyBase: rand(48).toString("hex"),
  };
}

/** The anon and service_role API keys for a JWT secret. Valid for 30 days; a run lasts minutes. */
export function localApiKeys(jwtSecret, nowSec = Math.floor(Date.now() / 1000)) {
  const claims = (role) => ({
    iss: LOCAL_KEY_ISSUER,
    role,
    iat: nowSec,
    exp: nowSec + 30 * 24 * 3600,
  });
  return {
    anon: mintJwt(jwtSecret, claims("anon")),
    serviceRole: mintJwt(jwtSecret, claims("service_role")),
  };
}

/** Auth endpoints that Supabase's gateway serves without an API key (browser redirects). */
const OPEN_AUTH_PATHS = new Set(["/verify", "/callback", "/authorize"]);

/**
 * Where a gateway request goes. `upstreams` maps auth/rest/realtime/storage to base URLs
 * (realtime and storage may be absent). Returns { service, url, needsKey } or { status, message }.
 */
export function routeRequest(pathAndQuery, upstreams) {
  const u = new URL(pathAndQuery, "http://gateway.invalid");
  const m = /^\/(auth|rest|realtime|storage)\/v1(\/.*)?$/.exec(u.pathname);
  if (!m) return { status: 404, message: "no route" };
  const service = m[1];
  const rest = m[2] ?? "/";
  const base = upstreams[service];
  if (!base) {
    return {
      status: 503,
      message: `${service} is not running in the local E2E stack (its image is not available)`,
    };
  }
  // Realtime serves its socket under /socket (Supabase's gateway rewrites /realtime/v1 to it)
  // and its REST endpoints under /api.
  const upstreamPath =
    service === "realtime" ? (rest.startsWith("/api/") ? rest : `/socket${rest}`) : rest;
  const target = new URL(base.replace(/\/+$/, "") + upstreamPath);
  target.search = u.search;
  // Storage checks its own JWTs (Supabase's gateway asks no key of it: public object URLs are
  // plain links), and a few auth endpoints are browser redirects.
  const needsKey =
    service !== "storage" && !(service === "auth" && OPEN_AUTH_PATHS.has(rest.replace(/\/+$/, "")));
  return { service, url: target.toString(), needsKey };
}

/** The API key a request carries: the apikey header, else the apikey query parameter. */
export function apiKeyOf(headers, pathAndQuery) {
  const h = headers.apikey;
  if (typeof h === "string" && h.trim()) return h.trim();
  const q = new URL(pathAndQuery, "http://gateway.invalid").searchParams.get("apikey");
  return q && q.trim() ? q.trim() : null;
}

/**
 * The upstream request headers: everything the client sent, plus Authorization taken from the
 * API key when the client sent none (what Supabase's gateway does for PostgREST and Auth).
 */
export function upstreamHeaders(headers, apiKey, hostHeader) {
  const out = { ...headers, host: hostHeader };
  if (apiKey && !out.authorization) out.authorization = `Bearer ${apiKey}`;
  return out;
}

/** CORS headers for a response to `origin`. Every origin is allowed: the gateway is loopback-only. */
export function corsHeaders(origin, requestedHeaders) {
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers":
      requestedHeaders ||
      "authorization,apikey,content-type,x-client-info,prefer,range,accept-profile,content-profile,x-upsert",
    "access-control-expose-headers": "content-range,content-location,x-total-count,range-unit",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

/** Shell `export` lines for the environment the suite and the dev server read. */
export function envExports({ apiUrl, keys, baseUrl = "http://localhost:8080" }) {
  const vars = {
    SUPABASE_URL: apiUrl,
    VITE_SUPABASE_URL: apiUrl,
    SUPABASE_PROJECT_ID: LOCAL_PROJECT_LABEL,
    VITE_SUPABASE_PROJECT_ID: LOCAL_PROJECT_LABEL,
    SUPABASE_PUBLISHABLE_KEY: keys.anon,
    VITE_SUPABASE_PUBLISHABLE_KEY: keys.anon,
    SUPABASE_SERVICE_ROLE_KEY: keys.serviceRole,
    E2E_BASE_URL: baseUrl,
  };
  return Object.entries(vars)
    .map(([k, v]) => `export ${k}='${v}'`)
    .join("\n");
}
