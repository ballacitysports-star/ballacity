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
import { SIGNATURE_HEADERS, signRequest } from "@/lib/image-runtime/hmac";
import { createImageProcessorReencoder } from "@/lib/image-runtime/node-service-client";
import { PROCESSOR_PATH } from "@/lib/image-runtime/processor-protocol";
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

describe("image processor: limits", () => {
  it("413 for a declared or streamed body over the cap, before authentication and without running the re-encoder", async () => {
    let runs = 0;
    const base = await start({
      maxBodyBytes: 1000,
      reencode: async (b) => (runs++, reencodeImage(b)),
    });
    expect((await post(base, new Uint8Array(1001))).status).toBe(413);
    // chunked, no content-length
    const port = new URL(base).port;
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: PROCESSOR_PATH,
          method: "POST",
          headers: { "content-type": "application/octet-stream", "transfer-encoding": "chunked" },
        },
        (res) => resolve(res.statusCode ?? 0),
      );
      req.on("error", reject);
      for (let i = 0; i < 4; i++) req.write(Buffer.alloc(400));
      req.end();
    });
    expect(status).toBe(413);
    expect(runs).toBe(0);
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

  it("a PNG with partial transparency comes back with the alpha-removed scan rendition", async () => {
    const base = await start();
    const out = await client(base)(await alphaPng());
    expect(out.hasAlpha).toBe(true);
    expect(out.alphaRemovedScanTarget).toMatch(/^data:image\/jpeg;base64,/);
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
              "content-type": "application/vnd.ballacity.reencode.v1",
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
