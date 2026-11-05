/**
 * BallaCity image processor: a minimal, stateless Node HTTP service that runs the canonical re-encoder (sharp) for the Worker.
 * DESIGN ONLY, NOT DEPLOYED. Evaluation: docs/privacy/image-runtime-evaluation.md, "Part B".
 *
 * What it does: POST /v1/reencode with the image bytes as the body, authenticated with an HMAC-signed request (timestamp, single-use
 * nonce, body hash; src/lib/image-runtime/hmac.ts). It runs `reencodeImage` from src/lib/image-reencode.server.ts (imported, not
 * copied, so the two runtimes cannot drift) and answers with the re-encoded bytes and metadata, or a refusal code. Every answer to
 * an authenticated request is signed over the request nonce, so the Worker accepts only the answer to its own request.
 *
 * What it does NOT have: storage credentials, database access, user ids, file names or paths (the request carries only bytes),
 * outbound network calls (no fetch anywhere in this service; egress must also be denied by the platform), or any state beyond the
 * in-memory nonce cache. Nothing is written to disk.
 *
 * Order of checks (audit F14): route, content type and declared size; then the request signature, verified from the
 * headers alone (it covers the claimed body hash), with the nonce claimed; only then a processing slot; then the body, read
 * under a deadline and checked against the signed hash. An unsigned, forged or replayed request is refused before it can
 * take a slot or have any of its body read, so slow unsigned bodies cannot starve the Worker's requests.
 *
 * Hard limits: body size (8 MB, the app's MAX_IMAGE_BYTES), body read time (10 s), pixel count (30 MP, sharp's
 * limitInputPixels inside reencodeImage), per-request timeout (the response is 503 "unavailable" when it fires), concurrent
 * re-encodes per instance (503 when full), header/request timeouts on the HTTP server.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  ImageReencodeError,
  reencodeImage,
  type ReencodeResult,
} from "@/lib/image-reencode.server";
import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from "@/lib/image-validation";
import {
  DEFAULT_SKEW_MS,
  MIN_SECRET_BYTES,
  NonceCache,
  bodyMatches,
  canonicalResponse,
  hmacHex,
  sha256Hex,
  verifyRequestHeaders,
  SIGNATURE_HEADERS,
} from "@/lib/image-runtime/hmac";
import {
  PROCESSOR_PATH,
  RESULT_CONTENT_TYPE,
  encodeResult,
} from "@/lib/image-runtime/processor-protocol";

export type ProcessorConfig = {
  secret: string;
  maxBodyBytes: number;
  /** How long an authenticated request may take to deliver its body. */
  bodyTimeoutMs: number;
  maxPixels: number;
  timeoutMs: number;
  maxConcurrent: number;
  skewMs: number;
  /** Test seam: the re-encoder. Defaults to reencodeImage with `maxPixels`. */
  reencode?: (bytes: Uint8Array) => Promise<ReencodeResult>;
  /** Test seam: the clock. */
  now?: () => number;
};

export const DEFAULT_CONFIG: Omit<ProcessorConfig, "secret"> = {
  maxBodyBytes: MAX_IMAGE_BYTES,
  bodyTimeoutMs: 10_000,
  maxPixels: MAX_IMAGE_PIXELS,
  timeoutMs: 20_000,
  maxConcurrent: 2,
  skewMs: DEFAULT_SKEW_MS,
};

/** Environment variable names that must never be present: this service holds no storage or cloud credentials. */
const FORBIDDEN_ENV =
  /SUPABASE|SERVICE_ROLE|DATABASE_URL|^PG|AWS_(SECRET|ACCESS_KEY|SESSION_TOKEN)|GOOGLE_APPLICATION_CREDENTIALS|^R2_|CLOUDFLARE_API|STORAGE/i;

export function configFromEnv(env: Record<string, string | undefined>): ProcessorConfig {
  const leaked = Object.keys(env).filter((k) => FORBIDDEN_ENV.test(k) && env[k]);
  if (leaked.length)
    throw new Error(`refusing to start with credentials in the environment: ${leaked.join(", ")}`);
  const secret = env.IMAGE_PROCESSOR_SECRET ?? "";
  if (new TextEncoder().encode(secret).byteLength < MIN_SECRET_BYTES)
    throw new Error(`IMAGE_PROCESSOR_SECRET must be at least ${MIN_SECRET_BYTES} bytes`);
  const int = (name: string, def: number, min: number, max: number) => {
    const v = env[name];
    if (v === undefined || v === "") return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} out of range`);
    return n;
  };
  return {
    secret,
    // The limits can only be lowered from the app's own.
    maxBodyBytes: int(
      "IMAGE_PROCESSOR_MAX_BODY_BYTES",
      DEFAULT_CONFIG.maxBodyBytes,
      1,
      MAX_IMAGE_BYTES,
    ),
    bodyTimeoutMs: int(
      "IMAGE_PROCESSOR_BODY_TIMEOUT_MS",
      DEFAULT_CONFIG.bodyTimeoutMs,
      100,
      DEFAULT_CONFIG.bodyTimeoutMs,
    ),
    maxPixels: int("IMAGE_PROCESSOR_MAX_PIXELS", DEFAULT_CONFIG.maxPixels, 1, MAX_IMAGE_PIXELS),
    timeoutMs: int("IMAGE_PROCESSOR_TIMEOUT_MS", DEFAULT_CONFIG.timeoutMs, 100, 60_000),
    maxConcurrent: int("IMAGE_PROCESSOR_MAX_CONCURRENT", DEFAULT_CONFIG.maxConcurrent, 1, 16),
    skewMs: int("IMAGE_PROCESSOR_SKEW_MS", DEFAULT_CONFIG.skewMs, 1_000, 300_000),
  };
}

class BodyTooLarge extends Error {}
class BodyTimeout extends Error {}

/** The body, at most `cap` bytes, delivered within `timeoutMs`; otherwise BodyTooLarge or BodyTimeout. */
function readBody(req: IncomingMessage, cap: number, timeoutMs: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let total = 0;
    let settled = false;
    const stop = (e: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.removeAllListeners("data");
      req.pause();
      reject(e);
    };
    const timer = setTimeout(() => stop(new BodyTimeout()), timeoutMs);
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > cap) return stop(new BodyTooLarge());
      parts.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const b = Buffer.concat(parts);
      resolve(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
    });
    req.on("error", stop);
  });
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": String(bytes.length),
    "cache-control": "no-store",
    ...headers,
  });
  res.end(bytes);
}

/** Close the connection after answering: an oversized, slow or unauthenticated body is not read any further. */
function refuse(res: ServerResponse, status: number, code: string) {
  res.setHeader("connection", "close");
  res.once("finish", () => res.req.socket?.destroy());
  sendJson(res, status, { code });
}

async function sendSigned(
  res: ServerResponse,
  secret: string,
  nonce: string,
  status: number,
  body: Uint8Array,
  contentType: string,
) {
  const signature = await hmacHex(
    secret,
    canonicalResponse({ nonce, status, bodySha256: await sha256Hex(body) }),
  );
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": String(body.byteLength),
    "cache-control": "no-store",
    [SIGNATURE_HEADERS.signature]: signature,
  });
  res.end(body);
}

export function createImageProcessor(config: ProcessorConfig): Server {
  const nonces = new NonceCache(2 * config.skewMs);
  const now = config.now ?? Date.now;
  const reencode =
    config.reencode ??
    ((bytes: Uint8Array) => reencodeImage(bytes, { maxPixels: config.maxPixels }));
  let inFlight = 0;

  const server = createServer(async (req, res) => {
    try {
      const path = (req.url ?? "").split("?")[0];
      if (req.method === "GET" && path === "/healthz") return sendJson(res, 200, { ok: true });
      if (path !== PROCESSOR_PATH) return refuse(res, 404, "not_found");
      if (req.method !== "POST") return refuse(res, 405, "method");
      if ((req.headers["content-type"] ?? "").split(";")[0].trim() !== "application/octet-stream")
        return refuse(res, 415, "unsupported");
      const declared = req.headers["content-length"];
      if (declared !== undefined && !(Number(declared) <= config.maxBodyBytes))
        return refuse(res, 413, "too_large");
      // Authenticate before admission and before reading any of the body (F14).
      const auth = await verifyRequestHeaders(config.secret, {
        method: req.method,
        path,
        headers: (name) => {
          const v = req.headers[name];
          return Array.isArray(v) ? null : v;
        },
        now: now(),
        nonces,
        skewMs: config.skewMs,
      });
      if (!auth.ok) return refuse(res, 401, "unauthorized");
      if (inFlight >= config.maxConcurrent) return refuse(res, 503, "unavailable");
      inFlight += 1;
      // The slot is held until the re-encode itself settles, not until the response: a timed-out decode keeps its slot.
      let pending: Promise<unknown> | null = null;
      try {
        let body: Uint8Array;
        try {
          body = await readBody(req, config.maxBodyBytes, config.bodyTimeoutMs);
        } catch (e) {
          if (e instanceof BodyTooLarge) return refuse(res, 413, "too_large");
          if (e instanceof BodyTimeout) return refuse(res, 408, "timeout");
          throw e;
        }
        if (!(await bodyMatches(body, auth.bodySha256))) return refuse(res, 401, "unauthorized");

        let timer: ReturnType<typeof setTimeout> | undefined;
        const work = reencode(body);
        pending = work;
        const outcome = await Promise.race([
          work.then(
            (r) => ({ ok: true as const, r }),
            (e) => ({ ok: false as const, e }),
          ),
          new Promise<{ ok: false; e: ImageReencodeError }>((resolve) => {
            timer = setTimeout(
              () => resolve({ ok: false, e: new ImageReencodeError("unavailable", "timeout") }),
              config.timeoutMs,
            );
          }),
        ]).finally(() => clearTimeout(timer));

        if (outcome.ok)
          return await sendSigned(
            res,
            config.secret,
            auth.nonce,
            200,
            encodeResult(outcome.r),
            RESULT_CONTENT_TYPE,
          );
        const code = outcome.e instanceof ImageReencodeError ? outcome.e.code : "unreadable";
        const status = code === "unavailable" ? 503 : 422;
        return await sendSigned(
          res,
          config.secret,
          auth.nonce,
          status,
          new TextEncoder().encode(JSON.stringify({ code })),
          "application/json",
        );
      } finally {
        const release = () => {
          inFlight -= 1;
        };
        if (pending) void pending.then(release, release);
        else release();
      }
    } catch {
      if (!res.headersSent) refuse(res, 500, "unavailable");
      else res.destroy();
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = config.timeoutMs + 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 32;
  return server;
}
