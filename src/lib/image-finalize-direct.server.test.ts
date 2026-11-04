/* eslint-disable @typescript-eslint/no-explicit-any -- the storage/database client is faked structurally */
import { createHash, randomBytes } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  FLAGGED_REFUSAL,
  PROCESSING_BUSY,
  SCAN_UNAVAILABLE_REFUSAL,
  finalizeDirectImageUpload,
} from "./image-finalize-direct.server";
import { IMAGE_QUARANTINE_BUCKET } from "./image-quarantine.server";
import { ImageReencodeError, reencodeImage } from "./image-reencode.server";

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
const hasGps = (b: Uint8Array) => new TextDecoder("latin1").decode(b).includes("GPS");
const contains = (hay: Uint8Array, needle: Uint8Array) =>
  Buffer.from(hay.buffer, hay.byteOffset, hay.byteLength).indexOf(Buffer.from(needle)) >= 0;

const USER = "11111111-1111-1111-1111-111111111111";
const PATH = `${USER}/avatar.jpg`;
const KEY = `avatars|${PATH}`;

function world(
  initial: Record<string, Uint8Array>,
  moderation: Record<string, any> = {},
  opts: { failUploadsTo?: string[]; userOwned?: string[] } = {},
) {
  const files = new Map<string, Uint8Array>(Object.entries(initial));
  // Rows the uploader wrote (Storage stamps them with the uploader as owner). Real Storage's upsert keeps that owner, so the
  // published-path trigger refuses the server's upsert over them (supabase/tests/520, finding 3); a plain insert never
  // overwrites an existing row.
  const userOwned = new Set<string>(opts.userOwned ?? []);
  const uploadOpts: any[] = [];
  const rows = new Map<string, any>(Object.entries(moderation));
  const upserts: any[] = [];
  const items: any[] = [];
  const log: string[] = [];
  // The database clock, for the claim's 10-minute expiry (supabase/migrations/20261108150000).
  const clock = { now: Date.now() };
  const admin = {
    // claim_image_processing / finish_image_processing, with the migration's semantics (each call is atomic, as in Postgres).
    rpc: async (fn: string, a: any) => {
      const key = `${a._bucket}|${a._path}`;
      const row = rows.get(key);
      if (fn === "claim_image_processing") {
        const stale =
          row?.status === "processing" &&
          (!row.claimed_at || clock.now - row.claimed_at > 10 * 60_000);
        if (!row || !["processing", "quarantined", "removed"].includes(row.status) || stale) {
          const token = crypto.randomUUID();
          rows.set(key, {
            ...(row ?? { bucket: a._bucket, path: a._path, owner_id: a._owner_id }),
            status: "processing",
            claim_token: token,
            claimed_at: clock.now,
          });
          log.push("moderation processing");
          return { data: [{ claim_token: token, status: "processing" }], error: null };
        }
        return { data: [{ claim_token: null, status: row.status }], error: null };
      }
      if (fn === "finish_image_processing") {
        if (!row || row.status !== "processing" || row.claim_token !== a._claim_token)
          return { data: false, error: null };
        if (a._status === "released") rows.delete(key);
        else
          rows.set(key, {
            ...row,
            ...a._fields,
            status: a._status,
            claim_token: null,
            claimed_at: null,
          });
        log.push(`moderation ${a._status}`);
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
        upload: async (path: string, bytes: Uint8Array, o: any = {}) => {
          const key = `${bucket}|${path}`;
          uploadOpts.push({ bucket, path, ...o });
          if (opts.failUploadsTo?.includes(bucket)) {
            log.push(`upload ${bucket} failed`);
            return { data: null, error: { message: `${bucket} down` } };
          }
          if (files.has(key) && !o.upsert) return { data: null, error: { message: "Duplicate" } };
          if (files.has(key) && userOwned.has(key) && rows.has(key))
            return { data: null, error: { message: "PUBLISHED_IMAGE_FINAL" } };
          files.set(key, bytes);
          log.push(`upload ${bucket}`);
          return { data: { id: "obj" }, error: null };
        },
        remove: async (paths: string[]) => {
          for (const p of paths) {
            files.delete(`${bucket}|${p}`);
            userOwned.delete(`${bucket}|${p}`);
          }
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
  return { files, rows, upserts, items, log, admin, uploadOpts, clock };
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
    // finding 3: the uploader's object is removed and the re-encode inserted fresh (no upsert), so the row has no end-user owner
    expect(w.log.slice(0, 3)).toEqual([
      "moderation processing",
      "remove avatars",
      "upload avatars",
    ]);
    expect(w.uploadOpts.find((o) => o.bucket === "avatars")).toMatchObject({ upsert: false });
    // R5 39ae9545 finding 1: the claim is atomic (an RPC), and the outcome is written through it, never by a blind upsert
    expect(w.upserts).toEqual([]);
    expect(w.rows.get(KEY)).toMatchObject({ status: "pending", claim_token: null });
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

  it("finding 3: rewrites an object the uploader owns (an upsert over it would be refused by the published-path trigger)", async () => {
    const w = world({ [KEY]: jpeg({ gps: true }) }, {}, { userOwned: [KEY] });
    const out = await finalizeDirectImageUpload(deps(w), input);
    expect(out).toMatchObject({ quarantined: false, published: true });
    expect(hasGps(w.files.get(KEY)!)).toBe(false);
  });

  it("finding 2: a flagged image whose quarantine copy fails is held privately, never left public, and not escalated at a public path", async () => {
    const w = world(
      { [KEY]: jpeg({ gps: true }) },
      {},
      { failUploadsTo: [IMAGE_QUARANTINE_BUCKET] },
    );
    const d = deps(w, { ...safe, safe: false, csam: true, categories: ["csam"] });
    const out = await finalizeDirectImageUpload(d, input);
    expect(out).toMatchObject({ ok: true, quarantined: true, published: false });
    expect(w.files.has(KEY)).toBe(false); // the public path is gone
    expect(w.items).toEqual([]);
    const heldKey = [...w.files.keys()].find((k) => k.startsWith("image-staging|_held/"))!;
    expect(heldKey).toMatch(/^image-staging\|_held\/legacy_direct_upload\/[0-9a-f-]{36}\.jpg$/);
    expect(w.files.get(heldKey)).toEqual(jpeg({ gps: true })); // the original, as evidence
    const heldPath = heldKey.slice("image-staging|".length);
    // recorded for a retry into the quarantine
    expect(w.rows.get(heldKey)).toMatchObject({
      status: "quarantined",
      scan: {
        stage: "held_fallback",
        held_from: { bucket: "avatars", path: PATH },
        quarantine: { failed: true, retry: true },
      },
    });
    expect(w.rows.get(KEY).scan.quarantine).toMatchObject({
      failed: true,
      held: { bucket: "image-staging", path: heldPath },
    });
    expect(d.escalate).toHaveBeenCalledTimes(1);
    expect(d.escalate).toHaveBeenCalledWith("image-staging", heldPath, ["csam"]);
    // off the public bucket before the escalation
    expect(w.log.indexOf("remove avatars", 2)).toBeLessThan(w.log.indexOf("escalate"));
  });

  it("finding 2: when the private fallback fails too, the public object is still removed and only the hash is escalated", async () => {
    const w = world(
      { [KEY]: jpeg() },
      {},
      { failUploadsTo: [IMAGE_QUARANTINE_BUCKET, "image-staging"] },
    );
    const d = deps(w, { ...safe, safe: false, csam: true, categories: ["csam"] });
    const out = await finalizeDirectImageUpload(d, input);
    expect(out).toMatchObject({ quarantined: true, published: false });
    expect(w.files.has(KEY)).toBe(false);
    const sha = createHash("sha256").update(jpeg()).digest("hex");
    expect(w.rows.get(KEY).scan.quarantine).toEqual({
      failed: true,
      unpreserved: true,
      sha256: sha,
    });
    expect(d.escalate).toHaveBeenCalledWith("unpreserved", `sha256:${sha}`, ["csam"]);
    for (const call of d.escalate.mock.calls as unknown as [string, string][])
      expect(call[0]).not.toBe("avatars");
  });

  it("finding 1 / R5 finding 2: a flag on any scan rendition quarantines the image; a failed scan of one fails closed", async () => {
    const result = (bytes: Uint8Array) => ({
      bytes,
      mime: "image/jpeg" as const,
      width: 100,
      height: 80,
      hasAlpha: true,
      orientation: null,
      convertedFromIcc: false,
      lossless: false,
      inputReport: { hasExif: false, hasGps: false, hasXmp: false, hasOther: false } as any,
      // flattened on white, flattened on black (R5 39ae9545 finding 2): the second one carries the picture
      scanRenditions: ["data:image/jpeg;base64,WWWW", "data:image/jpeg;base64,AAAA"],
    });
    const w = world({ [KEY]: jpeg() });
    const d = deps(w);
    d.reencode = async (b: Uint8Array) => result(b);
    d.scan.mockImplementation(async (t: string) =>
      t === "data:image/jpeg;base64,AAAA"
        ? { ...safe, safe: false, csam: true, categories: ["csam"] }
        : safe,
    );
    const out = await finalizeDirectImageUpload(d, input);
    expect(d.scan).toHaveBeenCalledTimes(3);
    expect(out).toMatchObject({ quarantined: true, published: false });
    expect(w.files.has(KEY)).toBe(false);

    const w2 = world({ [KEY]: jpeg() });
    const d2 = deps(w2);
    d2.reencode = async (b: Uint8Array) => result(b);
    d2.scan.mockImplementation(async (t: string) => {
      if (t.endsWith("AAAA")) throw new Error("gateway down");
      return safe;
    });
    await expect(finalizeDirectImageUpload(d2, input)).rejects.toThrow(SCAN_UNAVAILABLE_REFUSAL);
    expect(w2.files.has(KEY)).toBe(false);
  });

  describe("concurrent calls on one path (R5 independent review 39ae9545, finding 1)", () => {
    const flagged = { ...safe, safe: false, csam: true, categories: ["csam"] };
    const gate = () => {
      let open!: () => void;
      const p = new Promise<void>((r) => (open = r));
      return { p, open };
    };

    it("a flag recorded while another call is still scanning wins: the object is not re-published and the row stays quarantined", async () => {
      const w = world({ [KEY]: jpeg({ gps: true }) });
      const reached = gate();
      const release = gate();
      const b = deps(w);
      b.scan.mockImplementation(async () => {
        reached.open();
        await release.p;
        return safe;
      });
      const callB = finalizeDirectImageUpload(b, input);
      await reached.p; // B has rewritten the object and is inside its scan
      // B hangs past the claim's 10-minute expiry (a stalled worker), so A can take the path over and finish first
      w.clock.now += 11 * 60_000;
      const a = deps(w, flagged);
      const outA = await finalizeDirectImageUpload(a, input);
      expect(outA).toMatchObject({ quarantined: true, published: false });
      expect(w.files.has(KEY)).toBe(false);
      release.open();
      await expect(callB).rejects.toThrow(FLAGGED_REFUSAL);
      expect(w.files.has(KEY)).toBe(false);
      expect(w.rows.get(KEY).status).toBe("quarantined");
    });

    it("a call that re-encodes slowly does not put a flagged object back", async () => {
      const w = world({ [KEY]: jpeg() });
      const reached = gate();
      const release = gate();
      const b = deps(w);
      b.reencode = async (bytes: Uint8Array) => {
        reached.open();
        await release.p;
        return reencodeImage(bytes);
      };
      const callB = finalizeDirectImageUpload(b, input);
      await reached.p; // B downloaded the original and is held in its re-encode
      w.clock.now += 11 * 60_000;
      const a = deps(w, flagged);
      await finalizeDirectImageUpload(a, input);
      release.open();
      await expect(callB).rejects.toThrow(FLAGGED_REFUSAL);
      expect(b.scan).not.toHaveBeenCalled();
      expect(w.files.has(KEY)).toBe(false);
      expect(w.rows.get(KEY).status).toBe("quarantined");
    });

    it("a second call while the first is processing is refused before it reads anything", async () => {
      const w = world({ [KEY]: jpeg() });
      const reached = gate();
      const release = gate();
      const b = deps(w);
      b.scan.mockImplementation(async () => {
        reached.open();
        await release.p;
        return safe;
      });
      const callB = finalizeDirectImageUpload(b, input);
      await reached.p;
      const a = deps(w, flagged);
      await expect(finalizeDirectImageUpload(a, input)).rejects.toThrow(PROCESSING_BUSY);
      expect(a.scan).not.toHaveBeenCalled();
      release.open();
      await expect(callB).resolves.toMatchObject({ published: true });
      expect(w.rows.get(KEY).status).toBe("pending");
    });
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
