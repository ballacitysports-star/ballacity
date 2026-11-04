/* eslint-disable @typescript-eslint/no-explicit-any -- the storage/database client is faked structurally */
import { describe, expect, it, vi } from "vitest";
import { promoteStagedImage, type PromotionDeps } from "./image-promotion.server";
import { IMAGE_STAGING_BUCKET, isOwnFilePath } from "./image-staging";

const enc = new TextEncoder();
const cat = (...p: Uint8Array[]) => {
  const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let k = 0;
  for (const x of p) (o.set(x, k), (k += x.length));
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

  it("scans a large image through a short-lived signed URL of the private copy", async () => {
    const w = world({
      [`${IMAGE_STAGING_BUCKET}|${STAGE}`]: jpeg({ gps: true, pad: 4.5 * 1024 * 1024 }),
    });
    const d = deps(w);
    const out = await promoteStagedImage(d, input);
    expect(out.quarantined).toBe(false);
    expect(d.scan.mock.calls[0][0]).toBe(`https://signed/${IMAGE_STAGING_BUCKET}/${STAGE}`);
    expect(hasText(w.files.get(`avatars|${TARGET}`)!, "GPS")).toBe(false);
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
});
