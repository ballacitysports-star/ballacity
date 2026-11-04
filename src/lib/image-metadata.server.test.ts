import { describe, expect, it, vi } from "vitest";
import { addToScanCounts, emptyScanCounts, stripStoredImage } from "./image-metadata.server";

const enc = new TextEncoder();
const cat = (...p: Uint8Array[]) => {
  const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let k = 0;
  for (const x of p) (o.set(x, k), (k += x.length));
  return o;
};
const seg = (m: number, payload: Uint8Array) =>
  cat(Uint8Array.from([0xff, m, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload);
const jpeg = (withComment: boolean) =>
  cat(
    Uint8Array.from([0xff, 0xd8]),
    ...(withComment ? [seg(0xfe, enc.encode("GPS 33.7,-84.3"))] : []),
    seg(0xc0, Uint8Array.from([8, 0, 80, 0, 100, 1, 1, 0x11, 0])),
    seg(0xda, Uint8Array.from([1, 1, 0, 0, 63, 0])),
    Uint8Array.from([1, 2, 3, 0xff, 0xd9]),
  );

function fakeAdmin(uploadError: string | null = null) {
  const upload = vi
    .fn()
    .mockResolvedValue({ error: uploadError ? { message: uploadError } : null });
  return { upload, admin: { storage: { from: vi.fn(() => ({ upload })) } } as never };
}

describe("stripStoredImage", () => {
  it("writes the cleaned bytes back over the same path with the same type", async () => {
    const { admin, upload } = fakeAdmin();
    const out = await stripStoredImage(admin, "game-covers", "u1/a.jpg", jpeg(true), "image/jpeg");
    expect(out.rewritten).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
    const [path, bytes, opts] = upload.mock.calls[0];
    expect(path).toBe("u1/a.jpg");
    expect(opts).toMatchObject({ contentType: "image/jpeg", upsert: true });
    expect(Array.from(bytes as Uint8Array).join()).not.toContain("71,80,83"); // no "GPS" text left
    expect(out.bytes).toBe(bytes);
  });
  it("does not touch storage when there is nothing to remove", async () => {
    const { admin, upload } = fakeAdmin();
    const clean = jpeg(false);
    const out = await stripStoredImage(admin, "avatars", "u1/a.jpg", clean, "image/jpeg");
    expect(out.rewritten).toBe(false);
    expect(out.bytes).toBe(clean);
    expect(upload).not.toHaveBeenCalled();
  });
  it("fails closed when the rewrite fails or the file is malformed", async () => {
    await expect(
      stripStoredImage(fakeAdmin("boom").admin, "avatars", "u1/a.jpg", jpeg(true), "image/jpeg"),
    ).rejects.toThrow(/rewrite/);
    await expect(
      stripStoredImage(
        fakeAdmin().admin,
        "avatars",
        "u1/a.jpg",
        jpeg(true).slice(0, 12),
        "image/jpeg",
      ),
    ).rejects.toThrow();
  });
});

describe("scan counts", () => {
  it("counts without ever carrying a value", () => {
    const c = emptyScanCounts();
    const gps = {
      format: "jpeg",
      hasExif: true,
      hasGps: true,
      hasXmp: false,
      hasOther: false,
      orientation: 6,
      animated: false,
    } as const;
    const clean = {
      format: "png",
      hasExif: false,
      hasGps: false,
      hasXmp: false,
      hasOther: false,
      orientation: null,
      animated: false,
    } as const;
    expect(addToScanCounts(c, "avatars", gps)).toBe(true);
    expect(addToScanCounts(c, "avatars", clean)).toBe(false);
    expect(addToScanCounts(c, "covers", null)).toBe(false);
    expect(c).toMatchObject({ scanned: 3, unreadable: 1, withGps: 1, withExif: 1 });
    expect(c.perBucket.avatars).toEqual({ scanned: 2, withGps: 1, withAnyMetadata: 1 });
  });
});
