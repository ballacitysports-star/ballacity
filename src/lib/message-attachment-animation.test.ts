/**
 * Audit F05: a chat picture was scanned as one image and stored with every frame,
 * so an animated PNG, WEBP or GIF could carry frames nobody checked. Animated
 * pictures are now refused before any scan or check row, and the upload is
 * removed; still pictures are unaffected.
 *
 * Ported from #292 (commit fdc93991) onto main: the detector is copied verbatim and
 * the finalize cases run against main's finalizeMessageAttachment.
 */
import { deflateSync } from "node:zlib";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  for (const x of b) c = crcTable[(c ^ x) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pchunk = (type: string, data: Uint8Array) => {
  const body = cat(enc.encode(type), data);
  return cat(be32(data.length), body, be32(crc(body)));
};
const scanLines = (w: number, h: number, rgb: [number, number, number]) => {
  const row = 1 + w * 3;
  const b = new Uint8Array(row * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b.set(rgb, y * row + 1 + x * 3);
  return u8(deflateSync(b));
};
const fctl = (seq: number, w: number, h: number) =>
  cat(be32(seq), be32(w), be32(h), be32(0), be32(0), Uint8Array.from([0, 1, 0, 10, 0, 0]));
/** A two-frame APNG, built by hand: red, then blue. */
const apng = () =>
  cat(
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pchunk("IHDR", cat(be32(64), be32(64), Uint8Array.from([8, 2, 0, 0, 0]))),
    pchunk("acTL", cat(be32(2), be32(0))),
    pchunk("fcTL", fctl(0, 64, 64)),
    pchunk("IDAT", scanLines(64, 64, [255, 0, 0])),
    pchunk("fcTL", fctl(1, 64, 64)),
    pchunk("fdAT", cat(be32(2), scanLines(64, 64, [0, 0, 255]))),
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
const still = async (fmt: "png" | "webp") => {
  const s = sharp({ create: { width: 64, height: 64, channels: 3, background: "#00ff00" } });
  return u8(await (fmt === "png" ? s.png() : s.webp({ lossless: true })).toBuffer());
};

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

  it("treats a truncated animated file as animated rather than still", () => {
    expect(isAnimatedImage(apng().subarray(0, 60))).toBe(true); // acTL survives the cut
  });

  it("attachmentProblem refuses animated pictures and passes still ones", async () => {
    expect(attachmentProblem(apng())).toMatch(/Animated pictures can't be sent/);
    expect(attachmentProblem(await animWebp())).toMatch(/Animated pictures can't be sent/);
    // GIF is not an allowed attachment type at all, so it is refused before this check.
    expect(attachmentProblem(await animGif())).toMatch(/file type is not allowed/);
    expect(attachmentProblem(await still("png"))).toBeNull();
    expect(attachmentProblem(await still("webp"))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// main's finalizeMessageAttachment, with storage, the scan and the database faked.
// A server function is its handler here: validate the input, then run it.
// ---------------------------------------------------------------------------

const CONV = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  checks: [] as unknown[],
  moderation: [] as { status?: string; reason?: string | null }[],
  removed: [] as string[],
  scans: 0,
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (d: unknown) => d;
    const b = {
      middleware() {
        return b;
      },
      inputValidator(fn: (d: unknown) => unknown) {
        validate = fn;
        return b;
      },
      handler(fn: (ctx: { data: unknown; context: unknown }) => unknown) {
        return (arg: { data: unknown; context: unknown }) =>
          fn({ data: validate(arg.data), context: arg.context });
      },
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/image-safety.server", () => ({
  scanImageForSafety: async () => {
    h.scans += 1;
    return { safe: true, csam: false, categories: [] };
  },
}));
vi.mock("@/integrations/supabase/client.server", () => {
  const member = {
    select: () => member,
    eq: () => member,
    maybeSingle: async () => ({ data: { user_id: USER }, error: null }),
  };
  return {
    supabaseAdmin: {
      from: (table: string) =>
        table === "conversation_participants"
          ? member
          : {
              upsert: async (row: { status?: string; reason?: string | null }) => {
                (table === "image_moderation" ? h.moderation : h.checks).push(row);
                return { error: null };
              },
            },
      storage: {
        from: () => ({
          download: async (path: string) => {
            const f = h.files.get(path);
            return f
              ? { data: new Blob([f as BlobPart]), error: null }
              : { data: null, error: { message: "not found" } };
          },
          remove: async (paths: string[]) => {
            paths.forEach((p) => {
              h.files.delete(p);
              h.removed.push(p);
            });
            return { error: null };
          },
        }),
      },
    },
  };
});

const { finalizeMessageAttachment } = await import("./message-attachments.functions");
const finalize = finalizeMessageAttachment as unknown as (arg: {
  data: { path: string };
  context: { userId: string };
}) => Promise<{ ok: true; kind: string }>;

async function send(bytes: Uint8Array, ext: string) {
  const path = `${CONV}/${USER}/pic.${ext}`;
  h.files.set(path, bytes);
  try {
    return { result: await finalize({ data: { path }, context: { userId: USER } }), path };
  } catch (e) {
    return { error: (e as Error).message, path };
  }
}

beforeEach(() => {
  h.files.clear();
  h.checks.length = 0;
  h.moderation.length = 0;
  h.removed.length = 0;
  h.scans = 0;
});

describe("chat attachment finalize (F05)", () => {
  for (const [name, ext, make, message] of [
    ["an APNG", "png", async () => apng(), /Animated pictures can't be sent/],
    ["an animated WEBP", "webp", animWebp, /Animated pictures can't be sent/],
    ["a multi-frame GIF", "gif", animGif, /file type is not allowed/],
  ] as const) {
    it(`refuses ${name} before any scan or check row, and removes it`, async () => {
      const r = await send(await make(), ext);
      expect(r.error).toMatch(message);
      expect(h.scans).toBe(0);
      expect(h.checks).toHaveLength(0);
      expect(h.removed).toEqual([r.path]);
    });
  }

  it("still accepts a still PNG and WEBP after one scan each", async () => {
    for (const fmt of ["png", "webp"] as const) {
      const r = await send(await still(fmt), fmt);
      expect(r.error).toBeUndefined();
      expect(r.result?.ok).toBe(true);
    }
    expect(h.scans).toBe(2);
    expect(h.checks).toHaveLength(2);
    expect(h.removed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Public images (avatars, covers, logos): main has no re-encoder for them, so the
// upload gate refuses animation the same way.
// ---------------------------------------------------------------------------

const { finalizeImageUpload } = await import("./image-uploads.functions");
const finalizePublic = finalizeImageUpload as unknown as (arg: {
  data: { bucket: string; path: string };
  context: { userId: string };
}) => Promise<{ ok: true; quarantined: boolean }>;

async function upload(bytes: Uint8Array, ext: string) {
  const path = `${USER}/avatar.${ext}`;
  h.files.set(path, bytes);
  try {
    return {
      result: await finalizePublic({
        data: { bucket: "avatars", path },
        context: { userId: USER },
      }),
      path,
    };
  } catch (e) {
    return { error: (e as Error).message, path };
  }
}

describe("public image upload (F05)", () => {
  for (const [name, ext, make] of [
    ["an APNG", "png", async () => apng()],
    ["an animated WEBP", "webp", animWebp],
  ] as const) {
    it(`refuses ${name} before the scan, removes it and records why`, async () => {
      const r = await upload(await make(), ext);
      expect(r.error).toMatch(/Animated pictures can't be uploaded/);
      expect(h.scans).toBe(0);
      expect(h.removed).toEqual([r.path]);
      expect(h.moderation).toHaveLength(1);
      expect(h.moderation[0]).toMatchObject({ status: "removed" });
      expect(h.moderation[0]!.reason).toMatch(/Animated pictures/);
    });
  }

  it("still accepts a still PNG and WEBP after one scan each", async () => {
    for (const fmt of ["png", "webp"] as const) {
      const r = await upload(await still(fmt), fmt);
      expect(r.error).toBeUndefined();
      expect(r.result?.ok).toBe(true);
    }
    expect(h.scans).toBe(2);
    expect(h.removed).toEqual([]);
    expect(h.moderation.map((m) => m.status)).toEqual(["pending", "pending"]);
  });
});
