/* eslint-disable @typescript-eslint/no-explicit-any -- the storage/database client is faked structurally */
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  FLAGGED_REFUSAL,
  SCAN_UNAVAILABLE_REFUSAL,
  finalizeDirectImageUpload,
} from "./image-finalize-direct.server";
import { IMAGE_QUARANTINE_BUCKET } from "./image-quarantine.server";
import { ImageReencodeError } from "./image-reencode.server";

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
const BASE = u8(
  await sharp({ create: { width: 100, height: 80, channels: 3, background: "#cc6633" } })
    .jpeg()
    .toBuffer(),
);
const jpeg = (opts: { gps?: boolean } = {}) =>
  opts.gps
    ? cat(
        BASE.subarray(0, 2),
        seg(0xe1, enc.encode("Exif\0\0GPS 33.7488,-84.3877")),
        BASE.subarray(2),
      )
    : BASE.slice();
const NOISE_PNG = u8(
  await sharp(randomBytes(1300 * 1200 * 3), { raw: { width: 1300, height: 1200, channels: 3 } })
    .png()
    .toBuffer(),
);
const contains = (hay: Uint8Array, needle: Uint8Array) =>
  Buffer.from(hay.buffer, hay.byteOffset, hay.byteLength).indexOf(Buffer.from(needle)) >= 0;

const USER = "11111111-1111-1111-1111-111111111111";
const PATH = `${USER}/avatar.jpg`;
const KEY = `avatars|${PATH}`;

function world(initial: Record<string, Uint8Array>, moderation: Record<string, any> = {}) {
  const files = new Map<string, Uint8Array>(Object.entries(initial));
  const rows = new Map<string, any>(Object.entries(moderation));
  const upserts: any[] = [];
  const items: any[] = [];
  const log: string[] = [];
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
          files.set(`${bucket}|${path}`, bytes);
          log.push(`upload ${bucket}`);
          return { data: { id: "obj" }, error: null };
        },
        remove: async (paths: string[]) => {
          for (const p of paths) files.delete(`${bucket}|${p}`);
          log.push(`remove ${bucket}`);
          return { error: null };
        },
      }),
    },
    from: () => ({
      insert: (row: any) => ({
        select: () => ({
          single: async () => {
            items.push({ id: `item-${items.length + 1}`, ...row });
            log.push("record quarantine item");
            return { data: { id: `item-${items.length}` }, error: null };
          },
        }),
      }),
      upsert: async (row: any) => {
        upserts.push(row);
        rows.set(`${row.bucket}|${row.path}`, row);
        log.push(`moderation ${row.status}`);
        return { error: null };
      },
      select: () => {
        const f: Record<string, string> = {};
        const q: any = {
          eq: (k: string, v: string) => ((f[k] = v), q),
          maybeSingle: async () => ({
            data: rows.get(`${f.bucket}|${f.path}`) ?? null,
            error: null,
          }),
        };
        return q;
      },
    }),
  };
  return { files, rows, upserts, items, log, admin };
}
const safe = { safe: true, label: "ok", reason: null, categories: [], scanned: true, csam: false };
const deps = (w: ReturnType<typeof world>, verdict: any = safe) => ({
  admin: w.admin,
  scan: vi.fn().mockResolvedValue(verdict),
  objectUrl: vi.fn().mockResolvedValue("https://public/avatars/x.jpg"),
  escalate: vi.fn(async () => {
    w.log.push("escalate");
  }),
  reencode: undefined as any,
});
const input = { userId: USER, bucket: "avatars", path: PATH };

describe("finalizeDirectImageUpload (legacy direct uploads)", () => {
  it("cleans, scans and records a normal upload as pending", async () => {
    const w = world({ [KEY]: jpeg({ gps: true }) });
    const out = await finalizeDirectImageUpload(deps(w), input);
    expect(out.quarantined).toBe(false);
    expect(out.metadataStripped).toBe(true);
    expect(w.rows.get(KEY).status).toBe("pending");
  });

  it.each(["quarantined", "removed"])(
    "M3: never rescans an object already %s, so the owner cannot undo a moderator's decision",
    async (status) => {
      const w = world({ [KEY]: jpeg() }, { [KEY]: { bucket: "avatars", path: PATH, status } });
      const d = deps(w);
      await expect(finalizeDirectImageUpload(d, input)).rejects.toThrow(FLAGGED_REFUSAL);
      expect(d.scan).not.toHaveBeenCalled();
      expect(w.upserts).toEqual([]);
      expect(w.rows.get(KEY).status).toBe(status);
    },
  );

  it("still rechecks an object that is pending or kept", async () => {
    const w = world(
      { [KEY]: jpeg() },
      { [KEY]: { bucket: "avatars", path: PATH, status: "kept" } },
    );
    const out = await finalizeDirectImageUpload(deps(w), input);
    expect(out.ok).toBe(true);
  });

  it("M3: fails closed when the scanner reports it could not scan", async () => {
    const w = world({ [KEY]: jpeg() });
    await expect(
      finalizeDirectImageUpload(deps(w, { ...safe, scanned: false }), input),
    ).rejects.toThrow(SCAN_UNAVAILABLE_REFUSAL);
    expect(w.files.has(KEY)).toBe(false);
    expect(w.rows.get(KEY).status).toBe("removed");
  });

  it("M3: fails closed when the scanner throws", async () => {
    const w = world({ [KEY]: jpeg() });
    const d = deps(w);
    d.scan.mockRejectedValue(new Error("gateway down"));
    await expect(finalizeDirectImageUpload(d, input)).rejects.toThrow(SCAN_UNAVAILABLE_REFUSAL);
    expect(w.files.has(KEY)).toBe(false);
  });

  it("M3: fails closed when there is no scan target (large image, no URL)", async () => {
    const big = `${USER}/big.png`;
    const w = world({ [`avatars|${big}`]: NOISE_PNG });
    const d = deps(w);
    d.objectUrl.mockResolvedValue(null);
    await expect(finalizeDirectImageUpload(d, { ...input, path: big })).rejects.toThrow(
      SCAN_UNAVAILABLE_REFUSAL,
    );
    expect(d.scan).not.toHaveBeenCalled();
    expect(w.files.has(`avatars|${big}`)).toBe(false);
    expect(w.rows.get(`avatars|${big}`)).toEqual(expect.objectContaining({ status: "removed" }));
  });

  it("SEC-6: moves a flagged image's original to the quarantine, removes the public object, then escalates", async () => {
    const w = world({ [KEY]: jpeg({ gps: true }) });
    const d = deps(w, { ...safe, safe: false, csam: true, categories: ["csam"] });
    const out = await finalizeDirectImageUpload(d, input);
    expect(out.quarantined).toBe(true);
    const held = w.items[0];
    expect(held).toMatchObject({
      source: "legacy_direct_upload",
      source_bucket: "avatars",
      source_path: PATH,
      suspected_csam: true,
    });
    expect(w.files.get(`${IMAGE_QUARANTINE_BUCKET}|${held.object_path}`)).toEqual(
      jpeg({ gps: true }),
    );
    expect(w.files.has(KEY)).toBe(false); // no longer at a public URL
    expect(w.rows.get(KEY).status).toBe("quarantined");
    expect(w.rows.get(KEY).scan.quarantine.path).toBe(held.object_path);
    expect(d.escalate).toHaveBeenCalledWith(IMAGE_QUARANTINE_BUCKET, held.object_path, ["csam"]);
  });

  it("SEC-6: claims the path before rewriting it, rewrites it with the re-encoded bytes, and scans exactly those", async () => {
    const payload = enc.encode("HIDDEN-PAYLOAD-IN-THE-JPEG-TAIL-0123456789");
    const crafted = cat(BASE.subarray(0, BASE.length - 2), payload, Uint8Array.from([0xff, 0xd9]));
    const w = world({ [KEY]: crafted });
    const d = deps(w);
    await finalizeDirectImageUpload(d, input);
    // a moderation row exists before the rewrite, so the uploader's own writes are refused from then on (20261108120000)
    expect(w.log.slice(0, 2)).toEqual(["moderation pending", "upload avatars"]);
    expect(w.upserts[0]).toMatchObject({ status: "pending", reason: "Processing" });
    const stored = w.files.get(KEY)!;
    expect(contains(stored, payload)).toBe(false);
    const scanned = Uint8Array.from(atob((d.scan.mock.calls[0][0] as string).split(",")[1]), (c) =>
      c.charCodeAt(0),
    );
    expect(Buffer.compare(Buffer.from(stored), Buffer.from(scanned))).toBe(0);
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
  });

  it.each([
    ["unavailable", SCAN_UNAVAILABLE_REFUSAL],
    ["animated", "Animated images"],
    ["too_large", "resolution is too high"],
  ] as const)(
    "SEC-6: a re-encode failure (%s) removes the public object and refuses",
    async (code, msg) => {
      const w = world({ [KEY]: jpeg() });
      const d = deps(w);
      d.reencode = async () => {
        throw new ImageReencodeError(code);
      };
      await expect(finalizeDirectImageUpload(d, input)).rejects.toThrow(msg);
      expect(d.scan).not.toHaveBeenCalled();
      expect(w.files.has(KEY)).toBe(false);
      expect(w.rows.get(KEY).status).toBe("removed");
    },
  );

  it("refuses another user's path and unknown buckets", async () => {
    const w = world({});
    await expect(
      finalizeDirectImageUpload(deps(w), { ...input, path: "someone-else/x.jpg" }),
    ).rejects.toThrow(/own uploads/);
    await expect(
      finalizeDirectImageUpload(deps(w), { ...input, bucket: "image-staging" }),
    ).rejects.toThrow(/Unsupported bucket/);
  });
});
