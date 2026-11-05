/* eslint-disable @typescript-eslint/no-explicit-any -- raw HTTP test plumbing */
import { readFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  ImageReencodeError,
  reencodeImage,
  type ReencodeResult,
} from "@/lib/image-reencode.server";
import {
  SIGNATURE_HEADERS,
  canonicalResponse,
  hmacHex,
  sha256Hex,
  signRequest,
} from "@/lib/image-runtime/hmac";
import { createImageProcessorReencoder } from "@/lib/image-runtime/node-service-client";
import { PROCESSOR_PATH, RESULT_CONTENT_TYPE } from "@/lib/image-runtime/processor-protocol";
import { reencodeResultProblem } from "@/lib/image-runtime/reencode-contract";
import { alphaPng, solid, u8 } from "@/lib/image-runtime/test-support/fixtures";
import {
  DEFAULT_CONFIG,
  configFromEnv,
  createImageProcessor,
  type ProcessorConfig,
} from "../src/server";

/**
 * The Node image processor, in process: the real HTTP server on an ephemeral loopback port, the real Worker-side client (Node's
 * fetch standing in for the Worker's), and the real sharp re-encoder. Not deployed anywhere; no container was built.
 */

const SECRET = "x".repeat(48);
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function start(over: Partial<ProcessorConfig> = {}): Promise<string> {
  const server = createImageProcessor({ ...DEFAULT_CONFIG, secret: SECRET, ...over });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const client = (
  url: string,
  over: Partial<Parameters<typeof createImageProcessorReencoder>[0]> = {},
) => createImageProcessorReencoder({ url, secret: SECRET, ...over });

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ImageReencodeError);
    return (e as ImageReencodeError).code;
  }
  return "accepted";
};

/** A signed raw request, for the limit tests (bypasses the client's own checks). */
async function post(
  base: string,
  body: Uint8Array,
  headers: Record<string, string> = {},
  sign = true,
) {
  const signed = sign
    ? await signRequest(SECRET, { method: "POST", path: PROCESSOR_PATH, body })
    : {};
  const res = await fetch(base + PROCESSOR_PATH, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", ...signed, ...headers },
    body: body as BodyInit,
  });
  return { status: res.status, body: await res.text(), headers: res.headers };
}

describe("image processor: configuration", () => {
  it("refuses to start without a 32-byte secret or with storage credentials in the environment", () => {
    expect(() => configFromEnv({})).toThrow(/at least 32 bytes/);
    expect(() => configFromEnv({ IMAGE_PROCESSOR_SECRET: "short" })).toThrow(/at least 32 bytes/);
    for (const k of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_URL",
      "DATABASE_URL",
      "AWS_SECRET_ACCESS_KEY",
      "R2_ACCESS_KEY_ID",
    ])
      expect(() => configFromEnv({ IMAGE_PROCESSOR_SECRET: SECRET, [k]: "x" })).toThrow(
        /credentials/,
      );
    expect(configFromEnv({ IMAGE_PROCESSOR_SECRET: SECRET })).toMatchObject({
      maxBodyBytes: 8 * 1024 * 1024,
      maxPixels: 30_000_000,
      timeoutMs: 20_000,
      maxConcurrent: 2,
    });
  });

  it("limits can be lowered, never raised above the app's", () => {
    expect(
      configFromEnv({ IMAGE_PROCESSOR_SECRET: SECRET, IMAGE_PROCESSOR_MAX_PIXELS: "1000" })
        .maxPixels,
    ).toBe(1000);
    expect(() =>
      configFromEnv({ IMAGE_PROCESSOR_SECRET: SECRET, IMAGE_PROCESSOR_MAX_PIXELS: "40000000" }),
    ).toThrow();
    expect(() =>
      configFromEnv({ IMAGE_PROCESSOR_SECRET: SECRET, IMAGE_PROCESSOR_MAX_BODY_BYTES: "9000000" }),
    ).toThrow();
  });
});

describe("image processor: authentication over HTTP", () => {
  it("refuses unsigned, wrongly signed and replayed requests with 401, and never runs the re-encoder for them", async () => {
    let runs = 0;
    const base = await start({ reencode: async (b) => (runs++, reencodeImage(b)) });
    const jpg = u8(await solid(96, 64, "#123456").jpeg().toBuffer());
    expect((await post(base, jpg, {}, false)).status).toBe(401);
    const bad = await signRequest("y".repeat(48), {
      method: "POST",
      path: PROCESSOR_PATH,
      body: jpg,
    });
    expect((await post(base, jpg, bad, false)).status).toBe(401);
    expect(runs).toBe(0);
    const signed = await signRequest(SECRET, { method: "POST", path: PROCESSOR_PATH, body: jpg });
    expect((await post(base, jpg, signed, false)).status).toBe(200);
    expect((await post(base, jpg, signed, false)).status).toBe(401); // replay
    expect(runs).toBe(1);
  });

  it("refuses a signed request whose body was swapped in transit", async () => {
    const base = await start();
    const jpg = u8(await solid(96, 64, "#123456").jpeg().toBuffer());
    const signed = await signRequest(SECRET, { method: "POST", path: PROCESSOR_PATH, body: jpg });
    const other = u8(await solid(96, 64, "#654321").jpeg().toBuffer());
    expect((await post(base, other, signed, false)).status).toBe(401);
  });

  it("refuses a request signed too far in the past (server clock)", async () => {
    const base = await start({ now: () => Date.now() + 5 * 60_000 });
    expect((await post(base, u8(await solid(96, 64, "#123").jpeg().toBuffer()))).status).toBe(401);
  });
});

/**
 * A raw request whose body is written in `chunks` and then, unless `end`, left open: the client of a slow or stalled upload.
 * Resolves with the status as soon as the server answers (the body need not have been sent).
 */
function rawRequest(
  base: string,
  headers: Record<string, string>,
  chunks: Uint8Array[],
  end = true,
): { status: Promise<number>; abort: () => void } {
  const port = new URL(base).port;
  let req!: ReturnType<typeof request>;
  const status = new Promise<number>((resolve) => {
    req = request(
      {
        host: "127.0.0.1",
        port,
        path: PROCESSOR_PATH,
        method: "POST",
        headers: { "content-type": "application/octet-stream", ...headers },
      },
      (res) => {
        resolve(res.statusCode ?? 0);
        res.resume();
      },
    );
    // A reset after the answer, or of a connection the server closed, is expected here.
    req.on("error", () => resolve(-1));
    for (const c of chunks) req.write(c);
    if (end) req.end();
  });
  return { status, abort: () => req.destroy() };
}

describe("image processor: limits", () => {
  it("413 for a declared body over the cap before authentication, and for a signed streamed body over the cap, without running the re-encoder", async () => {
    let runs = 0;
    const base = await start({
      maxBodyBytes: 1000,
      reencode: async (b) => (runs++, reencodeImage(b)),
    });
    expect((await post(base, new Uint8Array(1001))).status).toBe(413);
    expect((await post(base, new Uint8Array(1001), {}, false)).status).toBe(413);
    // chunked, no content-length, signed for the 1600 bytes it carries
    const body = new Uint8Array(1600);
    const signed = await signRequest(SECRET, { method: "POST", path: PROCESSOR_PATH, body });
    const chunked = rawRequest(base, { ...signed, "transfer-encoding": "chunked" }, [
      body.subarray(0, 400),
      body.subarray(400, 800),
      body.subarray(800, 1200),
      body.subarray(1200),
    ]);
    expect(await chunked.status).toBe(413);
    // the same unsigned is refused before any of it is read
    const unsigned = rawRequest(base, { "transfer-encoding": "chunked" }, [body.subarray(0, 400)]);
    expect(await unsigned.status).toBe(401);
    expect(runs).toBe(0);
  });

  it("F14: slow unsigned bodies are refused before admission and cannot take the processing slots", async () => {
    let runs = 0;
    const base = await start({
      maxConcurrent: 2,
      reencode: async (b) => (runs++, reencodeImage(b)),
    });
    // Two (then many) requests that announce a body and never finish sending it, unsigned or with a forged signature.
    const forged = await signRequest("y".repeat(48), {
      method: "POST",
      path: PROCESSOR_PATH,
      body: new Uint8Array(4000),
    });
    const stalled = [
      rawRequest(base, { "content-length": "4000" }, [new Uint8Array(10)], false),
      rawRequest(base, { "content-length": "4000" }, [new Uint8Array(10)], false),
      rawRequest(base, { ...forged, "content-length": "4000" }, [new Uint8Array(10)], false),
      rawRequest(
        base,
        { [SIGNATURE_HEADERS.timestamp]: "x", "content-length": "4000" },
        [new Uint8Array(10)],
        false,
      ),
    ];
    // Each is answered 401 at once, without waiting for (or reading) the body.
    for (const r of stalled) expect(await r.status).toBe(401);
    // The Worker's own request still gets a slot.
    const jpg = u8(await solid(96, 64, "#123456").jpeg().toBuffer());
    expect(await code(client(base)(jpg))).toBe("accepted");
    expect(runs).toBe(1);
    for (const r of stalled) r.abort();
  });

  it("F14: a signed body that stops arriving is cut off after the body deadline (408) and frees its slot", async () => {
    const base = await start({ maxConcurrent: 1, bodyTimeoutMs: 200 });
    const body = new Uint8Array(4000);
    const signed = await signRequest(SECRET, { method: "POST", path: PROCESSOR_PATH, body });
    const t0 = Date.now();
    const slow = rawRequest(
      base,
      { ...signed, "content-length": "4000" },
      [body.subarray(0, 10)],
      false,
    );
    expect(await slow.status).toBe(408);
    expect(Date.now() - t0).toBeLessThan(2_000);
    const jpg = u8(await solid(96, 64, "#123456").jpeg().toBuffer());
    expect(await code(client(base)(jpg))).toBe("accepted");
    slow.abort();
  });

  it("the body read deadline can be lowered, never raised", () => {
    expect(
      configFromEnv({ IMAGE_PROCESSOR_SECRET: SECRET, IMAGE_PROCESSOR_BODY_TIMEOUT_MS: "500" })
        .bodyTimeoutMs,
    ).toBe(500);
    expect(() =>
      configFromEnv({ IMAGE_PROCESSOR_SECRET: SECRET, IMAGE_PROCESSOR_BODY_TIMEOUT_MS: "60000" }),
    ).toThrow();
  });

  it("415 for any content type but application/octet-stream; 404/405 for other paths and methods", async () => {
    const base = await start();
    expect(
      (await post(base, new Uint8Array(10), { "content-type": "multipart/form-data" })).status,
    ).toBe(415);
    expect((await fetch(base + PROCESSOR_PATH)).status).toBe(405);
    expect((await fetch(base + "/v1/other", { method: "POST" })).status).toBe(404);
    expect((await fetch(base + "/healthz")).status).toBe(200);
  });

  it("pixel limit: a 49 MP bomb of a few KB is refused (422 too_large) by sharp's limitInputPixels", async () => {
    const base = await start();
    const bomb = u8(await solid(7000, 7000, "#000").png({ compressionLevel: 9 }).toBuffer());
    expect(await code(client(base)(bomb))).toBe("too_large");
  });

  it("concurrency: requests over the per-instance limit get 503 (client: unavailable) while the slot is busy", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const base = await start({
      maxConcurrent: 1,
      reencode: async (b) => {
        await gate;
        return reencodeImage(b);
      },
    });
    const jpg = u8(await solid(96, 64, "#123456").jpeg().toBuffer());
    const first = client(base)(jpg);
    await new Promise((r) => setTimeout(r, 50));
    expect(await code(client(base)(jpg))).toBe("unavailable");
    release();
    expect(await code(first)).toBe("accepted");
  });

  it("timeout: a re-encode that runs past the limit answers 503, and its slot stays taken until it really ends", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const base = await start({
      maxConcurrent: 1,
      timeoutMs: 100,
      reencode: async (b) => {
        await gate;
        return reencodeImage(b);
      },
    });
    const jpg = u8(await solid(96, 64, "#123456").jpeg().toBuffer());
    expect(await code(client(base)(jpg))).toBe("unavailable");
    expect(await code(client(base)(jpg))).toBe("unavailable"); // still busy
    release();
    await new Promise((r) => setTimeout(r, 150)); // the timed-out re-encodes finish and free the slot
    expect(await code(client(base)(jpg))).toBe("accepted");
  });
});

describe("image processor: end to end (in-process server + Worker client + real sharp)", () => {
  it("a phone JPEG comes back upright with no metadata; result matches the in-process re-encoder byte for byte", async () => {
    const base = await start();
    const input = u8(readFileSync("e2e/fixtures/exif/o6.jpg"));
    const out = await client(base)(input);
    const local = await reencodeImage(input);
    expect([out.mime, out.width, out.height, out.orientation]).toEqual(["image/jpeg", 200, 100, 6]);
    expect(Buffer.compare(Buffer.from(out.bytes), Buffer.from(local.bytes))).toBe(0);
    const m = await sharp(out.bytes).metadata();
    expect([m.exif, m.icc, m.xmp, m.orientation]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(out.inputReport.hasExif).toBe(true);
  });

  it("F09: a PNG with partial transparency comes back with all three scan renditions of the latest re-encoder (contract v2)", async () => {
    const base = await start();
    const input = await alphaPng();
    const out = await client(base)(input);
    const local = await reencodeImage(input);
    expect(out.hasAlpha).toBe(true);
    expect(out.transparency).toBe("partial");
    expect(out.scanRenditions).toHaveLength(3);
    expect(out.scanRenditions).toEqual(local.scanRenditions);
    expect(reencodeResultProblem(out)).toBeNull();
  });

  it("F09: a service still on contract v1, or one that drops renditions, is held as unavailable, never misread", async () => {
    const input = await alphaPng();
    const local = await reencodeImage(input);
    // A correctly signed answer with the given metadata (the real re-encoded bytes), through the client's fetch seam.
    const answer = (meta: Record<string, unknown>, contentType: string) =>
      code(
        client("http://127.0.0.1:1", {
          fetch: (async (_url: string, init: RequestInit) => {
            const nonce = (init.headers as Record<string, string>)[SIGNATURE_HEADERS.nonce];
            const json = new TextEncoder().encode(JSON.stringify(meta));
            const body = new Uint8Array(4 + json.length + local.bytes.length);
            new DataView(body.buffer).setUint32(0, json.length);
            body.set(json, 4);
            body.set(local.bytes, 4 + json.length);
            const signature = await hmacHex(
              SECRET,
              canonicalResponse({ nonce, status: 200, bodySha256: await sha256Hex(body) }),
            );
            return new Response(body, {
              status: 200,
              headers: { "content-type": contentType, [SIGNATURE_HEADERS.signature]: signature },
            });
          }) as unknown as typeof fetch,
        })(input),
      );
    const { bytes: _bytes, scanRenditions, transparency: _t, ...rest } = local;
    const v1 = { ...rest, alphaRemovedScanTarget: scanRenditions[2] };
    // the #284 PoC's answer: v1 shape and content type
    expect(await answer(v1, "application/vnd.ballacity.reencode.v1")).toBe("unavailable");
    // the v1 shape relabelled as v2
    expect(await answer({ ...v1, contractVersion: 2 }, RESULT_CONTENT_TYPE)).toBe("unavailable");
    // v2 without its version
    expect(
      await answer({ ...rest, transparency: "partial", scanRenditions }, RESULT_CONTENT_TYPE),
    ).toBe("unavailable");
    // v2 with the white and black renditions dropped, or the transparency understated to skip them
    const v2 = { ...rest, contractVersion: 2 };
    expect(
      await answer(
        { ...v2, transparency: "partial", scanRenditions: [scanRenditions[2]] },
        RESULT_CONTENT_TYPE,
      ),
    ).toBe("unavailable");
    expect(
      await answer({ ...v2, transparency: "binary", scanRenditions }, RESULT_CONTENT_TYPE),
    ).toBe("unavailable");
    // a rendition that is not a JPEG
    expect(
      await answer(
        {
          ...v2,
          transparency: "partial",
          scanRenditions: [...scanRenditions.slice(0, 2), "data:image/jpeg;base64,AAAA"],
        },
        RESULT_CONTENT_TYPE,
      ),
    ).toBe("unavailable");
    // the complete v2 answer is accepted
    expect(
      await answer({ ...v2, transparency: "partial", scanRenditions }, RESULT_CONTENT_TYPE),
    ).toBe("accepted");
  });

  it("refusals travel as codes: animated, unsupported (never sent), unreadable", async () => {
    const base = await start();
    const f = (c: string) => solid(64, 64, c).png().toBuffer();
    const anim = u8(
      await sharp([await f("#f00"), await f("#00f")], { join: { animated: true } })
        .webp()
        .toBuffer(),
    );
    expect(await code(client(base)(anim))).toBe("animated");
    let sent = 0;
    const counting = client(base, {
      fetch: (async (...a: Parameters<typeof fetch>) => (sent++, fetch(...a))) as typeof fetch,
    });
    expect(await code(counting(u8(await solid(64, 64, "#f00").gif().toBuffer())))).toBe(
      "unsupported",
    );
    expect(sent).toBe(0);
    const j = u8(await solid(96, 64, "#123").jpeg().toBuffer());
    expect(await code(client(base)(j.subarray(0, j.length - 40)))).toBe("unreadable");
  });

  it("the client fails closed: wrong secret, server down, client timeout, bad URL", async () => {
    const base = await start({
      reencode: (b) => new Promise((r) => setTimeout(() => r(reencodeImage(b)), 300)),
    });
    const jpg = u8(await solid(96, 64, "#123456").jpeg().toBuffer());
    expect(
      await code(createImageProcessorReencoder({ url: base, secret: "z".repeat(48) })(jpg)),
    ).toBe("unavailable");
    expect(await code(client(base, { timeoutMs: 50 })(jpg))).toBe("unavailable");
    expect(await code(client("http://127.0.0.1:1")(jpg))).toBe("unavailable");
    expect(await code(client("http://example.com")(jpg))).toBe("unavailable"); // plain HTTP off loopback
    expect(await code(createImageProcessorReencoder({ url: base, secret: "short" })(jpg))).toBe(
      "unavailable",
    );
  });

  it("the client refuses a response altered in transit (signature) and a forged success from an impostor", async () => {
    const base = await start();
    const jpg = u8(await solid(96, 64, "#123456").jpeg().toBuffer());
    // a proxy that flips one byte of the image in the response
    const proxy = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const upstream = await fetch(base + req.url, {
        method: "POST",
        headers: req.headers as any,
        body: Buffer.concat(chunks),
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      body[body.length - 10] ^= 1;
      res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
      res.end(body);
    });
    servers.push(proxy);
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    const proxied = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    expect(await code(client(proxied)(jpg))).toBe("unavailable");

    // an impostor that answers 200 with a valid-looking body but cannot sign it
    const fake = await reencodeImage(jpg);
    const impostor = client(base, {
      fetch: (async () =>
        new Response(
          new Uint8Array(
            Buffer.concat([Buffer.from([0, 0, 0, 2]), Buffer.from("{}"), Buffer.from(fake.bytes)]),
          ),
          {
            status: 200,
            headers: {
              "content-type": RESULT_CONTENT_TYPE,
              [SIGNATURE_HEADERS.signature]: "0".repeat(64),
            },
          },
        )) as typeof fetch,
    });
    expect(await code(impostor(jpg))).toBe("unavailable");
  });

  it("the client re-checks a signed answer: an output carrying metadata is refused", async () => {
    // A (compromised or buggy) service that signs correctly but returns the input with its EXIF intact.
    const base = await start({
      reencode: async (b): Promise<ReencodeResult> => {
        const r = await reencodeImage(b);
        return { ...r, bytes: b, width: 200, height: 100 };
      },
    });
    const input = u8(readFileSync("e2e/fixtures/exif/o1.jpg"));
    expect(await code(client(base)(input))).toBe("unreadable");
  });
});
