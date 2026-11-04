import { describe, expect, it } from "vitest";
import {
  NonceCache,
  SIGNATURE_HEADERS,
  canonicalResponse,
  hmacHex,
  safeEqualHex,
  signRequest,
  verifyRequest,
} from "./hmac";

const SECRET = "s".repeat(40);
const body = new TextEncoder().encode("image bytes");
const T = 1_800_000_000_000;

async function verify(
  headers: Record<string, string>,
  over: Partial<{
    body: Uint8Array;
    method: string;
    path: string;
    now: number;
    secret: string;
    nonces: NonceCache;
  }> = {},
) {
  return verifyRequest(over.secret ?? SECRET, {
    method: over.method ?? "POST",
    path: over.path ?? "/v1/reencode",
    headers: (n) => headers[n],
    body: over.body ?? body,
    now: over.now ?? T,
    nonces: over.nonces ?? new NonceCache(120_000),
  });
}
const sign = (over: Partial<{ now: number; nonce: string; path: string }> = {}) =>
  signRequest(SECRET, {
    method: "POST",
    path: over.path ?? "/v1/reencode",
    body,
    now: over.now ?? T,
    nonce: over.nonce,
  });

describe("image processor HMAC: requests", () => {
  it("accepts a correctly signed request", async () => {
    expect(await verify(await sign())).toMatchObject({ ok: true });
  });

  it("refuses a replay of the same request (same nonce) within the window", async () => {
    const nonces = new NonceCache(120_000);
    const h = await sign();
    expect((await verify(h, { nonces })).ok).toBe(true);
    expect(await verify(h, { nonces })).toEqual({ ok: false, reason: "replay" });
    expect(await verify(h, { nonces, now: T + 30_000 })).toEqual({ ok: false, reason: "replay" });
  });

  it("refuses clock skew beyond 60 s either way, accepts just inside", async () => {
    expect(await verify(await sign({ now: T - 60_001 }))).toEqual({ ok: false, reason: "skew" });
    expect(await verify(await sign({ now: T + 60_001 }))).toEqual({ ok: false, reason: "skew" });
    expect((await verify(await sign({ now: T - 59_000 }))).ok).toBe(true);
  });

  it("refuses tampering with the body, path, method, timestamp, nonce or signature, and a wrong secret", async () => {
    const h = await sign();
    expect(await verify(h, { body: new TextEncoder().encode("other bytes") })).toEqual({
      ok: false,
      reason: "body",
    });
    expect(await verify(h, { path: "/v1/other" })).toEqual({ ok: false, reason: "signature" });
    expect(await verify(h, { method: "PUT" })).toEqual({ ok: false, reason: "signature" });
    expect(await verify({ ...h, [SIGNATURE_HEADERS.timestamp]: String(T + 1) })).toEqual({
      ok: false,
      reason: "signature",
    });
    expect(await verify({ ...h, [SIGNATURE_HEADERS.nonce]: "0".repeat(32) })).toEqual({
      ok: false,
      reason: "signature",
    });
    const sig = h[SIGNATURE_HEADERS.signature];
    const flipped = (sig[0] === "a" ? "b" : "a") + sig.slice(1);
    expect(await verify({ ...h, [SIGNATURE_HEADERS.signature]: flipped })).toEqual({
      ok: false,
      reason: "signature",
    });
    expect(await verify(h, { secret: "t".repeat(40) })).toEqual({ ok: false, reason: "signature" });
    // a body hash header that matches a different body is caught before the signature
    const other = await signRequest(SECRET, {
      method: "POST",
      path: "/v1/reencode",
      body: new Uint8Array([1]),
      now: T,
    });
    expect(
      await verify({ ...h, [SIGNATURE_HEADERS.bodySha256]: other[SIGNATURE_HEADERS.bodySha256] }),
    ).toEqual({ ok: false, reason: "body" });
  });

  it("refuses missing and malformed headers", async () => {
    const h = await sign();
    for (const k of Object.values(SIGNATURE_HEADERS)) {
      const { [k]: _gone, ...rest } = h;
      expect(await verify(rest)).toEqual({ ok: false, reason: "missing" });
    }
    expect(await verify({ ...h, [SIGNATURE_HEADERS.timestamp]: "1e12" })).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(await verify({ ...h, [SIGNATURE_HEADERS.nonce]: "short" })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("an unauthenticated request does not consume nonce-cache space", async () => {
    const nonces = new NonceCache(120_000);
    const h = await sign();
    await verify({ ...h, [SIGNATURE_HEADERS.signature]: "0".repeat(64) }, { nonces });
    expect(nonces.size).toBe(0);
  });

  it("the nonce cache is bounded and refuses (fails closed) when full of live nonces", () => {
    const c = new NonceCache(1000, 2);
    expect(c.claim("a", 0)).toBe(true);
    expect(c.claim("b", 0)).toBe(true);
    expect(c.claim("c", 10)).toBe(false);
    expect(c.claim("c", 1001)).toBe(true); // a and b expired and were evicted
  });

  it("refuses a secret shorter than 32 bytes", async () => {
    await expect(hmacHex("short", "x")).rejects.toThrow(/at least 32 bytes/);
  });
});

describe("image processor HMAC: responses", () => {
  it("binds the response to the request nonce, status and body", async () => {
    const a = await hmacHex(
      SECRET,
      canonicalResponse({ nonce: "n1", status: 200, bodySha256: "h" }),
    );
    for (const other of [
      { nonce: "n2", status: 200, bodySha256: "h" },
      { nonce: "n1", status: 422, bodySha256: "h" },
      { nonce: "n1", status: 200, bodySha256: "g" },
    ])
      expect(safeEqualHex(a, await hmacHex(SECRET, canonicalResponse(other)))).toBe(false);
  });
});
