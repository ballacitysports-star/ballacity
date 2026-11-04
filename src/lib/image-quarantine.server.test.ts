/* eslint-disable @typescript-eslint/no-explicit-any -- the storage/database client is faked structurally */
import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  IMAGE_QUARANTINE_BUCKET,
  mintQuarantineReviewUrl,
  quarantineOriginal,
  sweepExpiredQuarantine,
} from "./image-quarantine.server";
import { listStagedImagesForExport, purgeStagedImagesForUser } from "./image-promotion.server";
import { ATTACHMENT_BUCKET, finalizeAttachment } from "./message-attachment-finalize.server";
import { IMAGE_STAGING_BUCKET } from "./image-staging";

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
const BASE = u8(
  await sharp({ create: { width: 90, height: 70, channels: 3, background: "#448844" } })
    .jpeg()
    .toBuffer(),
);
const GPS_TEXT = enc.encode("Exif\0\0GPS 33.7488,-84.3877");
const GPS = cat(Uint8Array.from([0xff, 0xe1, 0, GPS_TEXT.length + 2]), GPS_TEXT);
const photo = () => cat(BASE.subarray(0, 2), GPS, BASE.subarray(2));

/** Storage + tables, bucket-aware, with object ids/versions for message attachments. */
function world(initial: Record<string, Uint8Array> = {}, opts: { failUploadTo?: string } = {}) {
  let seq = 0;
  const files = new Map<string, { bytes: Uint8Array; id: string; version: string }>();
  for (const [k, b] of Object.entries(initial))
    files.set(k, { bytes: b, id: `o${++seq}`, version: `v${++seq}` });
  const items: any[] = [];
  const checks: any[] = [];
  const log: string[] = [];
  const bucket = (name: string) => ({
    info: async (p: string) => {
      const f = files.get(`${name}|${p}`);
      return f
        ? { data: { id: f.id, version: f.version }, error: null }
        : { data: null, error: { message: "not found" } };
    },
    download: async (p: string) => {
      const f = files.get(`${name}|${p}`);
      return f
        ? { data: new Blob([f.bytes as BlobPart]), error: null }
        : { data: null, error: { message: "not found" } };
    },
    upload: async (p: string, bytes: Uint8Array, o?: { upsert?: boolean }) => {
      if (opts.failUploadTo === name) return { data: null, error: { message: "down" } };
      const prior = files.get(`${name}|${p}`);
      if (prior && !o?.upsert) return { data: null, error: { message: "exists" } };
      const id = prior?.id ?? `o${++seq}`;
      files.set(`${name}|${p}`, { bytes, id, version: `v${++seq}` });
      log.push(`upload ${name}`);
      return { data: { id }, error: null };
    },
    remove: async (paths: string[]) => {
      for (const p of paths) files.delete(`${name}|${p}`);
      log.push(`remove ${name}`);
      return { error: null };
    },
    createSignedUrl: async (p: string, ttl: number) => ({
      data: { signedUrl: `https://signed/${name}/${p}?ttl=${ttl}` },
      error: null,
    }),
  });
  const admin = {
    storage: { from: (name: string) => bucket(name) },
    from: (table: string) => ({
      insert: (row: any) => ({
        select: () => ({
          single: async () => {
            items.push({ id: `item-${items.length + 1}`, table, ...row });
            log.push(`insert ${table}`);
            return { data: { id: `item-${items.length}` }, error: null };
          },
        }),
      }),
      upsert: async (row: any) => {
        checks.push(row);
        return { error: null };
      },
    }),
  };
  return { files, items, checks, log, admin };
}

describe("quarantineOriginal", () => {
  it("copies the original byte for byte into the private quarantine and records its hash", async () => {
    const w = world();
    const bytes = photo();
    const ref = await quarantineOriginal(w.admin, {
      source: "image_upload",
      sourceBucket: IMAGE_STAGING_BUCKET,
      sourcePath: "u/x.jpg",
      uploaderId: "u",
      bytes,
      mime: "image/jpeg",
      categories: ["csam"],
      suspectedCsam: true,
      reason: "flagged",
    });
    expect(ref.bucket).toBe(IMAGE_QUARANTINE_BUCKET);
    expect(ref.path).toMatch(/^image_upload\/[0-9a-f-]{36}\.jpg$/);
    expect(w.files.get(`${IMAGE_QUARANTINE_BUCKET}|${ref.path}`)!.bytes).toEqual(bytes);
    expect(w.items[0]).toMatchObject({
      table: "image_quarantine_items",
      object_path: ref.path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.byteLength,
      suspected_csam: true,
    });
  });

  it("throws (so the caller keeps the source) when the copy fails", async () => {
    const w = world({}, { failUploadTo: IMAGE_QUARANTINE_BUCKET });
    await expect(
      quarantineOriginal(w.admin, {
        source: "image_upload",
        sourceBucket: "s",
        sourcePath: "p",
        uploaderId: null,
        bytes: photo(),
        mime: "image/jpeg",
        categories: [],
        suspectedCsam: false,
        reason: null,
      }),
    ).rejects.toThrow(/copy failed/);
    expect(w.items).toEqual([]);
  });

  it("throws when the record cannot be written", async () => {
    const w = world();
    const admin = {
      ...w.admin,
      from: () => ({
        insert: () => ({
          select: () => ({ single: async () => ({ data: null, error: { message: "rls" } }) }),
        }),
      }),
    };
    await expect(
      quarantineOriginal(admin, {
        source: "image_upload",
        sourceBucket: "s",
        sourcePath: "p",
        uploaderId: null,
        bytes: photo(),
        mime: "image/jpeg",
        categories: [],
        suspectedCsam: false,
        reason: null,
      }),
    ).rejects.toThrow(/record failed/);
  });
});

describe("finalizeAttachment: M4, a flagged chat picture is preserved before it is removed", () => {
  const CONV = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const USER = "11111111-1111-4111-8111-111111111111";
  const PATH = `${CONV}/${USER}/photo.jpg`;
  const KEY = `${ATTACHMENT_BUCKET}|${PATH}`;
  const flagged = { safe: false, csam: true, categories: ["csam"], scanned: true };
  const deps = (w: ReturnType<typeof world>, verdict: any) => ({
    admin: w.admin,
    scan: vi.fn().mockResolvedValue(verdict),
    escalate: vi.fn(async () => {
      w.log.push("escalate");
    }),
  });

  it("moves the original (as uploaded) to the quarantine, escalates with that reference, and only then removes it", async () => {
    const original = photo();
    const w = world({ [KEY]: original });
    const d = deps(w, flagged);
    await expect(
      finalizeAttachment(d, { userId: USER, conversationId: CONV, path: PATH }),
    ).rejects.toThrow(/^That picture can't be sent\.$/);
    const item = w.items.find((i) => i.table === "image_quarantine_items");
    expect(item).toMatchObject({
      source: "message_attachment",
      source_bucket: ATTACHMENT_BUCKET,
      source_path: PATH,
      uploader_id: USER,
      conversation_id: CONV,
      suspected_csam: true,
    });
    // the original bytes, GPS included (evidence), not the cleaned rewrite
    expect(w.files.get(`${IMAGE_QUARANTINE_BUCKET}|${item.object_path}`)!.bytes).toEqual(original);
    expect(d.escalate).toHaveBeenCalledWith(IMAGE_QUARANTINE_BUCKET, item.object_path, ["csam"]);
    expect(w.files.has(KEY)).toBe(false);
    const order = w.log.filter((l) => !l.startsWith(`upload ${ATTACHMENT_BUCKET}`));
    expect(order).toEqual([
      `upload ${IMAGE_QUARANTINE_BUCKET}`,
      "insert image_quarantine_items",
      "escalate",
      `remove ${ATTACHMENT_BUCKET}`,
    ]);
    expect(w.checks).toEqual([]); // no check row: it can never be sent
  });

  it("does NOT delete the file when the quarantine copy fails; it escalates from where the file is", async () => {
    const w = world({ [KEY]: photo() }, { failUploadTo: IMAGE_QUARANTINE_BUCKET });
    const d = deps(w, flagged);
    await expect(
      finalizeAttachment(d, { userId: USER, conversationId: CONV, path: PATH }),
    ).rejects.toThrow(/^That picture can't be sent\.$/);
    expect(w.files.has(KEY)).toBe(true);
    expect(d.escalate).toHaveBeenCalledWith(ATTACHMENT_BUCKET, PATH, ["csam"]);
    expect(w.checks).toEqual([]);
  });

  it("quarantines a non-child-safety flag too, without escalating", async () => {
    const w = world({ [KEY]: photo() });
    const d = deps(w, { safe: false, csam: false, categories: ["violence"], scanned: true });
    await expect(
      finalizeAttachment(d, { userId: USER, conversationId: CONV, path: PATH }),
    ).rejects.toThrow(/^That picture can't be sent\.$/);
    expect(w.items[0]).toMatchObject({ suspected_csam: false, categories: ["violence"] });
    expect(d.escalate).not.toHaveBeenCalled();
    expect(w.files.has(KEY)).toBe(false);
  });
});

describe("mintQuarantineReviewUrl", () => {
  const setup = (opts: { requestError?: string; consumeError?: string } = {}) => {
    const user = {
      rpc: vi.fn(async () =>
        opts.requestError
          ? { data: null, error: { message: opts.requestError } }
          : { data: "grant-1", error: null },
      ),
    };
    const signed: any[] = [];
    const admin = {
      rpc: vi.fn(async () =>
        opts.consumeError
          ? { data: null, error: { message: opts.consumeError } }
          : { data: [{ object_path: "image_upload/q.jpg", url_ttl_seconds: 60 }], error: null },
      ),
      storage: {
        from: (b: string) => ({
          createSignedUrl: async (p: string, ttl: number) => {
            signed.push([b, p, ttl]);
            return { data: { signedUrl: `https://signed/${b}/${p}` }, error: null };
          },
        }),
      },
    };
    return { user, admin, signed };
  };

  it("asks the definer RPC as the reviewer (audited), exchanges the single-use grant, and signs a 60-second URL", async () => {
    const { user, admin, signed } = setup();
    const out = await mintQuarantineReviewUrl(user, admin, {
      itemId: "item-1",
      reason: "confirming before reporting",
    });
    expect(user.rpc).toHaveBeenCalledWith("request_quarantine_review", {
      _item_id: "item-1",
      _reason: "confirming before reporting",
    });
    expect(admin.rpc).toHaveBeenCalledWith("consume_quarantine_review", { _grant_id: "grant-1" });
    expect(signed).toEqual([[IMAGE_QUARANTINE_BUCKET, "image_upload/q.jpg", 60]]);
    expect(out).toEqual({
      url: `https://signed/${IMAGE_QUARANTINE_BUCKET}/image_upload/q.jpg`,
      expiresInSeconds: 60,
    });
  });

  it("mints nothing when the reviewer is refused", async () => {
    const { user, admin, signed } = setup({ requestError: "QUARANTINE_FORBIDDEN" });
    await expect(
      mintQuarantineReviewUrl(user, admin, { itemId: "i", reason: "r" }),
    ).rejects.toThrow(/FORBIDDEN/);
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(signed).toEqual([]);
  });

  it("mints nothing for a used or expired grant", async () => {
    const { user, admin, signed } = setup({ consumeError: "QUARANTINE_GRANT_INVALID" });
    await expect(
      mintQuarantineReviewUrl(user, admin, { itemId: "i", reason: "r" }),
    ).rejects.toThrow(/GRANT_INVALID/);
    expect(signed).toEqual([]);
  });
});

describe("sweepExpiredQuarantine", () => {
  const setup = (due: { id: string; object_path: string }[], failRemove = false) => {
    const removed: string[] = [];
    const updated: any[] = [];
    const filters: any[] = [];
    const admin = {
      from: () => ({
        select: () => {
          const q: any = {
            eq: (...a: any[]) => (filters.push(["eq", ...a]), q),
            neq: (...a: any[]) => (filters.push(["neq", ...a]), q),
            lte: (...a: any[]) => (filters.push(["lte", a[0]]), q),
            limit: async () => ({ data: due, error: null }),
          };
          return q;
        },
        update: (row: any) => ({
          eq: async (_c: string, id: string) => {
            updated.push([id, row.status]);
            return { error: null };
          },
        }),
      }),
      storage: {
        from: () => ({
          remove: async (p: string[]) => {
            if (failRemove) return { error: { message: "QUARANTINE_HOLD" } };
            removed.push(...p);
            return { error: null };
          },
        }),
      },
    };
    return { admin, removed, updated, filters };
  };

  it("selects only items past retention with no hold, and a dry run (the default) changes nothing", async () => {
    const { admin, removed, filters } = setup([{ id: "a", object_path: "x.jpg" }]);
    const r = await sweepExpiredQuarantine(admin);
    expect(r).toEqual({ due: 1, destroyed: 0, failed: 0 });
    expect(removed).toEqual([]);
    expect(filters).toEqual([
      ["eq", "legal_hold", false],
      ["neq", "status", "destroyed"],
      ["lte", "retain_until"],
    ]);
  });

  it("destroys and records each due item", async () => {
    const { admin, removed, updated } = setup([{ id: "a", object_path: "x.jpg" }]);
    const r = await sweepExpiredQuarantine(admin, { dryRun: false });
    expect(r).toEqual({ due: 1, destroyed: 1, failed: 0 });
    expect(removed).toEqual(["x.jpg"]);
    expect(updated).toEqual([["a", "destroyed"]]);
  });

  it("records nothing when the database refuses the delete (hold)", async () => {
    const { admin, updated } = setup([{ id: "a", object_path: "x.jpg" }], true);
    const r = await sweepExpiredQuarantine(admin, { dryRun: false });
    expect(r).toEqual({ due: 1, destroyed: 0, failed: 1 });
    expect(updated).toEqual([]);
  });
});

describe("staging in account purge and data export (L1)", () => {
  const U = "11111111-1111-4111-8111-111111111111";
  const setup = (names: string[], quarantined: string[], opts: { listError?: boolean } = {}) => {
    const removed: string[] = [];
    const deletedRows: string[] = [];
    const listCalls: any[] = [];
    const admin = {
      storage: {
        from: (b: string) => ({
          list: async (prefix: string, o: { limit: number; offset: number }) => {
            listCalls.push([b, prefix, o.offset]);
            if (opts.listError) return { data: null, error: { message: "timeout" } };
            const rows = names.map((n) => ({
              name: n,
              id: `id-${n}`,
              created_at: "2026-11-01T00:00:00Z",
              metadata: { size: 10 },
            }));
            return { data: rows.slice(o.offset, o.offset + o.limit), error: null };
          },
          remove: async (p: string[]) => {
            expect(b).toBe(IMAGE_STAGING_BUCKET);
            removed.push(...p);
            return { error: null };
          },
        }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            in: async (_c: string, paths: string[]) => ({
              data: paths
                .filter((p) => quarantined.includes(p))
                .map((path) => ({ path, status: "quarantined" })),
              error: null,
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
    return { admin, removed, deletedRows, listCalls };
  };

  it("purge removes the user's staged files and their moderation rows, but keeps a quarantined original (legal hold)", async () => {
    const { admin, removed, deletedRows, listCalls } = setup(
      ["a.jpg", "b.png", "c.webp"],
      [`${U}/b.png`],
    );
    const r = await purgeStagedImagesForUser(admin, U);
    expect(listCalls[0]).toEqual([IMAGE_STAGING_BUCKET, U, 0]);
    expect(removed).toEqual([`${U}/a.jpg`, `${U}/c.webp`]);
    expect(deletedRows).toEqual(removed);
    expect(r).toEqual({ removed: 2, keptUnderHold: 1 });
  });

  it("purge fails loudly (the account is not deleted) when staging cannot be listed", async () => {
    const { admin } = setup([], [], { listError: true });
    await expect(purgeStagedImagesForUser(admin, U)).rejects.toThrow(/timeout/);
  });

  it("export lists the user's staged files as metadata and leaves out held originals", async () => {
    const { admin } = setup(["a.jpg", "b.png"], [`${U}/b.png`]);
    expect(await listStagedImagesForExport(admin, U)).toEqual([
      { name: "a.jpg", bytes: 10, uploaded_at: "2026-11-01T00:00:00Z" },
    ]);
  });
});
