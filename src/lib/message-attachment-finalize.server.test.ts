/* eslint-disable @typescript-eslint/no-explicit-any -- the storage/database client is faked structurally */
import { describe, expect, it, vi } from "vitest";
import {
  ATTACHMENT_BUCKET,
  ATTACHMENT_SCAN_PREFIX,
  finalizeAttachment,
} from "./message-attachment-finalize.server";
import { parseAttachmentPath } from "./message-attachment-validation";

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

const CONV = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const PATH = `${CONV}/${USER}/photo.jpg`;

/** Storage with object ids: every write makes a new object id, as a delete + re-upload does. */
function world(initial: Record<string, Uint8Array>) {
  let seq = 0;
  const files = new Map<string, { bytes: Uint8Array; id: string }>();
  for (const [p, b] of Object.entries(initial)) files.set(p, { bytes: b, id: `obj-${++seq}` });
  const checks: any[] = [];
  let checkError: ((row: any) => string | null) | null = null;
  const bucket = {
    info: async (p: string) => {
      const f = files.get(p);
      return f
        ? { data: { id: f.id }, error: null }
        : { data: null, error: { message: "not found" } };
    },
    download: async (p: string) => {
      const f = files.get(p);
      return f
        ? { data: new Blob([f.bytes as BlobPart]), error: null }
        : { data: null, error: { message: "not found" } };
    },
    upload: async (p: string, bytes: Uint8Array) => {
      const id = `obj-${++seq}`;
      files.set(p, { bytes, id });
      return { data: { id, path: p }, error: null };
    },
    remove: async (paths: string[]) => {
      for (const p of paths) files.delete(p);
      return { error: null };
    },
    createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://signed/${p}` } }),
  };
  const admin = {
    storage: { from: vi.fn(() => bucket) },
    from: () => ({
      upsert: async (row: any) => {
        const e = checkError?.(row) ?? null;
        if (e) return { error: { message: e } };
        checks.push(row);
        return { error: null };
      },
    }),
  };
  /** The sender deletes their file and uploads another at the same path (msg_attach_delete_sender + insert). */
  const swap = (bytes: Uint8Array) => files.set(PATH, { bytes, id: `obj-${++seq}` });
  return {
    files,
    checks,
    admin,
    swap,
    failChecks: (f: (row: any) => string | null) => (checkError = f),
  };
}
const safe = { safe: true, csam: false, categories: [] as string[], scanned: true };
const deps = (w: ReturnType<typeof world>) => ({
  admin: w.admin,
  scan: vi.fn().mockResolvedValue(safe),
  escalate: vi.fn().mockResolvedValue(undefined),
});
const input = { userId: USER, conversationId: CONV, path: PATH };

describe("finalizeAttachment: the check is bound to the object that was checked", () => {
  it("records the id of the checked object", async () => {
    const w = world({ [PATH]: jpeg() });
    const out = await finalizeAttachment(deps(w), input);
    expect(out.objectId).toBe(w.files.get(PATH)!.id);
    expect(w.checks).toEqual([expect.objectContaining({ path: PATH, object_id: out.objectId })]);
  });

  it("records the id of the server's clean rewrite when metadata was removed", async () => {
    const w = world({ [PATH]: jpeg({ gps: true }) });
    const before = w.files.get(PATH)!.id;
    const out = await finalizeAttachment(deps(w), input);
    expect(out.objectId).not.toBe(before);
    expect(out.objectId).toBe(w.files.get(PATH)!.id);
    expect(hasText(w.files.get(PATH)!.bytes, "GPS")).toBe(false);
  });

  it("refuses, and records nothing, when the sender replaces the file while it is being checked", async () => {
    const w = world({ [PATH]: jpeg() });
    const d = deps(w);
    d.scan.mockImplementation(async () => {
      w.swap(enc.encode("%PDF-1.7 a different file at the same path"));
      return safe;
    });
    await expect(finalizeAttachment(d, input)).rejects.toThrow(
      /changed while it was being checked/,
    );
    expect(w.checks).toEqual([]);
    expect(w.files.has(PATH)).toBe(false);
  });

  it("refuses when the replacement lands between the download and the clean rewrite's id", async () => {
    const w = world({ [PATH]: jpeg({ gps: true }) });
    const d = deps(w);
    d.scan.mockImplementation(async () => {
      w.swap(jpeg({ pad: 9 }));
      return safe;
    });
    await expect(finalizeAttachment(d, input)).rejects.toThrow(/changed/);
    expect(w.checks).toEqual([]);
  });

  it("refuses a file it cannot identify", async () => {
    const w = world({});
    await expect(finalizeAttachment(deps(w), input)).rejects.toThrow(/could not be read/);
  });

  it("scans a large picture from a server-only scratch copy of the clean bytes, never from the sender's path", async () => {
    const w = world({ [PATH]: jpeg({ gps: true, pad: 4.5 * 1024 * 1024 }) });
    const d = deps(w);
    let scanned: Uint8Array | null = null;
    let scannedPath = "";
    d.scan.mockImplementation(async (url: string) => {
      scannedPath = url.replace("https://signed/", "");
      scanned = w.files.get(scannedPath)?.bytes ?? null;
      w.swap(enc.encode("%PDF-1.7 swapped during the scan")); // too late: the scanner is not reading PATH
      return safe;
    });
    await expect(finalizeAttachment(d, input)).rejects.toThrow(/changed/); // and the swap is still caught
    expect(scannedPath.startsWith(ATTACHMENT_SCAN_PREFIX)).toBe(true);
    expect(scanned).not.toBeNull();
    expect(hasText(scanned!, "GPS")).toBe(false);
    expect([...w.files.keys()].some((k) => k.startsWith(ATTACHMENT_SCAN_PREFIX))).toBe(false);
  });

  it("the scratch folder is not a path any sender can write or any participant can read", () => {
    // upload policy: second segment = uploader id; read policy: participant of the first-segment conversation (nil UUID).
    expect(parseAttachmentPath(`${ATTACHMENT_SCAN_PREFIX}x`)).toBeNull();
    expect(ATTACHMENT_SCAN_PREFIX.split("/")[1]).toBe("_scan");
    expect(ATTACHMENT_BUCKET).toBe("message-attachments");
  });

  it("a large clean scan that passes records the id", async () => {
    const w = world({ [PATH]: jpeg({ pad: 4.5 * 1024 * 1024 }) });
    const out = await finalizeAttachment(deps(w), input);
    expect(out.objectId).toBe(w.files.get(PATH)!.id);
  });

  it("fails closed when the scan cannot run", async () => {
    const w = world({ [PATH]: jpeg() });
    const d = deps(w);
    d.scan.mockResolvedValue({ ...safe, scanned: false });
    await expect(finalizeAttachment(d, input)).rejects.toThrow(/couldn't check/);
    expect(w.checks).toEqual([]);
  });

  it("still records the check on a database without the object_id column (app ships before the migration)", async () => {
    const w = world({ [PATH]: jpeg() });
    w.failChecks((row) =>
      "object_id" in row
        ? "Could not find the 'object_id' column of 'message_attachment_checks'"
        : null,
    );
    await finalizeAttachment(deps(w), input);
    expect(w.checks).toHaveLength(1);
    expect(w.checks[0]).not.toHaveProperty("object_id");
  });
});
