/* eslint-disable @typescript-eslint/no-explicit-any -- the storage/database client is faked structurally */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { IMAGE_QUARANTINE_BUCKET } from "./image-quarantine.server";
import { ImageReencodeError, reencodeImage, type ReencodeResult } from "./image-reencode.server";
import {
  ANIMATED_REFUSAL,
  PROCESSING_BUSY,
  PROCESSING_UNAVAILABLE,
  promoteStagedImage,
  sweepImageStaging,
  type PromotionDeps,
} from "./image-promotion.server";
import { IMAGE_STAGING_BUCKET, isOwnFilePath } from "./image-staging";
import { sniffImageMime as sniff } from "./image-validation";

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
const seg = (m: number, payload: Uint8Array) =>
  cat(Uint8Array.from([0xff, m, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload);
// A real, decodable JPEG (SEC-6: every published picture is decoded and re-encoded), optionally with a GPS-bearing APP1.
const BASE_JPEG = u8(
  await sharp({ create: { width: 100, height: 80, channels: 3, background: "#3366cc" } })
    .jpeg()
    .toBuffer(),
);
const jpeg = (opts: { gps?: boolean } = {}) =>
  opts.gps
    ? cat(
        BASE_JPEG.subarray(0, 2),
        seg(0xe1, enc.encode("Exif\0\0GPS 33.7488,-84.3877")),
        BASE_JPEG.subarray(2),
      )
    : BASE_JPEG.slice();
// Noise does not compress: a PNG whose re-encoded bytes are over the 4 MB inline-scan limit and under the 8 MB cap.
const NOISE_PNG = await (async () => {
  const w = 1300;
  const h = 1200;
  const raw = randomBytes(w * h * 3);
  return u8(
    await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
      .png()
      .toBuffer(),
  );
})();
const hasText = (b: Uint8Array, t: string) => new TextDecoder("latin1").decode(b).includes(t);
const contains = (hay: Uint8Array, needle: Uint8Array) =>
  Buffer.from(hay.buffer, hay.byteOffset, hay.byteLength).indexOf(Buffer.from(needle)) >= 0;

const USER = "11111111-1111-1111-1111-111111111111";
const STAGE = `${USER}/stage-1.jpg`;
const TARGET = `${USER}/final-1.jpg`;

function world(
  initial: Record<string, Uint8Array> = {},
  uploadError: string | null = null,
  opts: { quarantineFails?: boolean } = {},
) {
  const files = new Map<string, Uint8Array>(Object.entries(initial)); // key: bucket|path
  const moderation = new Map<string, any>();
  const items: any[] = [];
  const log: string[] = [];
  // The database clock, for the claim's 10-minute expiry (supabase/migrations/20261108130000).
  const clock = { now: Date.now() };
  const admin = {
    // claim_image_processing / finish_image_processing, with the migration's semantics (each call is atomic, as in Postgres).
    rpc: async (fn: string, a: any) => {
      const key = `${a._bucket}|${a._path}`;
      const row = moderation.get(key);
      if (fn === "claim_image_processing") {
        const stale =
          row?.status === "processing" &&
          (!row.claimed_at || clock.now - row.claimed_at > 10 * 60_000);
        if (!row || !["processing", "quarantined", "removed"].includes(row.status) || stale) {
          const token = crypto.randomUUID();
          moderation.set(key, {
            ...(row ?? { bucket: a._bucket, path: a._path, owner_id: a._owner_id }),
            status: "processing",
            claim_token: token,
            claimed_at: clock.now,
          });
          log.push(`claim ${a._bucket}`);
          return { data: [{ claim_token: token, status: "processing" }], error: null };
        }
        return { data: [{ claim_token: null, status: row.status }], error: null };
      }
      if (fn === "finish_image_processing") {
        if (!row || row.status !== "processing" || row.claim_token !== a._claim_token)
          return { data: false, error: null };
        if (a._status === "released") moderation.delete(key);
        else
          moderation.set(key, {
            ...row,
            ...a._fields,
            status: a._status,
            claim_token: null,
            claimed_at: null,
          });
        log.push(`settle ${a._bucket} ${a._status}`);
        return { data: true, error: null };
      }
      return { data: null, error: { message: `unknown rpc ${fn}` } };
    },
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          const b = files.get(`${bucket}|${path}`);
          return b
            ? { data: new Blob([b as BlobPart]), error: null }
            : { data: null, error: { message: "not found" } };
        },
        upload: async (path: string, bytes: Uint8Array) => {
          if (bucket === IMAGE_QUARANTINE_BUCKET && opts.quarantineFails)
            return { error: { message: "quarantine down" } };
          if (uploadError && bucket !== IMAGE_STAGING_BUCKET && bucket !== IMAGE_QUARANTINE_BUCKET)
            return { error: { message: uploadError } };
          files.set(`${bucket}|${path}`, bytes);
          log.push(`upload ${bucket}`);
          return { error: null };
        },
        remove: async (paths: string[]) => {
          for (const p of paths) files.delete(`${bucket}|${p}`);
          log.push(`remove ${bucket}`);
          return { error: null };
        },
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://signed/${bucket}/${path}` },
        }),
      }),
    },
    from: (table: string) => ({
      insert: (row: any) => ({
        select: () => ({
          single: async () => {
            if (table !== "image_quarantine_items")
              return { data: null, error: { message: table } };
            const id = `item-${items.length + 1}`;
            items.push({ id, ...row });
            log.push("record quarantine item");
            return { data: { id }, error: null };
          },
        }),
      }),
      upsert: async (row: any) => {
        moderation.set(`${row.bucket}|${row.path}`, row);
        return { error: null };
      },
      select: () => {
        const filters: Record<string, string> = {};
        const q: any = {
          eq: (k: string, v: string) => ((filters[k] = v), q),
          maybeSingle: async () => ({
            data: moderation.get(`${filters.bucket}|${filters.path}`) ?? null,
          }),
        };
        return q;
      },
    }),
  };
  return { files, moderation, items, log, admin, clock };
}
const safe = { safe: true, label: "ok", reason: null, categories: [], scanned: true, csam: false };
const deps = (
  w: ReturnType<typeof world>,
  verdict: any = safe,
): PromotionDeps & { scan: any; escalate: any } => ({
  admin: w.admin,
  scan: vi.fn().mockResolvedValue(verdict),
  escalate: vi.fn(async () => {
    w.log.push("escalate");
  }),
});
const input = { userId: USER, bucket: "avatars", stagingPath: STAGE, targetPath: TARGET };

describe("promoteStagedImage", () => {
  it("publishes clean bytes only, removes the staged original, and records the outcome", async () => {
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg({ gps: true }) });
    const out = await promoteStagedImage(deps(w), input);
    expect(out.quarantined).toBe(false);
    expect(out.metadataStripped).toBe(true);
    const published = w.files.get(`avatars|${TARGET}`)!;
    expect(hasText(published, "GPS")).toBe(false);
    expect(w.files.has(`${IMAGE_STAGING_BUCKET}|${STAGE}`)).toBe(false);
    expect(w.moderation.get(`avatars|${TARGET}`).status).toBe("pending");
  });

  it("never writes to the destination before the scan passes, and keeps an unsafe original private", async () => {
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg({ gps: true }) });
    const d = deps(w, {
      ...safe,
      safe: false,
      label: "x",
      reason: "flagged",
      csam: true,
      categories: ["c"],
    });
    const out = await promoteStagedImage(d, input);
    expect(out.quarantined).toBe(true);
    expect(w.files.has(`avatars|${TARGET}`)).toBe(false);
    // SEC-6: the original, exactly as uploaded, is preserved in the restricted quarantine, then removed from staging
    const held = w.items[0];
    expect(held).toMatchObject({
      source: "image_upload",
      source_bucket: IMAGE_STAGING_BUCKET,
      source_path: STAGE,
      uploader_id: USER,
      suspected_csam: true,
      categories: ["c"],
    });
    expect(held.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(w.files.get(`${IMAGE_QUARANTINE_BUCKET}|${held.object_path}`)).toEqual(
      jpeg({ gps: true }),
    );
    expect(w.files.has(`${IMAGE_STAGING_BUCKET}|${STAGE}`)).toBe(false);
    const row = w.moderation.get(`${IMAGE_STAGING_BUCKET}|${STAGE}`);
    expect(row.status).toBe("quarantined");
    expect(row.scan.quarantine).toEqual({
      bucket: IMAGE_QUARANTINE_BUCKET,
      path: held.object_path,
      item_id: "item-1",
    });
    expect(d.escalate).toHaveBeenCalledWith(IMAGE_QUARANTINE_BUCKET, held.object_path, ["c"]);
    // the destination path is flagged too (R5 39ae9545, finding 1), so no concurrent call can claim or publish it
    expect(w.moderation.get(`avatars|${TARGET}`).status).toBe("quarantined");
    // preserved and recorded before escalation, escalated before the staged copy is removed
    expect(w.log.filter((l) => !l.startsWith("upload avatars"))).toEqual([
      `claim ${IMAGE_STAGING_BUCKET}`,
      `upload ${IMAGE_QUARANTINE_BUCKET}`,
      "record quarantine item",
      "remove avatars",
      "escalate",
      `remove ${IMAGE_STAGING_BUCKET}`,
    ]);
  });

  it("keeps the staged original (and escalates it there) when the quarantine copy fails", async () => {
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg() }, null, {
      quarantineFails: true,
    });
    const d = deps(w, {
      ...safe,
      safe: false,
      label: "x",
      reason: "f",
      csam: true,
      categories: ["c"],
    });
    const out = await promoteStagedImage(d, input);
    expect(out.quarantined).toBe(true);
    expect(w.files.has(`${IMAGE_STAGING_BUCKET}|${STAGE}`)).toBe(true);
    expect(w.moderation.get(`${IMAGE_STAGING_BUCKET}|${STAGE}`).scan.quarantine).toEqual({
      failed: true,
    });
    expect(d.escalate).toHaveBeenCalledWith(IMAGE_STAGING_BUCKET, STAGE, ["c"]);
    expect(w.files.has(`avatars|${TARGET}`)).toBe(false);
  });

  it("a non-child-safety flag is quarantined too, without escalation", async () => {
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg() });
    const d = deps(w, {
      ...safe,
      safe: false,
      label: "violence",
      reason: "f",
      categories: ["violence"],
    });
    await promoteStagedImage(d, input);
    expect(w.items[0]).toMatchObject({ suspected_csam: false, categories: ["violence"] });
    expect(d.escalate).not.toHaveBeenCalled();
    expect(w.files.has(`${IMAGE_STAGING_BUCKET}|${STAGE}`)).toBe(false);
  });

  it("scans the cleaned bytes, not the original", async () => {
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg({ gps: true }) });
    const d = deps(w);
    await promoteStagedImage(d, input);
    const target = d.scan.mock.calls[0][0] as string;
    const decoded = atob(target.split(",")[1]);
    expect(decoded.includes("GPS")).toBe(false);
  });

  it("removes a file that is not a readable image and publishes nothing", async () => {
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: enc.encode("not an image at all") });
    await expect(promoteStagedImage(deps(w), input)).rejects.toThrow();
    expect(w.files.size).toBe(0);
    expect(w.moderation.get(`${IMAGE_STAGING_BUCKET}|${STAGE}`).status).toBe("removed");
  });

  it("refuses a name that does not match the content type", async () => {
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg() });
    await expect(
      promoteStagedImage(deps(w), { ...input, targetPath: `${USER}/final-1.png` }),
    ).rejects.toThrow(/does not match/);
    expect(w.files.has(`avatars|${USER}/final-1.png`)).toBe(false);
  });

  it("keeps the staged copy when publishing fails, so a retry can succeed", async () => {
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg() }, "storage down");
    await expect(promoteStagedImage(deps(w), input)).rejects.toThrow(/Could not publish/);
    expect(w.files.has(`${IMAGE_STAGING_BUCKET}|${STAGE}`)).toBe(true);
    expect(w.files.has(`avatars|${TARGET}`)).toBe(false);
  });

  it("is idempotent: a retry or a concurrent second call after success returns the recorded outcome", async () => {
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg({ gps: true }) });
    const first = await promoteStagedImage(deps(w), input);
    const second = await promoteStagedImage(deps(w), input);
    expect(second.quarantined).toBe(false);
    expect(second.path).toBe(first.path);
    expect(w.files.size).toBe(1);
  });

  it("fails when neither a staged file nor a prior outcome exists", async () => {
    await expect(promoteStagedImage(deps(world()), input)).rejects.toThrow(/could not be read/);
  });

  it("scans a large image through a server-only scratch copy of the CLEAN bytes, then deletes it", async () => {
    const stage = `${USER}/big.png`;
    const target = `${USER}/big-final.png`;
    const big = cat(
      NOISE_PNG.subarray(0, 33),
      // a tEXt chunk the re-encode drops (CRC is not checked by the stripper, which drops it anyway)
      Uint8Array.from([0, 0, 0, 7]),
      enc.encode("tEXtGPS 1,2"),
      Uint8Array.from([0, 0, 0, 0]),
      NOISE_PNG.subarray(33),
    );
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${stage}`]: big });
    const d = deps(w);
    let scannedBytes: Uint8Array | null = null;
    d.scan.mockImplementation(async (url: string) => {
      const m = url.match(/^https:\/\/signed\/image-staging\/(_scan\/.+)$/);
      expect(m).not.toBeNull();
      scannedBytes = w.files.get(`${IMAGE_STAGING_BUCKET}|${m![1]}`) ?? null;
      return safe;
    });
    const out = await promoteStagedImage(d, { ...input, stagingPath: stage, targetPath: target });
    expect(out.quarantined).toBe(false);
    expect(scannedBytes).not.toBeNull();
    expect(scannedBytes!.byteLength).toBeGreaterThan(4 * 1024 * 1024);
    expect(hasText(scannedBytes!, "tEXtGPS 1,2")).toBe(false);
    // what was scanned is exactly what was published
    expect(w.files.get(`avatars|${target}`)).toBe(scannedBytes);
    // the scratch copy is gone
    expect([...w.files.keys()].some((k) => k.includes("_scan/"))).toBe(false);
  });

  it("a flagged file is never re-scanned or promoted", async () => {
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg() });
    const d = deps(w, { ...safe, safe: false, label: "x", reason: "flagged" });
    await promoteStagedImage(d, input);
    const again = deps(w); // a lenient scan the second time
    await expect(promoteStagedImage(again, input)).rejects.toThrow(/flagged/);
    expect(again.scan).not.toHaveBeenCalled();
    expect(w.files.has(`avatars|${TARGET}`)).toBe(false);
  });

  it("does not overwrite a target a moderator already quarantined", async () => {
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg() });
    w.moderation.set(`avatars|${TARGET}`, {
      bucket: "avatars",
      path: TARGET,
      status: "quarantined",
    });
    await expect(promoteStagedImage(deps(w), input)).rejects.toThrow(/flagged/);
    expect(w.files.has(`avatars|${TARGET}`)).toBe(false);
  });

  it("a storage error (not a missing file) is not treated as a finished promotion", async () => {
    const w = world();
    w.moderation.set(`avatars|${TARGET}`, { bucket: "avatars", path: TARGET, status: "pending" });
    const failing = {
      ...w.admin,
      storage: {
        from: () => ({
          download: async () => ({ data: null, error: { message: "upstream timeout" } }),
        }),
      },
    };
    await expect(promoteStagedImage({ ...deps(w), admin: failing }, input)).rejects.toThrow(
      /could not be read/,
    );
  });

  it("only works inside the caller's own folder and for known buckets", async () => {
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg() });
    await expect(
      promoteStagedImage(deps(w), {
        ...input,
        stagingPath: `22222222-2222-2222-2222-222222222222/x.jpg`,
      }),
    ).rejects.toThrow(/your own/);
    await expect(
      promoteStagedImage(deps(w), { ...input, targetPath: `${USER}/../x.jpg` }),
    ).rejects.toThrow(/your own/);
    await expect(
      promoteStagedImage(deps(w), { ...input, bucket: "payment-proofs" }),
    ).rejects.toThrow(/Unsupported/);
  });

  it("isOwnFilePath rejects nesting and traversal", () => {
    expect(isOwnFilePath(USER, `${USER}/a.jpg`)).toBe(true);
    expect(isOwnFilePath(USER, `${USER}/sub/a.jpg`)).toBe(false);
    expect(isOwnFilePath(USER, `${USER}/../a.jpg`)).toBe(false);
    expect(isOwnFilePath(USER, `other/a.jpg`)).toBe(false);
  });

  it("fails closed when the safety scan cannot run: nothing is published and the file stays private", async () => {
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg({ gps: true }) });
    const d = deps(w, { ...safe, scanned: false, label: "unscanned" });
    const out = await promoteStagedImage(d, input);
    expect(out.held).toBe(true);
    expect(w.files.has(`avatars|${TARGET}`)).toBe(false);
    expect(w.files.has(`${IMAGE_STAGING_BUCKET}|${STAGE}`)).toBe(true);
    expect(w.moderation.get(`${IMAGE_STAGING_BUCKET}|${STAGE}`).status).toBe("pending");
  });

  it("fails closed when the scanner throws", async () => {
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg() });
    const d = deps(w);
    d.scan.mockRejectedValue(new Error("gateway down"));
    const out = await promoteStagedImage(d, input);
    expect(out.held).toBe(true);
    expect(w.files.has(`avatars|${TARGET}`)).toBe(false);
  });

  it("publishes after a held attempt is retried and the scan works", async () => {
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg({ gps: true }) });
    const first = await promoteStagedImage(deps(w, { ...safe, scanned: false }), input);
    expect(first.held).toBe(true);
    const second = await promoteStagedImage(deps(w), input);
    expect(second.held).toBeUndefined();
    expect(hasText(w.files.get(`avatars|${TARGET}`)!, "GPS")).toBe(false);
    expect(w.files.has(`${IMAGE_STAGING_BUCKET}|${STAGE}`)).toBe(false);
  });

  it("never publishes an original even when the stored name pretends to be another type", async () => {
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${USER}/x.png`]: jpeg({ gps: true }) });
    await expect(
      promoteStagedImage(deps(w), {
        ...input,
        stagingPath: `${USER}/x.png`,
        targetPath: `${USER}/y.png`,
      }),
    ).rejects.toThrow(/does not match/);
    expect(w.files.has(`avatars|${USER}/y.png`)).toBe(false);
    expect(w.files.has(`${IMAGE_STAGING_BUCKET}|${USER}/x.png`)).toBe(false);
  });
});

// ---- animated and cleaned-output checks (review round 4)
const be32 = (n: number) => Uint8Array.from([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
const le32 = (n: number) => Uint8Array.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24]);
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
const apng = () =>
  cat(
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pchunk("IHDR", Uint8Array.from([0, 0, 0, 100, 0, 0, 0, 80, 8, 2, 0, 0, 0])),
    pchunk("acTL", Uint8Array.from([0, 0, 0, 2, 0, 0, 0, 0])),
    pchunk("fcTL", new Uint8Array(26)),
    pchunk("IDAT", Uint8Array.from([1, 2, 3])),
    pchunk("fcTL", new Uint8Array(26)),
    pchunk("fdAT", new Uint8Array(8)),
    pchunk("IEND", new Uint8Array(0)),
  );
const wchunk = (type: string, data: Uint8Array) =>
  cat(
    enc.encode(type),
    le32(data.length),
    data,
    data.length & 1 ? new Uint8Array(1) : new Uint8Array(0),
  );
const animatedWebp = () => {
  const vp8l = wchunk("VP8L", Uint8Array.from([0x2f, 99, 0xc0, 0x13, 0, 7, 16, 17, 17]));
  const body = cat(
    wchunk("VP8X", Uint8Array.from([0x02, 0, 0, 0, 99, 0, 0, 79, 0, 0])),
    wchunk("ANIM", new Uint8Array(6)),
    wchunk("ANMF", cat(new Uint8Array(16), vp8l)),
    wchunk("ANMF", cat(new Uint8Array(16), vp8l)),
  );
  return cat(enc.encode("RIFF"), le32(4 + body.length), enc.encode("WEBP"), body);
};

describe("promoteStagedImage: final review 780eaf8f", () => {
  /** Records moderation upserts and storage upload options into the world's log. */
  const traced = (w: ReturnType<typeof world>, userOwned: string[] = []) => {
    const owned = new Set(userOwned);
    const uploads: any[] = [];
    const from = w.admin.from;
    w.admin.from = ((t: string) => {
      const q = from(t);
      const upsert = q.upsert;
      q.upsert = async (row: any) => {
        w.log.push(`moderation ${row.bucket} ${row.status}`);
        return upsert(row);
      };
      return q;
    }) as any;
    const storage = w.admin.storage.from;
    w.admin.storage.from = ((bucket: string) => {
      const b = storage(bucket);
      const upload = b.upload;
      const remove = b.remove;
      b.upload = async (path: string, bytes: Uint8Array, o: any = {}) => {
        const key = `${bucket}|${path}`;
        uploads.push({ bucket, path, ...o });
        if (w.files.has(key) && !o.upsert) return { error: { message: "Duplicate" } };
        // real Storage's upsert keeps the uploader as owner: the published-path trigger refuses it (supabase/tests/520)
        if (w.files.has(key) && owned.has(key))
          return { error: { message: "PUBLISHED_IMAGE_FINAL" } };
        return upload(path, bytes);
      };
      b.remove = async (paths: string[]) => {
        for (const p of paths) owned.delete(`${bucket}|${p}`);
        return remove(paths);
      };
      return b;
    }) as any;
    return uploads;
  };

  it("5c: claims the destination (processing moderation row) before it writes there, then removes and inserts without upsert", async () => {
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg() });
    const uploads = traced(w);
    await promoteStagedImage(deps(w), input);
    const at = (l: string) => w.log.indexOf(l);
    expect(at("claim avatars")).toBeGreaterThanOrEqual(0);
    expect(at("claim avatars")).toBeLessThan(at("remove avatars"));
    expect(at("remove avatars")).toBeLessThan(at("upload avatars"));
    // published (pending) only after the bytes are in place
    expect(at("upload avatars")).toBeLessThan(at("settle avatars pending"));
    expect(w.moderation.get(`avatars|${TARGET}`)).toMatchObject({
      status: "pending",
      claim_token: null,
    });
    expect(uploads.find((u) => u.bucket === "avatars")).toMatchObject({
      path: TARGET,
      upsert: false,
    });
  });

  it("3: publishes over an object a legacy client wrote at the destination (an upsert would keep the uploader as owner)", async () => {
    const legacy = `avatars|${TARGET}`;
    const w = world({
      [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg({ gps: true }),
      [legacy]: enc.encode("legacy"),
    });
    traced(w, [legacy]);
    const out = await promoteStagedImage(deps(w), input);
    expect(out.quarantined).toBe(false);
    const published = w.files.get(legacy)!;
    expect(sniff(published)).toBe("image/jpeg");
    expect(hasText(published, "GPS")).toBe(false);
  });

  it("1: an image with partially transparent pixels is also scanned with its alpha removed; a flag there quarantines it", async () => {
    // 64x64 RGBA: an opaque left half, a hidden gradient at alpha 16 on the right
    const px = Buffer.alloc(64 * 64 * 4);
    for (let i = 0; i < 64 * 64; i++) {
      const x = i % 64;
      px.set(x < 32 ? [90, 90, 90, 255] : [(x * 4) & 255, (i >> 4) & 255, 200, 16], i * 4);
    }
    const png = u8(
      await sharp(px, { raw: { width: 64, height: 64, channels: 4 } })
        .png()
        .toBuffer(),
    );
    const stage = `${USER}/stage-a.png`;
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${stage}`]: png });
    const d = deps(w);
    // picture, on white, on black: safe; the fourth scan (alpha dropped) flags
    let calls = 0;
    d.scan.mockImplementation(async () =>
      ++calls === 4 ? { ...safe, safe: false, label: "x", csam: true, categories: ["c"] } : safe,
    );
    const out = await promoteStagedImage(d, {
      ...input,
      stagingPath: stage,
      targetPath: `${USER}/final-a.png`,
    });
    expect(d.scan).toHaveBeenCalledTimes(4);
    expect((d.scan.mock.calls[0][0] as string).startsWith("data:image/png")).toBe(true);
    // the rendition shows the hidden half at full contrast (alpha dropped), not the composited near-transparent one
    const rendition = Buffer.from((d.scan.mock.calls[3][0] as string).split(",")[1], "base64");
    const r = await sharp(rendition).raw().toBuffer({ resolveWithObject: true });
    expect(r.info.channels).toBe(3);
    expect(r.data[(10 * 64 + 60) * 3 + 2]).toBeGreaterThan(150);
    expect(out.quarantined).toBe(true);
    expect(w.files.has(`avatars|${USER}/final-a.png`)).toBe(false);
  });

  it("1: a rendition scan that cannot run holds the upload (fail closed)", async () => {
    const px = Buffer.alloc(64 * 64 * 4, 128); // alpha 128 everywhere
    const png = u8(
      await sharp(px, { raw: { width: 64, height: 64, channels: 4 } })
        .png()
        .toBuffer(),
    );
    const stage = `${USER}/stage-b.png`;
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${stage}`]: png });
    const d = deps(w);
    d.scan.mockImplementation(async (t: string) =>
      t.startsWith("data:image/jpeg") ? { ...safe, scanned: false } : safe,
    );
    const out = await promoteStagedImage(d, {
      ...input,
      stagingPath: stage,
      targetPath: `${USER}/final-b.png`,
    });
    expect(out.held).toBe(true);
    expect(w.files.has(`avatars|${USER}/final-b.png`)).toBe(false);
    expect(w.files.has(`${IMAGE_STAGING_BUCKET}|${stage}`)).toBe(true);
  });

  it("1: an opaque image is scanned once", async () => {
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg() });
    const d = deps(w);
    await promoteStagedImage(d, input);
    expect(d.scan).toHaveBeenCalledTimes(1);
  });
});

describe("promoteStagedImage: still images only, and the cleaned bytes are validated", () => {
  it.each([
    ["an animated PNG (APNG)", "png", apng],
    ["an animated WEBP", "webp", animatedWebp],
  ])("refuses %s with a clear error, removes it and publishes nothing", async (_n, ext, make) => {
    const stage = `${USER}/anim.${ext}`;
    const target = `${USER}/anim-final.${ext}`;
    for (const bucket of ["avatars", "covers", "team-avatars", "org-covers", "trainer-avatars"]) {
      const w = world({ [`${IMAGE_STAGING_BUCKET}|${stage}`]: make() });
      const d = deps(w);
      await expect(
        promoteStagedImage(d, { userId: USER, bucket, stagingPath: stage, targetPath: target }),
      ).rejects.toThrow(ANIMATED_REFUSAL);
      expect(d.scan).not.toHaveBeenCalled();
      expect(w.files.has(`${bucket}|${target}`)).toBe(false);
      expect(w.files.has(`${IMAGE_STAGING_BUCKET}|${stage}`)).toBe(false);
      expect(w.moderation.get(`${IMAGE_STAGING_BUCKET}|${stage}`).status).toBe("removed");
    }
  });

  it("refuses a WEBP with no image data (canvas header only) before any scan", async () => {
    const body = wchunk("VP8X", Uint8Array.from([0, 0, 0, 0, 99, 0, 0, 79, 0, 0]));
    const w = world({
      [`${IMAGE_STAGING_BUCKET}|${USER}/e.webp`]: cat(
        enc.encode("RIFF"),
        le32(4 + body.length),
        enc.encode("WEBP"),
        body,
      ),
    });
    const d = deps(w);
    await expect(
      promoteStagedImage(d, {
        ...input,
        stagingPath: `${USER}/e.webp`,
        targetPath: `${USER}/f.webp`,
      }),
    ).rejects.toThrow(/could not be processed/);
    expect(d.scan).not.toHaveBeenCalled();
    expect(w.files.size).toBe(0);
  });

  it("re-validates the re-encoded bytes: a result of another size, type or none at all is never published", async () => {
    const outputs: Uint8Array[] = [
      u8(await sharp(BASE_JPEG).resize(90, 80, { fit: "fill" }).jpeg().toBuffer()), // not the same picture size
      enc.encode("not an image"),
      new Uint8Array(0),
    ];
    for (const bytes of outputs) {
      const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg({ gps: true }) });
      const d = deps(w);
      d.reencode = async (): Promise<ReencodeResult> => ({
        bytes,
        mime: "image/jpeg",
        width: 100,
        height: 80,
        hasAlpha: false,
        orientation: null,
        convertedFromIcc: false,
        lossless: false,
        inputReport: {
          format: "jpeg",
          hasExif: false,
          hasGps: false,
          hasXmp: false,
          hasOther: false,
          orientation: null,
          animated: false,
        },
        scanRenditions: [],
      });
      await expect(promoteStagedImage(d, input)).rejects.toThrow(/could not be processed/);
      expect(d.scan).not.toHaveBeenCalled();
      expect(w.files.has(`avatars|${TARGET}`)).toBe(false);
      expect(w.moderation.get(`${IMAGE_STAGING_BUCKET}|${STAGE}`).status).toBe("removed");
    }
  });
});

describe("promoteStagedImage: canonical re-encode (SEC-6)", () => {
  it("publishes exactly the bytes it scanned, and they hold none of a payload hidden before the JPEG EOI", async () => {
    const payload = enc.encode("HIDDEN-SECOND-IMAGE-PAYLOAD-0123456789");
    const crafted = cat(
      BASE_JPEG.subarray(0, BASE_JPEG.length - 2),
      payload,
      Uint8Array.from([0xff, 0xd9]),
    );
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: crafted });
    const d = deps(w);
    await promoteStagedImage(d, input);
    const published = w.files.get(`avatars|${TARGET}`)!;
    const scanned = Uint8Array.from(atob((d.scan.mock.calls[0][0] as string).split(",")[1]), (c) =>
      c.charCodeAt(0),
    );
    expect(Buffer.compare(Buffer.from(published), Buffer.from(scanned))).toBe(0);
    expect(contains(published, payload)).toBe(false);
  });

  it("publishes a phone photo upright with no metadata (orientation applied to the pixels)", async () => {
    const photo = u8(readFileSync("e2e/fixtures/exif/o6.jpg"));
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: photo });
    const out = await promoteStagedImage(deps(w), input);
    expect([out.width, out.height]).toEqual([200, 100]); // stored 100x200, orientation 6
    const m = await sharp(w.files.get(`avatars|${TARGET}`)!).metadata();
    expect([m.width, m.height, m.exif, m.icc, m.orientation]).toEqual([
      200,
      100,
      undefined,
      undefined,
      undefined,
    ]);
    expect(w.moderation.get(`avatars|${TARGET}`).scan.metadata).toMatchObject({
      reencoded: true,
      orientation: 6,
    });
  });

  it("fails closed when the image library is unavailable: nothing scanned or published, the original stays private", async () => {
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg({ gps: true }) });
    const d = deps(w);
    d.reencode = async () => {
      throw new ImageReencodeError("unavailable");
    };
    const out = await promoteStagedImage(d, input);
    expect(out.held).toBe(true);
    expect(out.reason).toBe(PROCESSING_UNAVAILABLE);
    expect(d.scan).not.toHaveBeenCalled();
    expect(w.files.has(`avatars|${TARGET}`)).toBe(false);
    expect(w.files.has(`${IMAGE_STAGING_BUCKET}|${STAGE}`)).toBe(true);
    expect(w.moderation.get(`${IMAGE_STAGING_BUCKET}|${STAGE}`)).toMatchObject({
      status: "pending",
      reason: PROCESSING_UNAVAILABLE,
    });
  });

  it("refuses a decompression bomb with a clear error and publishes nothing", async () => {
    // within the 8 MB and 6000 px header checks it would fail anyway; here the header passes and the pixel cap refuses
    const bomb = u8(
      await sharp({ create: { width: 5800, height: 5800, channels: 3, background: "#000" } })
        .png({ compressionLevel: 9 })
        .toBuffer(),
    );
    const stage = `${USER}/bomb.png`;
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${stage}`]: bomb });
    const d = deps(w);
    await expect(
      promoteStagedImage(d, { ...input, stagingPath: stage, targetPath: `${USER}/bomb-final.png` }),
    ).rejects.toThrow(/resolution is too high/);
    expect(d.scan).not.toHaveBeenCalled();
    expect(w.files.size).toBe(0);
  });
});

describe("promoteStagedImage: concurrent calls on one path (R5 independent review 39ae9545, finding 1)", () => {
  const flagged = {
    ...safe,
    safe: false,
    label: "x",
    reason: "flagged",
    csam: true,
    categories: ["c"],
  };
  const gate = () => {
    let open!: () => void;
    const p = new Promise<void>((r) => (open = r));
    return { p, open };
  };

  it("a flag recorded while another call is still scanning wins: nothing is published and the row stays quarantined", async () => {
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg() });
    const reached = gate();
    const release = gate();
    const b = deps(w);
    b.scan.mockImplementation(async () => {
      reached.open();
      await release.p;
      return safe;
    });
    const callB = promoteStagedImage(b, input);
    await reached.p; // B has downloaded, re-encoded and is inside its scan
    // B hangs past the claim's 10-minute expiry (a stalled worker), so A can take the path over and finish first
    w.clock.now += 11 * 60_000;
    const a = deps(w, flagged);
    const outA = await promoteStagedImage(a, input);
    expect(outA.quarantined).toBe(true);
    expect(a.escalate).toHaveBeenCalled();
    release.open();
    await expect(callB).rejects.toThrow(/flagged/);
    expect(w.files.has(`avatars|${TARGET}`)).toBe(false);
    expect(w.moderation.get(`${IMAGE_STAGING_BUCKET}|${STAGE}`).status).toBe("quarantined");
    expect(w.moderation.get(`avatars|${TARGET}`).status).toBe("quarantined");
  });

  it("a second call while the first is processing is refused before it reads anything", async () => {
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg() });
    const reached = gate();
    const release = gate();
    const b = deps(w);
    b.scan.mockImplementation(async () => {
      reached.open();
      await release.p;
      return safe;
    });
    const callB = promoteStagedImage(b, input);
    await reached.p;
    const a = deps(w, flagged);
    await expect(promoteStagedImage(a, input)).rejects.toThrow(PROCESSING_BUSY);
    expect(a.scan).not.toHaveBeenCalled();
    release.open();
    const outB = await callB;
    expect(outB.quarantined).toBe(false);
    expect(w.moderation.get(`avatars|${TARGET}`).status).toBe("pending");
  });

  it("a flag recorded after the bytes were written but before they are recorded as published takes them down again", async () => {
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg() });
    const storage = w.admin.storage.from;
    w.admin.storage.from = ((bucket: string) => {
      const b = storage(bucket);
      const upload = b.upload;
      b.upload = async (path: string, bytes: Uint8Array) => {
        const r = await upload(path, bytes);
        if (bucket === "avatars") {
          // another call's flag lands now: it records the staged path and the destination as quarantined, unconditionally
          for (const [bk, p] of [
            [IMAGE_STAGING_BUCKET, STAGE],
            ["avatars", TARGET],
          ])
            await w.admin
              .from("image_moderation")
              .upsert({ bucket: bk, path: p, status: "quarantined", claim_token: null });
        }
        return r;
      };
      return b;
    }) as any;
    await expect(promoteStagedImage(deps(w), input)).rejects.toThrow(/flagged/);
    expect(w.files.has(`avatars|${TARGET}`)).toBe(false);
    expect(w.moderation.get(`avatars|${TARGET}`).status).toBe("quarantined");
    // the staged original is now the other call's evidence: it is not removed
    expect(w.files.has(`${IMAGE_STAGING_BUCKET}|${STAGE}`)).toBe(true);
  });
});

describe("promoteStagedImage: transparency renditions (R5 independent review 39ae9545, finding 2)", () => {
  it("a flag on the second rendition (flattened on black) flags the image", async () => {
    const stage = `${USER}/stage-r.png`;
    const w = world({ [`${IMAGE_STAGING_BUCKET}|${stage}`]: jpeg() });
    const d = deps(w);
    d.reencode = async (b: Uint8Array): Promise<ReencodeResult> => {
      const real = await reencodeImage(b);
      return {
        ...real,
        scanRenditions: ["data:image/jpeg;base64,WHITE", "data:image/jpeg;base64,BLACK"],
      };
    };
    d.scan.mockImplementation(async (t: string) =>
      t.endsWith("BLACK")
        ? { ...safe, safe: false, label: "x", reason: "f", categories: ["v"] }
        : safe,
    );
    const out = await promoteStagedImage(d, { ...input, stagingPath: stage });
    expect(d.scan).toHaveBeenCalledTimes(3);
    expect(out.quarantined).toBe(true);
    expect(w.files.has(`avatars|${TARGET}`)).toBe(false);
  });
});

describe("sweepImageStaging", () => {
  const NOW = Date.parse("2026-11-05T12:00:00Z");
  const listing = (
    items: Record<string, { name: string; id: string | null; created_at: string | null }[]>,
    flaggedPaths: string[] = [],
    rowsFor: Record<string, any> = {},
    lookupError = false,
  ) => {
    const removed: string[] = [];
    const deletedRows: string[] = [];
    const admin = {
      storage: {
        from: () => ({
          list: async (prefix: string, o?: { limit?: number; offset?: number }) => {
            const rows =
              prefix === ""
                ? Object.keys(items).map((name) => ({ name, id: null }))
                : (items[prefix] ?? []);
            const off = o?.offset ?? 0;
            return { data: rows.slice(off, off + (o?.limit ?? 1000)) };
          },
          remove: async (paths: string[]) => {
            removed.push(...paths);
            return { error: null };
          },
        }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            in: async (_c: string, paths: string[]) =>
              lookupError
                ? { data: null, error: { message: "db down" } }
                : {
                    data: [
                      ...paths
                        .filter((p) => flaggedPaths.includes(p))
                        .map((path) => ({ path, status: "quarantined" })),
                      ...paths
                        .filter((p) => rowsFor[p])
                        .map((path) => ({ path, ...rowsFor[path] })),
                    ],
                    error: null,
                  },
          }),
        }),
        delete: () => ({
          eq: () => ({
            in: async (_c: string, paths: string[]) => {
              deletedRows.push(...paths);
              return {};
            },
          }),
        }),
      }),
    };
    return { admin, removed, deletedRows };
  };
  const old = { name: "a.jpg", id: "o-a", created_at: "2026-11-03T00:00:00Z" };
  const fresh = { name: "b.jpg", id: "o-b", created_at: "2026-11-05T11:00:00Z" };

  it("removes only files older than the window, and their moderation rows", async () => {
    const { admin, removed, deletedRows } = listing({ u1: [old, fresh] });
    const r = await sweepImageStaging(admin, { olderThanMs: 24 * 3600 * 1000, now: NOW });
    expect(removed).toEqual(["u1/a.jpg"]);
    expect(deletedRows).toEqual(["u1/a.jpg"]);
    expect(r).toMatchObject({ examined: 2, removed: 1, kept: 1, keptFlagged: 0 });
  });
  it("skips a nested folder instead of passing a folder name to remove()", async () => {
    const { admin, removed } = listing({
      u1: [old, { name: "nested", id: null, created_at: null }],
    });
    const r = await sweepImageStaging(admin, { olderThanMs: 1000, now: NOW });
    expect(removed).toEqual(["u1/a.jpg"]);
    expect(r).toMatchObject({ examined: 1, removed: 1, skippedNested: 1 });
  });
  it("never removes a quarantined file (possible child-safety evidence)", async () => {
    const { admin, removed } = listing({ u1: [old] }, ["u1/a.jpg"]);
    const r = await sweepImageStaging(admin, { olderThanMs: 1000, now: NOW });
    expect(removed).toEqual([]);
    expect(r.keptFlagged).toBe(1);
  });
  it("5a: protects a flagged file only while it is genuinely held (its quarantine copy failed or was never made)", async () => {
    const copied = { name: "c.jpg", id: "o-c", created_at: "2026-11-03T00:00:00Z" };
    const failed = { name: "d.jpg", id: "o-d", created_at: "2026-11-03T00:00:00Z" };
    const { admin, removed } = listing({ u1: [copied, failed] }, [], {
      "u1/c.jpg": {
        status: "quarantined",
        scan: {
          quarantine: { bucket: IMAGE_QUARANTINE_BUCKET, path: "image_upload/x.jpg", item_id: "i" },
        },
      },
      "u1/d.jpg": { status: "quarantined", scan: { quarantine: { failed: true } } },
    });
    const r = await sweepImageStaging(admin, { olderThanMs: 1000, now: NOW });
    expect(removed).toEqual(["u1/c.jpg"]); // the quarantine holds that original
    expect(r.keptFlagged).toBe(1);
  });
  it("5a/2: never sweeps the private held fallback (_held/)", async () => {
    const { admin, removed } = listing({ _held: [old] });
    await sweepImageStaging(admin, { olderThanMs: 1000, now: NOW });
    expect(removed).toEqual([]);
  });
  it("keeps everything when the moderation state cannot be read", async () => {
    const { admin, removed } = listing({ u1: [old] }, [], {}, true);
    const r = await sweepImageStaging(admin, { olderThanMs: 1000, now: NOW });
    expect(removed).toEqual([]);
    expect(r.keptFlagged).toBe(1);
  });
  it("a dry run changes nothing", async () => {
    const { admin, removed, deletedRows } = listing({ u1: [old] });
    const r = await sweepImageStaging(admin, { olderThanMs: 1000, now: NOW, dryRun: true });
    expect(removed).toEqual([]);
    expect(deletedRows).toEqual([]);
    expect(r.removed).toBe(1);
  });
  it("keeps files with an unknown age", async () => {
    const { admin, removed } = listing({ u1: [{ name: "c.jpg", id: "o-c", created_at: "" }] });
    await sweepImageStaging(admin, { olderThanMs: 1, now: NOW });
    expect(removed).toEqual([]);
  });
  it("pages through folders and files beyond one page", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      name: `f${i}.jpg`,
      id: `o-${i}`,
      created_at: "2026-11-01T00:00:00Z",
    }));
    const { admin, removed } = listing({ u1: many });
    const r = await sweepImageStaging(admin, { olderThanMs: 1000, now: NOW, pageSize: 2 });
    expect(removed.length).toBe(5);
    expect(r.examined).toBe(5);
  });
});
