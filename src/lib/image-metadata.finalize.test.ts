/**
 * G3 wiring: finalizeImageUpload and finalizeMessageAttachment strip the stored file before the scan and the record,
 * write the clean bytes back with the right type, and fail closed (object removed, no pass row) when the file cannot
 * be parsed or written back. Storage, the scan and the database are faked; a server function is its handler here.
 */
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { METADATA_IMAGE_REFUSAL } from "./image-upload-errors";
import { ATTACHMENT_METADATA_MESSAGE } from "./message-attachment-validation";

const enc = new TextEncoder();
const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);
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
const SECRET = "GPS 33.7488,-84.3877 PhoneCo";
const exifApp1 = () => {
  const payload = cat(enc.encode("Exif\0\0MM\0*\0\0\0\x08\0\0\0\0\0\0"), enc.encode(SECRET));
  return cat(
    Uint8Array.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255]),
    payload,
  );
};

const CONV = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  uploads: [] as {
    bucket: string;
    path: string;
    body: Uint8Array;
    options: Record<string, unknown>;
  }[],
  uploadError: null as { message: string } | null,
  checks: [] as Record<string, unknown>[],
  moderation: [] as Record<string, unknown>[],
  removed: [] as string[],
  scanned: [] as string[],
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
  scanImageForSafety: async (target: string) => {
    h.scanned.push(target);
    return { safe: true, csam: false, categories: [], label: "safe", reason: null, scanned: true };
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
              upsert: async (row: Record<string, unknown>) => {
                (table === "image_moderation" ? h.moderation : h.checks).push(row);
                return { error: null };
              },
            },
      storage: {
        from: (bucket: string) => ({
          download: async (path: string) => {
            const f = h.files.get(path);
            return f
              ? { data: new Blob([f as BlobPart]), error: null }
              : { data: null, error: { message: "not found" } };
          },
          upload: async (path: string, body: Uint8Array, options: Record<string, unknown>) => {
            h.uploads.push({ bucket, path, body, options });
            if (h.uploadError) return { data: null, error: h.uploadError };
            h.files.set(path, body);
            return { data: { path }, error: null };
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

const { finalizeImageUpload } = await import("./image-uploads.functions");
const { finalizeMessageAttachment } = await import("./message-attachments.functions");
type Ctx = { context: { userId: string } };
const finalizeImage = finalizeImageUpload as unknown as (
  arg: { data: { bucket: string; path: string } } & Ctx,
) => Promise<{ ok: true; bytes: number; quarantined: boolean }>;
const finalizeAttachment = finalizeMessageAttachment as unknown as (
  arg: { data: { path: string } } & Ctx,
) => Promise<{ ok: true; bytes: number; mime: string }>;

async function attempt<T>(fn: () => Promise<T>) {
  try {
    return { result: await fn() };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const base = () => sharp({ create: { width: 64, height: 64, channels: 3, background: "#336699" } });
const cleanJpeg = async () => u8(await base().jpeg().toBuffer());
const gpsJpeg = async () => {
  const j = await cleanJpeg();
  return cat(j.subarray(0, 2), exifApp1(), j.subarray(2));
};
const decodedScan = (target: string) =>
  latin1(Uint8Array.from(atob(target.split(",")[1]!), (c) => c.charCodeAt(0)));

beforeEach(() => {
  h.files.clear();
  h.uploads.length = 0;
  h.uploadError = null;
  h.checks.length = 0;
  h.moderation.length = 0;
  h.removed.length = 0;
  h.scanned.length = 0;
});

describe("finalizeImageUpload strips the stored image (G3)", () => {
  const path = `${USER}/gallery.jpg`;
  const run = (bucket: string) =>
    attempt(() => finalizeImage({ data: { bucket, path }, context: { userId: USER } }));

  it("writes the clean bytes back over the object, then scans and records only those", async () => {
    const clean = await cleanJpeg();
    h.files.set(path, await gpsJpeg());
    const r = await run("org-covers");
    expect(r.error).toBeUndefined();
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0]).toMatchObject({
      bucket: "org-covers",
      path,
      options: { contentType: "image/jpeg", cacheControl: "31536000", upsert: true },
    });
    expect(h.files.get(path)).toEqual(clean);
    expect(latin1(h.files.get(path)!)).not.toContain("GPS");
    expect(h.scanned).toHaveLength(1);
    expect(decodedScan(h.scanned[0]!)).not.toContain("GPS");
    expect(h.moderation).toHaveLength(1);
    expect(h.moderation[0]).toMatchObject({ status: "pending", bytes: clean.length });
    expect((h.moderation[0]!.scan as { metadata: unknown }).metadata).toEqual({
      stripped: true,
      hadGps: false,
      hadExif: true,
      hadXmp: false,
      hadOther: false,
    });
    expect(r.result?.bytes).toBe(clean.length);
    expect(h.removed).toEqual([]);
  });

  it("asks for the short cache lifetime on the private game-cover bucket", async () => {
    h.files.set(path, await gpsJpeg());
    await run("game-covers");
    expect(h.uploads[0]!.options).toMatchObject({
      cacheControl: "3600",
      contentType: "image/jpeg",
    });
  });

  it("writes nothing back for a file with nothing to remove", async () => {
    h.files.set(path, await cleanJpeg());
    const r = await run("avatars");
    expect(r.error).toBeUndefined();
    expect(h.uploads).toEqual([]);
    expect(h.scanned).toHaveLength(1);
  });

  it("removes and refuses a file it cannot parse, before any scan, with a removed record", async () => {
    const tagged = await gpsJpeg();
    h.files.set(path, tagged.subarray(0, tagged.length - 2)); // no end-of-image marker
    const r = await run("avatars");
    expect(r.error).toBe(METADATA_IMAGE_REFUSAL);
    expect(h.removed).toEqual([path]);
    expect(h.files.has(path)).toBe(false);
    expect(h.uploads).toEqual([]);
    expect(h.scanned).toEqual([]);
    expect(h.moderation).toHaveLength(1);
    expect(h.moderation[0]).toMatchObject({ status: "removed", reason: METADATA_IMAGE_REFUSAL });
  });

  it("removes and refuses when the clean copy cannot be written back, leaving no pass record", async () => {
    h.files.set(path, await gpsJpeg());
    h.uploadError = { message: "storage down" };
    const r = await run("avatars");
    expect(r.error).toBe(METADATA_IMAGE_REFUSAL);
    expect(h.removed).toEqual([path]);
    expect(h.scanned).toEqual([]);
    expect(h.moderation.map((m) => m.status)).toEqual(["removed"]);
  });
});

describe("finalizeMessageAttachment strips a chat picture (G3)", () => {
  const path = `${CONV}/${USER}/photo.jpg`;
  const run = () =>
    attempt(() => finalizeAttachment({ data: { path }, context: { userId: USER } }));

  it("cleans a small photo the browser sent as it was, and records the clean size", async () => {
    const clean = await cleanJpeg();
    h.files.set(path, await gpsJpeg());
    const r = await run();
    expect(r.error).toBeUndefined();
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0]).toMatchObject({
      bucket: "message-attachments",
      options: { contentType: "image/jpeg", cacheControl: "3600", upsert: true },
    });
    expect(h.files.get(path)).toEqual(clean);
    expect(decodedScan(h.scanned[0]!)).not.toContain("GPS");
    expect(h.checks).toHaveLength(1);
    expect(h.checks[0]).toMatchObject({ bytes: clean.length, kind: "image" });
    expect(r.result?.bytes).toBe(clean.length);
  });

  it("deletes a picture it cannot clean and writes no check row, so the message cannot carry it", async () => {
    const tagged = await gpsJpeg();
    h.files.set(path, tagged.subarray(0, tagged.length - 2));
    const r = await run();
    expect(r.error).toBe(ATTACHMENT_METADATA_MESSAGE);
    expect(h.removed).toEqual([path]);
    expect(h.checks).toEqual([]);
    expect(h.scanned).toEqual([]);
  });

  it("deletes the picture when the clean copy cannot be written back", async () => {
    h.files.set(path, await gpsJpeg());
    h.uploadError = { message: "storage down" };
    const r = await run();
    expect(r.error).toBe(ATTACHMENT_METADATA_MESSAGE);
    expect(h.removed).toEqual([path]);
    expect(h.checks).toEqual([]);
  });

  it("leaves a PDF as it was sent (only pictures are stripped)", async () => {
    const pdfPath = `${CONV}/${USER}/doc.pdf`;
    h.files.set(pdfPath, enc.encode("%PDF-1.4\n/Author (Someone)\n%%EOF"));
    const r = await attempt(() =>
      finalizeAttachment({ data: { path: pdfPath }, context: { userId: USER } }),
    );
    expect(r.error).toBeUndefined();
    expect(h.uploads).toEqual([]);
  });
});
