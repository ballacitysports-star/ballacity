/* eslint-disable @typescript-eslint/no-explicit-any -- the storage/database client is faked structurally */
import { describe, expect, it, vi } from "vitest";
import type { StripResult } from "./image-metadata";

// Pass-through by default; a test can replace the stripper's output to prove the clean bytes are validated again.
const stripOverride = vi.hoisted(() => ({ fn: null as null | ((b: Uint8Array) => StripResult) }));
vi.mock("@/lib/image-metadata", async (importOriginal) => {
  const real = await importOriginal<typeof import("./image-metadata")>();
  return {
    ...real,
    stripImageMetadata: (b: Uint8Array) =>
      stripOverride.fn ? stripOverride.fn(b) : real.stripImageMetadata(b),
  };
});
import {
  ANIMATED_REFUSAL,
  promoteStagedImage,
  sweepImageStaging,
  type PromotionDeps,
} from "./image-promotion.server";
import { IMAGE_STAGING_BUCKET, isOwnFilePath } from "./image-staging";

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
const seg = (m: number, payload: Uint8Array) =>
  cat(Uint8Array.from([0xff, m, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload);
const jpeg = (opts: { gps?: boolean; pad?: number } = {}) =>
  cat(
    Uint8Array.from([0xff, 0xd8]),
    ...(opts.gps ? [seg(0xe1, enc.encode("Exif\0\0GPS 33.7488,-84.3877"))] : []),
    seg(0xc0, Uint8Array.from([8, 0, 80, 0, 100, 1, 1, 0x11, 0])),
    seg(0xda, Uint8Array.from([1, 1, 0, 0, 63, 0])),
    new Uint8Array(opts.pad ?? 3).fill(1),
    Uint8Array.from([0xff, 0xd9]),
  );
const hasText = (b: Uint8Array, t: string) => new TextDecoder("latin1").decode(b).includes(t);

const USER = "11111111-1111-1111-1111-111111111111";
const STAGE = `${USER}/stage-1.jpg`;
const TARGET = `${USER}/final-1.jpg`;

function world(initial: Record<string, Uint8Array> = {}, uploadError: string | null = null) {
  const files = new Map<string, Uint8Array>(Object.entries(initial)); // key: bucket|path
  const moderation = new Map<string, any>();
  const admin = {
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          const b = files.get(`${bucket}|${path}`);
          return b
            ? { data: new Blob([b as BlobPart]), error: null }
            : { data: null, error: { message: "not found" } };
        },
        upload: async (path: string, bytes: Uint8Array) => {
          if (uploadError) return { error: { message: uploadError } };
          files.set(`${bucket}|${path}`, bytes);
          return { error: null };
        },
        remove: async (paths: string[]) => {
          for (const p of paths) files.delete(`${bucket}|${p}`);
          return { error: null };
        },
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://signed/${bucket}/${path}` },
        }),
      }),
    },
    from: () => ({
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
  return { files, moderation, admin };
}
const safe = { safe: true, label: "ok", reason: null, categories: [], scanned: true, csam: false };
const deps = (
  w: ReturnType<typeof world>,
  verdict: any = safe,
): PromotionDeps & { scan: any; escalate: any } => ({
  admin: w.admin,
  scan: vi.fn().mockResolvedValue(verdict),
  escalate: vi.fn().mockResolvedValue(undefined),
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
    expect(w.files.has(`${IMAGE_STAGING_BUCKET}|${STAGE}`)).toBe(true);
    expect(w.moderation.get(`${IMAGE_STAGING_BUCKET}|${STAGE}`).status).toBe("quarantined");
    expect(d.escalate).toHaveBeenCalledWith(IMAGE_STAGING_BUCKET, STAGE, ["c"]);
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
    const w = world({
      [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg({ gps: true, pad: 4.5 * 1024 * 1024 }),
    });
    const d = deps(w);
    let scannedBytes: Uint8Array | null = null;
    d.scan.mockImplementation(async (url: string) => {
      const m = url.match(/^https:\/\/signed\/image-staging\/(_scan\/.+)$/);
      expect(m).not.toBeNull();
      scannedBytes = w.files.get(`${IMAGE_STAGING_BUCKET}|${m![1]}`) ?? null;
      return safe;
    });
    const out = await promoteStagedImage(d, input);
    expect(out.quarantined).toBe(false);
    expect(scannedBytes).not.toBeNull();
    expect(hasText(scannedBytes!, "GPS")).toBe(false);
    // what was scanned is exactly what was published
    expect(w.files.get(`avatars|${TARGET}`)).toBe(scannedBytes);
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

  it("re-validates the cleaned bytes: a cleaned result of another size, type or none at all is never published", async () => {
    const outputs: Uint8Array[] = [
      jpeg().map((x, i) => (i === 10 ? 0 : x)), // height 80 -> 0: not the same picture, and too small
      enc.encode("not an image"),
      new Uint8Array(0),
    ];
    try {
      for (const bytes of outputs) {
        stripOverride.fn = () => ({
          bytes,
          changed: true,
          report: {
            format: "jpeg",
            hasExif: false,
            hasGps: false,
            hasXmp: false,
            hasOther: false,
            orientation: null,
            animated: false,
          },
        });
        const w = world({ [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg({ gps: true }) });
        const d = deps(w);
        await expect(promoteStagedImage(d, input)).rejects.toThrow(/could not be processed/);
        expect(d.scan).not.toHaveBeenCalled();
        expect(w.files.has(`avatars|${TARGET}`)).toBe(false);
        expect(w.moderation.get(`${IMAGE_STAGING_BUCKET}|${STAGE}`).status).toBe("removed");
      }
    } finally {
      stripOverride.fn = null;
    }
  });
});

describe("sweepImageStaging", () => {
  const NOW = Date.parse("2026-11-05T12:00:00Z");
  const listing = (
    items: Record<string, { name: string; id: string | null; created_at: string | null }[]>,
    flaggedPaths: string[] = [],
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
            in: async (_c: string, paths: string[]) => ({
              data: paths
                .filter((p) => flaggedPaths.includes(p))
                .map((path) => ({ path, status: "quarantined" })),
            }),
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
