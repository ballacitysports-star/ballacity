/* eslint-disable @typescript-eslint/no-explicit-any -- hand-rolled storage stub */
/**
 * F05: animated chat images (APNG, animated WEBP) were accepted after one single-image scan and stored with every
 * frame. They are now refused before any scan or check row; still pictures are unaffected. The re-encoder (profile and
 * public images) already refused animation; that is pinned here too.
 */
import { deflateSync } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { finalizeAttachment } from "./message-attachment-finalize.server";
import { reencodeImage } from "./image-reencode.server";
import { isAnimatedImage } from "./image-animation";
import { attachmentProblem } from "./message-attachment-validation";

const enc = new TextEncoder();
const cat = (...p: Uint8Array[]) => {
  const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let k = 0;
  for (const x of p) {
    o.set(x, k);
    k += x.length;
  }
  return o;
};
const u8 = (b: Buffer) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
const be32 = (n: number) => Uint8Array.from([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pchunk = (type: string, data: Uint8Array) => {
  const body = cat(enc.encode(type), data);
  return cat(be32(data.length), body, be32(crc(body)));
};
const scan = (w: number, h: number, rgb: [number, number, number]) => {
  const row = 1 + w * 3;
  const b = new Uint8Array(row * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b.set(rgb, y * row + 1 + x * 3);
  return u8(deflateSync(b));
};
const fctl = (seq: number, w: number, h: number) =>
  cat(be32(seq), be32(w), be32(h), be32(0), be32(0), Uint8Array.from([0, 1, 0, 10, 0, 0]));
const apng = () =>
  cat(
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pchunk("IHDR", cat(be32(64), be32(64), Uint8Array.from([8, 2, 0, 0, 0]))),
    pchunk("acTL", cat(be32(2), be32(0))),
    pchunk("fcTL", fctl(0, 64, 64)),
    pchunk("IDAT", scan(64, 64, [255, 0, 0])),
    pchunk("fcTL", fctl(1, 64, 64)),
    pchunk("fdAT", cat(be32(2), scan(64, 64, [0, 0, 255]))),
    pchunk("IEND", new Uint8Array(0)),
  );
const solid = (c: string) =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: c } })
    .png()
    .toBuffer();
const animWebp = async () =>
  u8(
    await sharp([await solid("#ff0000"), await solid("#0000ff")], { join: { animated: true } })
      .webp({ lossless: true })
      .toBuffer(),
  );
const animGif = async () =>
  u8(
    await sharp([await solid("#ff0000"), await solid("#0000ff")], { join: { animated: true } })
      .gif()
      .toBuffer(),
  );

const CONV = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function world(path: string, bytes: Uint8Array) {
  const files = new Map<string, { bytes: Uint8Array; id: string; version: string }>();
  let seq = 0;
  files.set(path, { bytes, id: "obj-1", version: "v-1" });
  const checks: any[] = [];
  const bucket = {
    info: async (p: string) => {
      const f = files.get(p);
      return f
        ? { data: { id: f.id, version: f.version }, error: null }
        : { data: null, error: { message: "nf" } };
    },
    download: async (p: string) => {
      const f = files.get(p);
      return f
        ? { data: new Blob([f.bytes as BlobPart]), error: null }
        : { data: null, error: { message: "nf" } };
    },
    upload: async (p: string, b: Uint8Array) => {
      const id = files.get(p)?.id ?? `obj-n${++seq}`;
      files.set(p, { bytes: b, id, version: `v-n${++seq}` });
      return { data: { id }, error: null };
    },
    remove: async (ps: string[]) => {
      ps.forEach((p) => files.delete(p));
      return { error: null };
    },
    createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://signed/${p}` } }),
  };
  const admin = {
    storage: { from: () => bucket },
    from: () => ({
      upsert: async (row: any) => {
        checks.push(row);
        return { error: null };
      },
    }),
  };
  return { files, checks, admin };
}

const still = async (fmt: "png" | "webp") => {
  const s = sharp({ create: { width: 64, height: 64, channels: 3, background: "#00ff00" } });
  return u8(await (fmt === "png" ? s.png() : s.webp({ lossless: true })).toBuffer());
};

async function finalize(bytes: Uint8Array, ext: string) {
  const path = `${CONV}/${USER}/pic.${ext}`;
  const w = world(path, bytes);
  const scan = vi.fn(async () => ({ safe: true, csam: false, categories: [], scanned: true }));
  let result: any;
  try {
    result = await finalizeAttachment({ admin: w.admin, scan, escalate: vi.fn() } as any, {
      userId: USER,
      conversationId: CONV,
      path,
    });
  } catch (e) {
    result = { error: (e as Error).message };
  }
  return { result, scan, checks: w.checks, stored: w.files.get(path)?.bytes ?? null };
}

describe("animated image detection (F05)", () => {
  it("detects APNG, animated WEBP and multi-frame GIF from the bytes", async () => {
    expect(isAnimatedImage(apng())).toBe(true);
    expect(isAnimatedImage(await animWebp())).toBe(true);
    expect(isAnimatedImage(await animGif())).toBe(true);
  });

  it("does not flag still pictures", async () => {
    expect(isAnimatedImage(await still("png"))).toBe(false);
    expect(isAnimatedImage(await still("webp"))).toBe(false);
    const jpeg = u8(
      await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } })
        .jpeg()
        .toBuffer(),
    );
    expect(isAnimatedImage(jpeg)).toBe(false);
  });

  it("treats a truncated or malformed animated file as animated rather than still", () => {
    const a = apng();
    expect(isAnimatedImage(a.subarray(0, 60))).toBe(true); // acTL survives the cut
  });

  it("attachmentProblem refuses animated pictures (the browser and the server share it)", async () => {
    expect(attachmentProblem(apng())).toMatch(/Animated pictures can't be sent/);
    expect(attachmentProblem(await animWebp())).toMatch(/Animated pictures can't be sent/);
    expect(attachmentProblem(await still("png"))).toBeNull();
  });
});

describe("chat attachment finalize (F05)", () => {
  for (const [name, ext, make] of [
    ["APNG", "png", async () => apng()],
    ["animated WEBP", "webp", animWebp],
  ] as const) {
    it(`refuses an ${name} before any scan or check, and removes it`, async () => {
      const r = await finalize(await make(), ext);
      expect(r.result.error).toMatch(/Animated pictures can't be sent/);
      expect(r.scan).not.toHaveBeenCalled();
      expect(r.checks).toHaveLength(0);
      expect(r.stored).toBeNull();
    });
  }

  it("still accepts a still PNG and WEBP after one scan", async () => {
    for (const fmt of ["png", "webp"] as const) {
      const r = await finalize(await still(fmt), fmt);
      expect(r.result.ok).toBe(true);
      expect(r.scan).toHaveBeenCalledTimes(1);
      expect(r.checks).toHaveLength(1);
    }
  });
});

describe("re-encoder (profile and public images)", () => {
  it("already refuses animated input", async () => {
    for (const make of [async () => apng(), animWebp]) {
      await expect(reencodeImage(await make())).rejects.toMatchObject({ code: "animated" });
    }
  });
});
