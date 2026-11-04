/* eslint-disable @typescript-eslint/no-explicit-any -- the storage/database client is faked structurally */
import { IMAGE_BUCKET_KEYS } from "@/lib/image-moderation";
import { stripImageMetadata } from "@/lib/image-metadata";
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
  /** Escalate a child-safety hit for a staged object. */
  escalate: (bucket: string, path: string, categories: string[]) => Promise<void>;
};

export type PromotionResult = {
  ok: true;
  quarantined: boolean;
  /** The safety scan could not run. Nothing was published; the file waits in private staging (fail closed). */
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
export const ANIMATED_REFUSAL =
  "Animated images can't be used here. Please choose a still JPG, PNG or WEBP picture.";

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
 * Validate, clean, scan, then publish a staged image. The destination bucket never holds the original: the clean bytes are written
 * only after validation, metadata removal and a safety scan all pass. Every failure leaves the object in the private staging
 * bucket (quarantine) or removes it; nothing unprocessed is ever published. Safe to retry: the destination write is an upsert
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

  let clean: Uint8Array;
  let report: ReturnType<typeof stripImageMetadata>["report"];
  try {
    const result = stripImageMetadata(original);
    clean = result.changed ? result.bytes : original;
    report = result.report;
  } catch {
    await removeStaged(
      admin,
      userId,
      stagingPath,
      "The image could not be cleaned of location data",
      "metadata",
      {},
    );
    throw new Error("This image could not be processed. Please try a different photo.");
  }

  // The safety scanner looks at one frame. An animated PNG/WEBP could show a different picture in a later frame, so every
  // bucket promoted here (avatars, covers, team/org/trainer images, game covers) takes still images only.
  if (report.animated) {
    await removeStaged(admin, userId, stagingPath, ANIMATED_REFUSAL, "validation", {
      failure: "animated",
    });
    throw new Error(ANIMATED_REFUSAL);
  }

  // Validate what will actually be published (the clean bytes), not only the original: same type, readable, within limits,
  // and the same picture size.
  const cleanDims = readImageDimensions(clean);
  const cleanFailure =
    (sniffImageMime(clean) !== mime ? "The cleaned image is not the same type" : null) ??
    validateImageMeta({ mime, bytes: clean.byteLength, dimensions: cleanDims }) ??
    (cleanDims &&
    dimensions &&
    cleanDims.width === dimensions.width &&
    cleanDims.height === dimensions.height
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

  const meta = {
    stripped: clean !== original,
    hadGps: report.hasGps,
    hadExif: report.hasExif,
    hadXmp: report.hasXmp,
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
    // Held privately: the staged original stays in the private bucket for review and is never copied to a public one.
    const reason = verdict.reason ?? `Flagged by automated scan (${verdict.label})`;
    await admin.from("image_moderation").upsert(
      {
        bucket: IMAGE_STAGING_BUCKET,
        path: stagingPath,
        ...base,
        status: "quarantined",
        reason,
        quarantined_at: new Date().toISOString(),
        scan: { ...verdict, metadata: meta },
      },
      { onConflict: "bucket,path" },
    );
    if (verdict.csam) await escalate(IMAGE_STAGING_BUCKET, stagingPath, verdict.categories);
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
  const { error: upErr } = await admin.storage.from(bucket).upload(targetPath, clean, {
    contentType: mime as string,
    upsert: true,
    cacheControl: "31536000",
  });
  if (upErr) throw new Error(`Could not publish the image: ${upErr.message}`);
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
    const { data: flagged } = await admin
      .from("image_moderation")
      .select("path, status")
      .eq("bucket", IMAGE_STAGING_BUCKET)
      .in("path", stale);
    const protectedPaths = new Set(
      ((flagged ?? []) as { path: string; status: string }[])
        .filter((r) => r.status === "quarantined")
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
