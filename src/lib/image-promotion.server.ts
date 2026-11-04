/* eslint-disable @typescript-eslint/no-explicit-any -- the storage/database client is faked structurally */
import { IMAGE_BUCKET_KEYS } from "@/lib/image-moderation";
import {
  isGenuinelyHeldStagingRow,
  isHeldFallbackPath,
  quarantineOriginal,
  type QuarantineRef,
} from "@/lib/image-quarantine.server";
import {
  ImageReencodeError,
  REENCODE_MESSAGES,
  reencodeImage,
  type ReencodeResult,
} from "@/lib/image-reencode.server";
import { IMAGE_STAGING_BUCKET, extForImageMime, isOwnFilePath } from "@/lib/image-staging";
import { readImageDimensions, sniffImageMime, validateImageMeta } from "@/lib/image-validation";

export type ScanVerdict = {
  safe: boolean;
  label: string;
  reason: string | null;
  categories: string[];
  scanned: boolean;
  csam: boolean;
};

export type PromotionDeps = {
  admin: any;
  /** Scan the image behind this URL (a data URL or a short-lived signed URL). */
  scan: (target: string, userId: string) => Promise<ScanVerdict>;
  /** Escalate a child-safety hit. Called with the quarantine copy (or, if that copy failed, the staged original). */
  escalate: (bucket: string, path: string, categories: string[]) => Promise<void>;
  /** Test seam: the canonical re-encoder (src/lib/image-reencode.server.ts). */
  reencode?: (bytes: Uint8Array) => Promise<ReencodeResult>;
};

export type PromotionResult = {
  ok: true;
  quarantined: boolean;
  /** The safety scan or the re-encoder could not run. Nothing was published; the file waits in private staging (fail closed). */
  held?: boolean;
  reason: string | null;
  path: string;
  width: number | null;
  height: number | null;
  bytes: number;
  mime: string;
  metadataStripped: boolean;
};

const INLINE_SCAN_LIMIT = 4 * 1024 * 1024;
export const ANIMATED_REFUSAL = REENCODE_MESSAGES.animated;
export const PROCESSING_UNAVAILABLE = "Image processing unavailable";

async function removeStaged(
  admin: any,
  userId: string,
  path: string,
  reason: string,
  stage: string,
  extra: object,
) {
  await admin.storage.from(IMAGE_STAGING_BUCKET).remove([path]);
  await admin.from("image_moderation").upsert(
    {
      bucket: IMAGE_STAGING_BUCKET,
      path,
      owner_id: userId,
      status: "removed",
      reason,
      scan: { stage, ...extra },
    },
    { onConflict: "bucket,path" },
  );
}

/**
 * Validate, re-encode, scan, then publish a staged image. The destination bucket never holds the original: the re-encoded bytes
 * (src/lib/image-reencode.server.ts) are written only after validation, re-encoding and a safety scan all pass, and they are
 * exactly the bytes that were scanned. A flagged original is moved to the restricted quarantine (image-quarantine.server.ts);
 * every other failure leaves the object in private staging or removes it; nothing unprocessed is ever published. Safe to retry: the destination write is an upsert
 * under the caller's own folder, and a retry after the staged file was already promoted returns the recorded outcome.
 */
export async function promoteStagedImage(
  deps: PromotionDeps,
  input: { userId: string; bucket: string; stagingPath: string; targetPath: string },
): Promise<PromotionResult> {
  const { admin, scan, escalate } = deps;
  const { userId, bucket, stagingPath, targetPath } = input;
  if (!(IMAGE_BUCKET_KEYS as string[]).includes(bucket)) throw new Error("Unsupported bucket");
  if (!isOwnFilePath(userId, stagingPath) || !isOwnFilePath(userId, targetPath)) {
    throw new Error("You can only finalize your own uploads");
  }

  // A file that was flagged stays flagged: it is never re-scanned until it passes, and never promoted.
  const { data: flagged } = await admin
    .from("image_moderation")
    .select("status")
    .eq("bucket", IMAGE_STAGING_BUCKET)
    .eq("path", stagingPath)
    .maybeSingle();
  if (flagged && (flagged.status === "quarantined" || flagged.status === "removed")) {
    throw new Error("This image was flagged by our automated safety check and is pending review.");
  }

  const { data: blob, error: dlErr } = await admin.storage
    .from(IMAGE_STAGING_BUCKET)
    .download(stagingPath);
  if (dlErr || !blob) {
    // Only a genuinely missing file may fall back to a recorded outcome; any other storage error is a failure, not a success.
    if (
      dlErr &&
      !/not.?found|404|does not exist/i.test(String((dlErr as { message?: string }).message ?? ""))
    ) {
      throw new Error("Uploaded file could not be read");
    }
    // A retry after success: the staged copy is gone but the destination exists with a recorded outcome.
    const { data: prior } = await admin
      .from("image_moderation")
      .select("status, reason, bytes, width, height, mime")
      .eq("bucket", bucket)
      .eq("path", targetPath)
      .maybeSingle();
    if (prior && prior.status !== "removed") {
      return {
        ok: true,
        quarantined: prior.status === "quarantined",
        reason: prior.reason ?? null,
        path: targetPath,
        width: prior.width ?? null,
        height: prior.height ?? null,
        bytes: prior.bytes ?? 0,
        mime: prior.mime ?? "",
        metadataStripped: true,
      };
    }
    throw new Error("Uploaded file could not be read");
  }

  const original = new Uint8Array(await blob.arrayBuffer());
  const mime = sniffImageMime(original);
  const dimensions = readImageDimensions(original);
  const failure =
    validateImageMeta({ mime, bytes: original.byteLength, dimensions }) ??
    (dimensions ? null : "The file is not a readable JPG, PNG or WEBP image");
  if (failure) {
    await removeStaged(admin, userId, stagingPath, failure, "validation", { failure });
    throw new Error(failure);
  }
  const ext = extForImageMime(mime as string);
  if (!ext || !targetPath.endsWith(`.${ext}`)) {
    await removeStaged(
      admin,
      userId,
      stagingPath,
      "The file type does not match its name",
      "validation",
      {},
    );
    throw new Error("The file type does not match its name");
  }

  // Canonical re-encode (SEC-6 / M2): decode, apply the orientation, convert to sRGB, encode a fresh file of the same type with no
  // metadata. Only these bytes are scanned and only these bytes are published; nothing of the uploaded container survives.
  let encoded: ReencodeResult;
  try {
    encoded = await (deps.reencode ?? reencodeImage)(original);
  } catch (e) {
    const code = e instanceof ImageReencodeError ? e.code : "unreadable";
    if (code === "unavailable") {
      // Fail closed and retryable, like an unavailable scan: nothing is published, the original stays private.
      await admin.from("image_moderation").upsert(
        {
          bucket: IMAGE_STAGING_BUCKET,
          path: stagingPath,
          owner_id: userId,
          status: "pending",
          reason: PROCESSING_UNAVAILABLE,
          scan: { stage: "reencode_unavailable" },
        },
        { onConflict: "bucket,path" },
      );
      return {
        ok: true,
        quarantined: false,
        held: true,
        reason: PROCESSING_UNAVAILABLE,
        path: targetPath,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        bytes: original.byteLength,
        mime: mime as string,
        metadataStripped: false,
      };
    }
    const message = REENCODE_MESSAGES[code];
    await removeStaged(
      admin,
      userId,
      stagingPath,
      message,
      code === "animated" ? "validation" : "reencode",
      {
        failure: code,
      },
    );
    throw new Error(message);
  }
  const clean = encoded.bytes;
  const report = encoded.inputReport;

  // Validate what will actually be published (the re-encoded bytes), independently of the re-encoder's own checks: same type,
  // readable, within limits, and the same picture size once the orientation is applied.
  const cleanDims = readImageDimensions(clean);
  const swapped = (encoded.orientation ?? 1) >= 5;
  const expected = dimensions
    ? swapped
      ? { width: dimensions.height, height: dimensions.width }
      : dimensions
    : null;
  const cleanFailure =
    (sniffImageMime(clean) !== mime ? "The cleaned image is not the same type" : null) ??
    validateImageMeta({ mime, bytes: clean.byteLength, dimensions: cleanDims }) ??
    (cleanDims &&
    expected &&
    cleanDims.width === expected.width &&
    cleanDims.height === expected.height
      ? null
      : "The cleaned image is not readable");
  if (cleanFailure) {
    await removeStaged(admin, userId, stagingPath, cleanFailure, "validation", {
      failure: cleanFailure,
      cleaned: true,
    });
    throw new Error("This image could not be processed. Please try a different photo.");
  }

  // The scanner must see exactly the bytes that will be published. Up to 4 MB they travel inline. Above that, the CLEAN bytes are written to a
  // server-only scratch name (users can only write `{their own id}/...`, never `_scan/...`) and the scanner fetches that copy, which is then
  // deleted. The staged object itself is never re-fetched by the scanner, so a swap of it cannot change what is scanned.
  let target: string | null = null;
  let scratchPath: string | null = null;
  if (clean.byteLength <= INLINE_SCAN_LIMIT) {
    let binary = "";
    for (let i = 0; i < clean.length; i += 0x8000)
      binary += String.fromCharCode(...clean.subarray(i, i + 0x8000));
    target = `data:${mime};base64,${btoa(binary)}`;
  } else {
    scratchPath = `_scan/${crypto.randomUUID()}.${ext}`;
    const { error: scratchErr } = await admin.storage
      .from(IMAGE_STAGING_BUCKET)
      .upload(scratchPath, clean, { contentType: mime as string, upsert: false });
    if (!scratchErr) {
      const { data } = await admin.storage
        .from(IMAGE_STAGING_BUCKET)
        .createSignedUrl(scratchPath, 300);
      target = (data?.signedUrl as string | undefined) ?? null;
    } else {
      scratchPath = null;
    }
  }
  // Fail closed: if the scan cannot run (no target, scanner off or erroring), nothing is published.
  let verdict: ScanVerdict | null = null;
  if (target) {
    try {
      const v = await scan(target, userId);
      verdict = v.scanned || !v.safe ? v : null;
    } catch {
      verdict = null;
    } finally {
      if (scratchPath) await admin.storage.from(IMAGE_STAGING_BUCKET).remove([scratchPath]);
    }
  }
  // Colour kept under partially transparent pixels is scanned with the alpha dropped too (final review 780eaf8f, finding 1):
  // a flag there counts like a flag on the picture, and a scan that cannot run holds the upload.
  if (verdict?.safe && encoded.alphaRemovedScanTarget) {
    try {
      const v = await scan(encoded.alphaRemovedScanTarget, userId);
      verdict = !v.safe ? v : v.scanned ? verdict : null;
    } catch {
      verdict = null;
    }
  }

  const meta = {
    stripped: true,
    reencoded: true,
    hadGps: report.hasGps,
    hadExif: report.hasExif,
    hadXmp: report.hasXmp,
    orientation: encoded.orientation,
    convertedFromIcc: encoded.convertedFromIcc,
  };
  const base = {
    owner_id: userId,
    mime,
    bytes: clean.byteLength,
    width: cleanDims?.width ?? null,
    height: cleanDims?.height ?? null,
  };

  if (!verdict) {
    await admin.from("image_moderation").upsert(
      {
        bucket: IMAGE_STAGING_BUCKET,
        path: stagingPath,
        ...base,
        status: "pending",
        reason: "Safety scan unavailable",
        scan: { stage: "scan_unavailable", metadata: meta },
      },
      { onConflict: "bucket,path" },
    );
    return {
      ok: true,
      quarantined: false,
      held: true,
      reason: "Safety scan unavailable",
      path: targetPath,
      width: base.width,
      height: base.height,
      bytes: base.bytes,
      mime: mime as string,
      metadataStripped: meta.stripped,
    };
  }

  if (!verdict.safe) {
    // The original (as uploaded) goes to the restricted quarantine before anything else happens to it; it is never published.
    // Order: preserve, record, escalate, and only then remove the staged copy. If preserving fails, the staged original stays
    // where it is (private, unreadable by its uploader, never swept) and is escalated from there.
    const reason = verdict.reason ?? `Flagged by automated scan (${verdict.label})`;
    let held: QuarantineRef | null = null;
    try {
      held = await quarantineOriginal(admin, {
        source: "image_upload",
        sourceBucket: IMAGE_STAGING_BUCKET,
        sourcePath: stagingPath,
        uploaderId: userId,
        bytes: original,
        mime: mime as string,
        categories: verdict.categories,
        suspectedCsam: verdict.csam,
        reason,
      });
    } catch {
      held = null;
    }
    await admin.from("image_moderation").upsert(
      {
        bucket: IMAGE_STAGING_BUCKET,
        path: stagingPath,
        ...base,
        status: "quarantined",
        reason,
        quarantined_at: new Date().toISOString(),
        scan: {
          ...verdict,
          metadata: meta,
          quarantine: held
            ? { bucket: held.bucket, path: held.path, item_id: held.itemId }
            : { failed: true },
        },
      },
      { onConflict: "bucket,path" },
    );
    if (verdict.csam) {
      await escalate(
        held?.bucket ?? IMAGE_STAGING_BUCKET,
        held?.path ?? stagingPath,
        verdict.categories,
      );
    }
    if (held) await admin.storage.from(IMAGE_STAGING_BUCKET).remove([stagingPath]);
    return {
      ok: true,
      quarantined: true,
      reason,
      path: targetPath,
      width: base.width,
      height: base.height,
      bytes: base.bytes,
      mime: mime as string,
      metadataStripped: meta.stripped,
    };
  }

  const { data: priorTarget } = await admin
    .from("image_moderation")
    .select("status")
    .eq("bucket", bucket)
    .eq("path", targetPath)
    .maybeSingle();
  if (priorTarget && (priorTarget.status === "quarantined" || priorTarget.status === "removed")) {
    throw new Error("This image was flagged by our automated safety check and is pending review.");
  }
  // Claim the destination before anything is written there (final review 780eaf8f, finding 5c): from the moment this row exists,
  // published_image_refuse_user_write refuses every user write at the path, a signed upload URL included.
  const { error: modErr } = await admin.from("image_moderation").upsert(
    {
      bucket,
      path: targetPath,
      ...base,
      status: "pending",
      reason: null,
      scan: { ...verdict, metadata: meta },
    },
    { onConflict: "bucket,path" },
  );
  if (modErr) throw new Error(modErr.message);
  // Remove, then insert without upsert (finding 3). A legacy client may already have an object of its own at this path; an upsert
  // over it would keep the uploader as the row's owner, so the published-path trigger would refuse the server's own write. A fresh
  // insert by the service key has no owner. The claim above keeps the uploader from re-inserting in between.
  const { error: clearErr } = await admin.storage.from(bucket).remove([targetPath]);
  if (clearErr) throw new Error(`Could not publish the image: ${clearErr.message}`);
  const { error: upErr } = await admin.storage.from(bucket).upload(targetPath, clean, {
    contentType: mime as string,
    upsert: false,
    cacheControl: "31536000",
  });
  if (upErr) throw new Error(`Could not publish the image: ${upErr.message}`);
  await admin.storage.from(IMAGE_STAGING_BUCKET).remove([stagingPath]);

  return {
    ok: true,
    quarantined: false,
    reason: null,
    path: targetPath,
    width: base.width,
    height: base.height,
    bytes: base.bytes,
    mime: mime as string,
    metadataStripped: meta.stripped,
  };
}

export type StagingSweepResult = {
  examined: number;
  removed: number;
  kept: number;
  keptFlagged: number;
  /** Sub-folders inside a user folder. The upload policy allows only `{uid}/{file}`, so none should exist; they are reported, never removed. */
  skippedNested: number;
};

/**
 * Remove files that have waited in private staging longer than `olderThanMs` (abandoned uploads, failed publishes, held scans).
 * Staging is private, so a leftover is a retention matter, not an exposure. Files whose moderation record is quarantined (flagged,
 * possibly child-safety evidence) are NEVER removed here. Listings are paginated. The moderation rows of removed files are removed too.
 * Superadmin-triggered; not scheduled.
 */
export async function sweepImageStaging(
  admin: any,
  opts: { olderThanMs: number; now?: number; dryRun?: boolean; pageSize?: number },
): Promise<StagingSweepResult> {
  const now = opts.now ?? Date.now();
  const page = opts.pageSize ?? 1000;
  const result: StagingSweepResult = {
    examined: 0,
    removed: 0,
    kept: 0,
    keptFlagged: 0,
    skippedNested: 0,
  };
  const bucket = admin.storage.from(IMAGE_STAGING_BUCKET);

  const listAll = async (prefix: string) => {
    const all: { name: string; id?: string | null; created_at?: string | null }[] = [];
    for (let offset = 0; ; offset += page) {
      const { data } = await bucket.list(prefix, { limit: page, offset });
      const rows = (data ?? []) as typeof all;
      all.push(...rows);
      if (rows.length < page) break;
    }
    return all;
  };

  for (const folder of await listAll("")) {
    if (folder.id) continue; // a loose root file cannot be written through the API
    // The held fallback (flagged originals whose quarantine copy failed) is evidence: never swept.
    if (isHeldFallbackPath(`${folder.name}/`)) continue;
    const files = await listAll(folder.name);
    const stale: string[] = [];
    for (const f of files) {
      if (!f.id) {
        // a sub-folder (Storage lists folders with no id): never passed to remove(), which takes object names only
        result.skippedNested += 1;
        continue;
      }
      result.examined += 1;
      const created = f.created_at ? Date.parse(f.created_at) : NaN;
      if (Number.isFinite(created) && now - created > opts.olderThanMs)
        stale.push(`${folder.name}/${f.name}`);
      else result.kept += 1;
    }
    if (stale.length === 0) continue;
    const { data: flagged, error: flaggedErr } = await admin
      .from("image_moderation")
      .select("path, status, scan")
      .eq("bucket", IMAGE_STAGING_BUCKET)
      .in("path", stale);
    // Without the moderation state nothing in this folder can be told apart from evidence: keep it all.
    if (flaggedErr) {
      result.keptFlagged += stale.length;
      continue;
    }
    const protectedPaths = new Set(
      ((flagged ?? []) as { path: string; status: string; scan?: any }[])
        .filter(isGenuinelyHeldStagingRow)
        .map((r) => r.path),
    );
    const removable = stale.filter((p) => !protectedPaths.has(p));
    result.keptFlagged += stale.length - removable.length;
    if (removable.length === 0) continue;
    if (opts.dryRun) {
      result.removed += removable.length; // reported as would-remove in a dry run
      continue;
    }
    const { error } = await bucket.remove(removable);
    if (error) {
      result.kept += removable.length;
      continue;
    }
    result.removed += removable.length;
    await admin
      .from("image_moderation")
      .delete()
      .eq("bucket", IMAGE_STAGING_BUCKET)
      .in("path", removable);
  }
  return result;
}

type StagedFile = { path: string; name: string; bytes: number | null; created_at: string | null };

/** Every file in a user's own staging folder (`{userId}/{file}`), paginated. Sub-folders cannot exist (the upload policy refuses them). */
async function listOwnStaged(admin: any, userId: string, pageSize = 1000): Promise<StagedFile[]> {
  const out: StagedFile[] = [];
  const bucket = admin.storage.from(IMAGE_STAGING_BUCKET);
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await bucket.list(userId, { limit: pageSize, offset });
    if (error) throw new Error(error.message ?? "Could not list staged images");
    const rows = (data ?? []) as {
      name: string;
      id?: string | null;
      created_at?: string | null;
      metadata?: { size?: number } | null;
    }[];
    for (const r of rows) {
      if (!r.id || !r.name) continue;
      out.push({
        path: `${userId}/${r.name}`,
        name: r.name,
        bytes: typeof r.metadata?.size === "number" ? r.metadata.size : null,
        created_at: r.created_at ?? null,
      });
    }
    if (rows.length < pageSize) break;
  }
  return out;
}

type StagingRow = { path: string; status: string; scan?: any };

async function heldStagingPaths(
  admin: any,
  paths: string[],
  keep: (row: StagingRow) => boolean = isGenuinelyHeldStagingRow,
): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const { data, error } = await admin
    .from("image_moderation")
    .select("path, status, scan")
    .eq("bucket", IMAGE_STAGING_BUCKET)
    .in("path", paths);
  if (error) throw new Error(error.message ?? "Could not read moderation state");
  return new Set(((data ?? []) as StagingRow[]).filter(keep).map((r) => r.path));
}

/**
 * Account purge (L1): remove the user's staged images. A staged original the scan quarantined before SEC-6 moved such files to the
 * restricted quarantine is evidence under legal hold and is KEPT (as are quarantine-bucket items, which are not keyed by user and
 * are never purged; see docs/privacy/sec6-image-reencode-quarantine.md). Throws when the listing or the moderation lookup fails,
 * because a purge that silently skipped files would be reported as complete.
 */
export async function purgeStagedImagesForUser(
  admin: any,
  userId: string,
): Promise<{ removed: number; keptUnderHold: number }> {
  const files = await listOwnStaged(admin, userId);
  const held = await heldStagingPaths(
    admin,
    files.map((f) => f.path),
  );
  const removable = files.map((f) => f.path).filter((p) => !held.has(p));
  for (let i = 0; i < removable.length; i += 500) {
    const batch = removable.slice(i, i + 500);
    const { error } = await admin.storage.from(IMAGE_STAGING_BUCKET).remove(batch);
    if (error) throw new Error(error.message ?? "Could not remove staged images");
    await admin
      .from("image_moderation")
      .delete()
      .eq("bucket", IMAGE_STAGING_BUCKET)
      .in("path", batch);
  }
  return { removed: removable.length, keptUnderHold: held.size };
}

/**
 * Data export (L1): the user's own staged images, as metadata (name, size, upload time). Files held for a safety review are not
 * listed (law-enforcement and evidence exemption, pending counsel review; see the doc), and their bytes are never exported.
 */
export async function listStagedImagesForExport(
  admin: any,
  userId: string,
): Promise<{ name: string; bytes: number | null; uploaded_at: string | null }[]> {
  const files = await listOwnStaged(admin, userId);
  // Export hides every flagged file, not only the ones kept as evidence: listing it would tell the uploader it was flagged.
  const held = await heldStagingPaths(
    admin,
    files.map((f) => f.path),
    (r) => r.status === "quarantined" || isGenuinelyHeldStagingRow(r),
  );
  return files
    .filter((f) => !held.has(f.path))
    .map((f) => ({ name: f.name, bytes: f.bytes, uploaded_at: f.created_at }));
}
