import { tryStripImageMetadata, type MetadataReport } from "@/lib/image-metadata";

/** The one Storage call this needs, so tests can pass a small fake and the admin client fits as it is. */
export type StorageWriter = {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: Uint8Array,
        options: { contentType: string; cacheControl: string; upsert: boolean },
      ): Promise<{ error: { message: string } | null }>;
    };
  };
};

export type StoredStripOutcome =
  | {
      ok: true;
      /** The bytes now in storage: the stripped ones when something was removed, else the ones read. */
      bytes: Uint8Array;
      /** True when the stored object was overwritten with the stripped bytes. */
      rewritten: boolean;
      report: MetadataReport;
    }
  | { ok: false; stage: "parse" | "write"; reason: string };

/**
 * Strip personal metadata from an image that is already in storage and write the clean bytes back over it, so the
 * scan, the moderation record, every later reader and every resized variant see only the clean file.
 *
 * Never throws. `ok: false` means the object may still hold the original, so the caller must remove it and refuse the
 * upload: a file we cannot parse, or cannot rewrite, is never left in place as if it had passed.
 *
 * The write-back names the content type and cache lifetime because Storage would otherwise store a raw byte body as
 * text/plain with its own default cache time.
 */
export async function stripStoredImage(
  admin: StorageWriter,
  opts: { bucket: string; path: string; bytes: Uint8Array; mime: string; cacheControl: string },
): Promise<StoredStripOutcome> {
  const result = tryStripImageMetadata(opts.bytes);
  if (!result.ok) return { ok: false, stage: "parse", reason: result.reason };
  if (!result.changed) {
    return { ok: true, bytes: opts.bytes, rewritten: false, report: result.report };
  }
  try {
    const { error } = await admin.storage.from(opts.bucket).upload(opts.path, result.bytes, {
      contentType: opts.mime,
      cacheControl: opts.cacheControl,
      upsert: true,
    });
    if (error) return { ok: false, stage: "write", reason: error.message };
  } catch (e) {
    return { ok: false, stage: "write", reason: e instanceof Error ? e.message : "write failed" };
  }
  return { ok: true, bytes: result.bytes, rewritten: true, report: result.report };
}

/** Booleans only, for the moderation record: never coordinates or tag values. */
export function metadataSummary(outcome: Extract<StoredStripOutcome, { ok: true }>) {
  return {
    stripped: outcome.rewritten,
    hadGps: outcome.report.hasGps,
    hadExif: outcome.report.hasExif,
    hadXmp: outcome.report.hasXmp,
    hadOther: outcome.report.hasOther,
  };
}
