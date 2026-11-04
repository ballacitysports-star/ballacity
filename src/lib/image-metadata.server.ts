import type { SupabaseClient } from "@supabase/supabase-js";
import { stripImageMetadata, type MetadataReport } from "@/lib/image-metadata";

export type StoredStripOutcome = {
  /** The bytes now in storage (the stripped ones when something was removed). */
  bytes: Uint8Array;
  /** True when the stored object was rewritten. */
  rewritten: boolean;
  report: MetadataReport;
  /** The storage object id Storage returned for the rewrite (null when nothing was rewritten or Storage did not say). */
  objectId: string | null;
};

/**
 * Strip personal metadata from an image that is already in storage and write the clean bytes back over it (same path,
 * same content type), so no later reader, thumbnail or derivative is made from the original. Throws when the file cannot
 * be processed or the rewrite fails: the caller must then remove the object and refuse the upload (fail closed), never
 * publish the original.
 */
export async function stripStoredImage(
  admin: SupabaseClient<any, any, any>,
  bucket: string,
  path: string,
  current: Uint8Array,
  mime: string,
): Promise<StoredStripOutcome> {
  const result = stripImageMetadata(current);
  if (!result.changed)
    return { bytes: current, rewritten: false, report: result.report, objectId: null };
  const { data, error } = await admin.storage.from(bucket).upload(path, result.bytes, {
    contentType: mime,
    upsert: true,
    cacheControl: "3600",
  });
  if (error) throw new Error(`Could not rewrite the stored image: ${error.message}`);
  return {
    bytes: result.bytes,
    rewritten: true,
    report: result.report,
    objectId: (data as { id?: string } | null)?.id ?? null,
  };
}

export type ScanCounts = {
  scanned: number;
  unreadable: number;
  withGps: number;
  withExif: number;
  withXmp: number;
  withOther: number;
  perBucket: Record<string, { scanned: number; withGps: number; withAnyMetadata: number }>;
};

export function emptyScanCounts(): ScanCounts {
  return {
    scanned: 0,
    unreadable: 0,
    withGps: 0,
    withExif: 0,
    withXmp: 0,
    withOther: 0,
    perBucket: {},
  };
}

/** Add one inspected object (or an unreadable one: report === null) to the totals. Counts only; never coordinates. */
export function addToScanCounts(
  c: ScanCounts,
  bucket: string,
  report: MetadataReport | null,
): boolean {
  c.perBucket[bucket] ??= { scanned: 0, withGps: 0, withAnyMetadata: 0 };
  const b = c.perBucket[bucket];
  c.scanned++;
  b.scanned++;
  if (!report) {
    c.unreadable++;
    return false;
  }
  if (report.hasGps) (c.withGps++, b.withGps++);
  if (report.hasExif) c.withExif++;
  if (report.hasXmp) c.withXmp++;
  if (report.hasOther) c.withOther++;
  const any = report.hasGps || report.hasExif || report.hasXmp || report.hasOther;
  if (any) b.withAnyMetadata++;
  return any;
}
