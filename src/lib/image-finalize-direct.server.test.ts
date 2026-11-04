/* eslint-disable @typescript-eslint/no-explicit-any -- the storage/database client is faked structurally */
import { describe, expect, it, vi } from "vitest";
import {
  FLAGGED_REFUSAL,
  SCAN_UNAVAILABLE_REFUSAL,
  finalizeDirectImageUpload,
} from "./image-finalize-direct.server";

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

const USER = "11111111-1111-1111-1111-111111111111";
const PATH = `${USER}/avatar.jpg`;
const KEY = `avatars|${PATH}`;

function world(initial: Record<string, Uint8Array>, moderation: Record<string, any> = {}) {
  const files = new Map<string, Uint8Array>(Object.entries(initial));
  const rows = new Map<string, any>(Object.entries(moderation));
  const upserts: any[] = [];
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
          return { data: { id: "obj" }, error: null };
        },
        remove: async (paths: string[]) => {
          for (const p of paths) files.delete(`${bucket}|${p}`);
          return { error: null };
        },
      }),
    },
    from: () => ({
      upsert: async (row: any) => {
        upserts.push(row);
        rows.set(`${row.bucket}|${row.path}`, row);
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
  return { files, rows, upserts, admin };
}
const safe = { safe: true, label: "ok", reason: null, categories: [], scanned: true, csam: false };
const deps = (w: ReturnType<typeof world>, verdict: any = safe) => ({
  admin: w.admin,
  scan: vi.fn().mockResolvedValue(verdict),
  objectUrl: vi.fn().mockResolvedValue("https://public/avatars/x.jpg"),
  escalate: vi.fn().mockResolvedValue(undefined),
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
    const w = world({ [KEY]: jpeg({ pad: 4.5 * 1024 * 1024 }) });
    const d = deps(w);
    d.objectUrl.mockResolvedValue(null);
    await expect(finalizeDirectImageUpload(d, input)).rejects.toThrow(SCAN_UNAVAILABLE_REFUSAL);
    expect(d.scan).not.toHaveBeenCalled();
    expect(w.files.has(KEY)).toBe(false);
    expect(w.rows.get(KEY)).toEqual(expect.objectContaining({ status: "removed" }));
  });

  it("quarantines and escalates an unsafe image", async () => {
    const w = world({ [KEY]: jpeg() });
    const d = deps(w, { ...safe, safe: false, csam: true, categories: ["csam"] });
    const out = await finalizeDirectImageUpload(d, input);
    expect(out.quarantined).toBe(true);
    expect(w.rows.get(KEY).status).toBe("quarantined");
    expect(d.escalate).toHaveBeenCalledWith("avatars", PATH, ["csam"]);
  });

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
