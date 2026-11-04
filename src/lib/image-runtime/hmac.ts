/**
 * Request and response authentication between the Worker and the Node image processor (services/image-processor).
 * WebCrypto only, so the same code runs in the Worker (client) and in Node 20+ (service).
 *
 * Request: HMAC-SHA256 over a canonical string that binds the method, path, a timestamp, a single-use nonce and the SHA-256 of
 * the body. The service accepts a request only if the timestamp is within the skew window, the signature matches (constant-time
 * comparison) and the nonce has not been seen within the window (checked AFTER the signature, so unauthenticated traffic cannot
 * fill the nonce cache). Response: HMAC over the request's nonce, the status and the SHA-256 of the response body, so the
 * Worker accepts only an answer to the request it made, unmodified.
 *
 * The secret is a random value of at least 32 bytes shared only by the Worker (secret binding) and the service (its secret
 * manager). It authorises nothing but "re-encode these bytes": the service holds no storage credentials.
 */

export const SIGNATURE_HEADERS = {
  timestamp: "x-bc-timestamp",
  nonce: "x-bc-nonce",
  bodySha256: "x-bc-content-sha256",
  signature: "x-bc-signature",
} as const;

export const MIN_SECRET_BYTES = 32;
export const DEFAULT_SKEW_MS = 60_000;

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string): Promise<CryptoKey> {
  if (encoder.encode(secret).byteLength < MIN_SECRET_BYTES)
    throw new Error(`image processor secret must be at least ${MIN_SECRET_BYTES} bytes`);
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    keyCache.set(secret, key);
  }
  return key;
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  return toHex(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(message)));
}

/** Constant-time comparison of two lowercase hex strings. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function canonicalRequest(p: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  bodySha256: string;
}): string {
  return ["bc-img-v1-req", p.method.toUpperCase(), p.path, p.timestamp, p.nonce, p.bodySha256].join(
    "\n",
  );
}

export function canonicalResponse(p: {
  nonce: string;
  status: number;
  bodySha256: string;
}): string {
  return ["bc-img-v1-res", p.nonce, String(p.status), p.bodySha256].join("\n");
}

export function newNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function signRequest(
  secret: string,
  p: { method: string; path: string; body: Uint8Array; now?: number; nonce?: string },
): Promise<Record<string, string>> {
  const timestamp = String(p.now ?? Date.now());
  const nonce = p.nonce ?? newNonce();
  const bodySha256 = await sha256Hex(p.body);
  const signature = await hmacHex(
    secret,
    canonicalRequest({ method: p.method, path: p.path, timestamp, nonce, bodySha256 }),
  );
  return {
    [SIGNATURE_HEADERS.timestamp]: timestamp,
    [SIGNATURE_HEADERS.nonce]: nonce,
    [SIGNATURE_HEADERS.bodySha256]: bodySha256,
    [SIGNATURE_HEADERS.signature]: signature,
  };
}

/** Single-use nonces, remembered for the skew window. Bounded: when full of live nonces it refuses (fail closed). */
export class NonceCache {
  private readonly seen = new Map<string, number>();
  constructor(
    private readonly ttlMs: number,
    private readonly max = 50_000,
  ) {}
  /** True if the nonce was fresh (and is now recorded). */
  claim(nonce: string, now: number): boolean {
    if (this.seen.has(nonce) && (this.seen.get(nonce) as number) > now) return false;
    if (this.seen.size >= this.max) {
      for (const [k, exp] of this.seen) if (exp <= now) this.seen.delete(k);
      if (this.seen.size >= this.max) return false;
    }
    this.seen.set(nonce, now + this.ttlMs);
    return true;
  }
  get size(): number {
    return this.seen.size;
  }
}

export type VerifyFailure = "missing" | "malformed" | "skew" | "body" | "signature" | "replay";

export async function verifyRequest(
  secret: string,
  p: {
    method: string;
    path: string;
    headers: (name: string) => string | null | undefined;
    body: Uint8Array;
    now: number;
    nonces: NonceCache;
    skewMs?: number;
  },
): Promise<{ ok: true; nonce: string } | { ok: false; reason: VerifyFailure }> {
  const timestamp = p.headers(SIGNATURE_HEADERS.timestamp);
  const nonce = p.headers(SIGNATURE_HEADERS.nonce);
  const claimedHash = p.headers(SIGNATURE_HEADERS.bodySha256);
  const signature = p.headers(SIGNATURE_HEADERS.signature);
  if (!timestamp || !nonce || !claimedHash || !signature) return { ok: false, reason: "missing" };
  if (
    !/^\d{1,16}$/.test(timestamp) ||
    !/^[0-9a-f]{32}$/.test(nonce) ||
    !/^[0-9a-f]{64}$/.test(signature)
  )
    return { ok: false, reason: "malformed" };
  if (Math.abs(p.now - Number(timestamp)) > (p.skewMs ?? DEFAULT_SKEW_MS))
    return { ok: false, reason: "skew" };
  const bodySha256 = await sha256Hex(p.body);
  if (!safeEqualHex(bodySha256, claimedHash)) return { ok: false, reason: "body" };
  const expected = await hmacHex(
    secret,
    canonicalRequest({ method: p.method, path: p.path, timestamp, nonce, bodySha256 }),
  );
  if (!safeEqualHex(expected, signature)) return { ok: false, reason: "signature" };
  // Remember the nonce for twice the window: a timestamp may be up to `skew` in the future.
  if (!p.nonces.claim(nonce, p.now)) return { ok: false, reason: "replay" };
  return { ok: true, nonce };
}
