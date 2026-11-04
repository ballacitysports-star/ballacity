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
  reason: string | null;
  path: string;
  width: number | null;
  height: number | null;
  bytes: number;
  mime: string;
  metadataStripped: boolean;
};

const INLINE_SCAN_LIMIT = 4 * 1024 * 1024;

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

  const { data: blob, error: dlErr } = await admin.storage
    .from(IMAGE_STAGING_BUCKET)
    .download(stagingPath);
  if (dlErr || !blob) {
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

  let target: string | null = null;
  if (clean.byteLength <= INLINE_SCAN_LIMIT) {
    let binary = "";
    for (let i = 0; i < clean.length; i += 0x8000)
      binary += String.fromCharCode(...clean.subarray(i, i + 0x8000));
    target = `data:${mime};base64,${btoa(binary)}`;
  } else {
    const { data } = await admin.storage
      .from(IMAGE_STAGING_BUCKET)
      .createSignedUrl(stagingPath, 300);
    target = (data?.signedUrl as string | undefined) ?? null;
  }
  const verdict: ScanVerdict = target
    ? await scan(target, userId)
    : { safe: true, label: "unscanned", reason: null, categories: [], scanned: false, csam: false };

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
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
  };

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
