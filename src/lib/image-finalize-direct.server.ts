/* eslint-disable @typescript-eslint/no-explicit-any -- the storage/database client is faked structurally in tests */
import { IMAGE_BUCKET_KEYS } from "@/lib/image-moderation";
import { quarantineOriginal, type QuarantineRef } from "@/lib/image-quarantine.server";
import {
  ImageReencodeError,
  REENCODE_MESSAGES,
  reencodeImage,
  type ReencodeResult,
} from "@/lib/image-reencode.server";
import {
  MAX_IMAGE_BYTES,
  readImageDimensions,
  sniffImageMime,
  validateImageMeta,
} from "@/lib/image-validation";

/**
 * LEGACY. Finalize an image an older client uploaded straight into a public bucket (finalizeImageUpload). New clients stage
 * privately and call promoteStagedImage instead; this endpoint is retired with phase 2 (docs/privacy/g3b-image-staging.md).
 */
export type DirectScanVerdict = {
  safe: boolean;
  label: string;
  reason: string | null;
  categories: string[];
  scanned?: boolean;
  csam: boolean;
};

export type DirectFinalizeDeps = {
  admin: any;
  scan: (target: string, userId: string) => Promise<DirectScanVerdict>;
  /** A URL the scanner can fetch for an image too large to inline. */
  objectUrl: (bucket: string, path: string) => Promise<string | null>;
  escalate: (bucket: string, path: string, categories: string[]) => Promise<void>;
  /** Test seam: the canonical re-encoder. */
  reencode?: (bytes: Uint8Array) => Promise<ReencodeResult>;
};

export const FLAGGED_REFUSAL =
  "This image was flagged by our automated safety check and is pending review.";
export const SCAN_UNAVAILABLE_REFUSAL =
  "We couldn't check this image right now. Please try again in a few minutes.";

export async function finalizeDirectImageUpload(
  deps: DirectFinalizeDeps,
  input: { userId: string; bucket: string; path: string },
) {
  const { admin, scan, objectUrl, escalate } = deps;
  const { userId, bucket, path } = input;
  if (!(IMAGE_BUCKET_KEYS as string[]).includes(bucket)) {
    throw new Error("Unsupported bucket");
  }
  if (!path.startsWith(`${userId}/`)) {
    throw new Error("You can only finalize your own uploads");
  }

  // A moderator's (or the scan's) decision stands: a quarantined or removed object is never rescanned, so a call from the
  // owner cannot reset it to 'pending' (as promoteStagedImage does for staged files).
  const { data: existing, error: existingErr } = await admin
    .from("image_moderation")
    .select("status")
    .eq("bucket", bucket)
    .eq("path", path)
    .maybeSingle();
  if (existingErr) throw new Error("Could not check this image's moderation state");
  if (existing && (existing.status === "quarantined" || existing.status === "removed")) {
    throw new Error(FLAGGED_REFUSAL);
  }

  const record = (row: Record<string, unknown>) =>
    admin
      .from("image_moderation")
      .upsert({ bucket, path, owner_id: userId, ...row }, { onConflict: "bucket,path" });
  const remove = () => admin.storage.from(bucket).remove([path]);

  const { data: blob, error: dlErr } = await admin.storage.from(bucket).download(path);
  if (dlErr || !blob) throw new Error("Uploaded file could not be read");

  let buffer: Uint8Array = new Uint8Array(await blob.arrayBuffer());
  let bytes = buffer.byteLength;
  const sniffed = sniffImageMime(buffer);
  const dimensions = readImageDimensions(buffer);

  const failure =
    validateImageMeta({ mime: sniffed, bytes, dimensions }) ??
    (dimensions ? null : "The file is not a readable JPG, PNG or WEBP image");

  if (failure) {
    await remove();
    await record({
      status: "removed",
      reason: failure,
      mime: sniffed,
      bytes,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      scan: { stage: "validation", failure },
    });
    throw new Error(failure);
  }

  // The object is public right now. Claim the path first (a moderation row makes the published-image trigger refuse any further
  // write by the uploader, a signed upload URL included; 20261108120000), then replace the stored bytes with the canonical
  // re-encode (src/lib/image-reencode.server.ts) before anything scans or serves them. Any failure removes the object.
  const original = buffer;
  await record({
    status: "pending",
    reason: "Processing",
    mime: sniffed,
    bytes,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    scan: { stage: "processing" },
  });
  let encoded: ReencodeResult;
  try {
    encoded = await (deps.reencode ?? reencodeImage)(original);
    const { error: rewriteErr } = await admin.storage.from(bucket).upload(path, encoded.bytes, {
      contentType: sniffed as string,
      upsert: true,
      cacheControl: "3600",
    });
    if (rewriteErr) throw new Error(rewriteErr.message);
  } catch (e) {
    const code = e instanceof ImageReencodeError ? e.code : "unreadable";
    const message = code === "unavailable" ? SCAN_UNAVAILABLE_REFUSAL : REENCODE_MESSAGES[code];
    await remove();
    await record({
      status: "removed",
      reason:
        code === "unavailable"
          ? "Image processing unavailable"
          : "The image could not be re-encoded",
      mime: sniffed,
      bytes,
      scan: { stage: "reencode", failure: code },
    });
    throw new Error(message);
  }
  buffer = encoded.bytes;
  bytes = buffer.byteLength;
  const published = { width: encoded.width, height: encoded.height };
  const metadata = {
    stripped: true,
    reencoded: true,
    hadGps: encoded.inputReport.hasGps,
    hadExif: encoded.inputReport.hasExif,
    hadXmp: encoded.inputReport.hasXmp,
  };

  // Small enough to inline: keeps private-bucket scans off signed URLs.
  let scanTarget: string | null = null;
  if (bytes <= 4 * 1024 * 1024 && bytes <= MAX_IMAGE_BYTES) {
    let binary = "";
    for (let i = 0; i < buffer.length; i += 0x8000) {
      binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
    }
    scanTarget = `data:${sniffed};base64,${btoa(binary)}`;
  } else {
    scanTarget = await objectUrl(bucket, path);
  }

  // Fail closed: an image whose safety scan could not run (no target, scanner off or erroring) is not kept in a public bucket.
  let verdict: DirectScanVerdict | null = null;
  if (scanTarget) {
    try {
      const v = await scan(scanTarget, userId);
      verdict = v.scanned === false && v.safe ? null : v;
    } catch {
      verdict = null;
    }
  }
  if (!verdict) {
    await remove();
    await record({
      status: "removed",
      reason: "Safety scan unavailable",
      mime: sniffed,
      bytes,
      scan: { stage: "scan_unavailable", metadata },
    });
    throw new Error(SCAN_UNAVAILABLE_REFUSAL);
  }

  const quarantined = !verdict.safe;
  const reason = quarantined
    ? (verdict.reason ?? `Flagged by automated scan (${verdict.label})`)
    : null;

  // A flagged picture never stays at a public URL: the original goes to the restricted quarantine, and the public object is
  // removed once that copy exists. If the copy fails, the object stays (hidden app-wide by its quarantined status) and is
  // escalated where it is.
  let held: QuarantineRef | null = null;
  if (quarantined) {
    try {
      held = await quarantineOriginal(admin, {
        source: "legacy_direct_upload",
        sourceBucket: bucket,
        sourcePath: path,
        uploaderId: userId,
        bytes: original,
        mime: sniffed as string,
        categories: verdict.categories,
        suspectedCsam: verdict.csam,
        reason,
      });
    } catch {
      held = null;
    }
  }

  const { error: upErr } = await record({
    status: quarantined ? "quarantined" : "pending",
    reason,
    mime: sniffed,
    bytes,
    width: published.width,
    height: published.height,
    quarantined_at: quarantined ? new Date().toISOString() : null,
    scan: {
      ...verdict,
      metadata,
      ...(quarantined
        ? {
            quarantine: held
              ? { bucket: held.bucket, path: held.path, item_id: held.itemId }
              : { failed: true },
          }
        : {}),
    },
  });
  if (upErr) throw new Error(upErr.message);

  if (verdict.csam) {
    await escalate(held?.bucket ?? bucket, held?.path ?? path, verdict.categories);
  }
  if (held) await remove();

  return {
    ok: true as const,
    quarantined,
    reason,
    width: published.width,
    height: published.height,
    bytes,
    mime: sniffed,
    metadataStripped: metadata.stripped,
  };
}
