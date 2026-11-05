/* eslint-disable @typescript-eslint/no-explicit-any -- the storage/database client is faked structurally in tests */
import { IMAGE_BUCKET_KEYS } from "@/lib/image-moderation";
import {
  holdOriginalPrivately,
  quarantineOriginal,
  sha256Hex,
  type HeldFallbackRef,
  type QuarantineRef,
} from "@/lib/image-quarantine.server";
import {
  PROCESSING_BUSY,
  claimImagePath,
  finishImagePath,
  isFlaggedStatus,
} from "@/lib/image-processing-claim.server";
import {
  ImageReencodeError,
  REENCODE_MESSAGES,
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
  /** The re-encoder from the configured runtime (select.server.ts). Required: no in-process default (audit F09). */
  reencode: (bytes: Uint8Array) => Promise<ReencodeResult>;
};

export const FLAGGED_REFUSAL =
  "This image was flagged by our automated safety check and is pending review.";
export const SCAN_UNAVAILABLE_REFUSAL =
  "We couldn't check this image right now. Please try again in a few minutes.";
export { PROCESSING_BUSY };

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

  // Claim the path, atomically, in the database (R5 independent review 39ae9545, finding 1). A moderator's (or the scan's)
  // decision stands: a quarantined or removed object is never rescanned, so a call from the owner cannot reset it to 'pending'.
  // A second call while this one runs is refused. The claim row also makes the published-image trigger refuse any further write
  // by the uploader at this path, a signed upload URL included (20261108120000).
  const claim = await claimImagePath(admin, bucket, path, userId);
  if (!claim.token) {
    throw new Error(isFlaggedStatus(claim.status) ? FLAGGED_REFUSAL : PROCESSING_BUSY);
  }
  const token = claim.token;

  // A flag is written unconditionally (it always wins); every other outcome only while this call's claim still stands.
  const recordFlag = (row: Record<string, unknown>) =>
    admin.from("image_moderation").upsert(
      { bucket, path, owner_id: userId, ...row, claim_token: null, claimed_at: null },
      {
        onConflict: "bucket,path",
      },
    );
  const settle = (status: "pending" | "removed", row: Record<string, unknown>) =>
    finishImagePath(admin, bucket, path, token, status, row);
  const remove = () => admin.storage.from(bucket).remove([path]);
  // The claim was lost: another call (or a moderator) decided in between. If that decision was a flag, or the row is gone, the
  // public object must not stay; if this call's claim still stands (the database write failed), it is removed too. Only when
  // another call holds the path, or published it, is its object left alone.
  const refuse = async (): Promise<Error> => {
    const { data: row } = await admin
      .from("image_moderation")
      .select("status, claim_token")
      .eq("bucket", bucket)
      .eq("path", path)
      .maybeSingle();
    const ours = row?.status === "processing" && row?.claim_token === token;
    if (!row || ours || isFlaggedStatus(row.status)) await remove();
    if (ours) return new Error("Could not record this image's moderation state");
    return new Error(row && isFlaggedStatus(row.status) ? FLAGGED_REFUSAL : PROCESSING_BUSY);
  };
  // A non-flag failure: record 'removed' (while the claim stands), then take the object down.
  const fail = async (message: string, row: Record<string, unknown>): Promise<never> => {
    if (await settle("removed", row)) {
      await remove();
      throw new Error(message);
    }
    throw await refuse();
  };

  const { data: blob, error: dlErr } = await admin.storage.from(bucket).download(path);
  if (dlErr || !blob) {
    // Give the claim back as 'pending' (retryable): 'removed' would block the path for good over a storage hiccup, and deleting
    // the row could drop an earlier decision (a moderator's 'kept').
    await finishImagePath(admin, bucket, path, token, "pending", {
      reason: "Uploaded file could not be read",
      scan: { stage: "download" },
    });
    throw new Error("Uploaded file could not be read");
  }

  let buffer: Uint8Array = new Uint8Array(await blob.arrayBuffer());
  let bytes = buffer.byteLength;
  const sniffed = sniffImageMime(buffer);
  const dimensions = readImageDimensions(buffer);

  const failure =
    validateImageMeta({ mime: sniffed, bytes, dimensions }) ??
    (dimensions ? null : "The file is not a readable JPG, PNG or WEBP image");

  if (failure) {
    await fail(failure, {
      reason: failure,
      mime: sniffed,
      bytes,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      scan: { stage: "validation", failure },
    });
  }

  // The object is public right now and the path is claimed (above). Replace the stored bytes with the canonical re-encode
  // (src/lib/image-reencode.server.ts) before anything scans or serves them. Any failure removes the object.
  const original = buffer;
  let encoded: ReencodeResult;
  try {
    encoded = await deps.reencode(original);
    // Remove, then insert without upsert (final review 780eaf8f, finding 3). The object was written by the uploader, so its row
    // carries them as owner; an upsert keeps that owner and published_image_refuse_user_write (the path is claimed above) would
    // refuse the server's own rewrite. A fresh insert by the service key has no owner. The claim keeps the uploader from
    // re-inserting at the path in between.
    const { error: clearErr } = await remove();
    if (clearErr) throw new Error(clearErr.message);
    const { error: rewriteErr } = await admin.storage.from(bucket).upload(path, encoded.bytes, {
      contentType: sniffed as string,
      upsert: false,
      cacheControl: "3600",
    });
    if (rewriteErr) throw new Error(rewriteErr.message);
  } catch (e) {
    const code = e instanceof ImageReencodeError ? e.code : "unreadable";
    const message = code === "unavailable" ? SCAN_UNAVAILABLE_REFUSAL : REENCODE_MESSAGES[code];
    await fail(message, {
      reason:
        code === "unavailable"
          ? "Image processing unavailable"
          : "The image could not be re-encoded",
      mime: sniffed,
      bytes,
      scan: { stage: "reencode", failure: code },
    });
    throw new Error(message); // unreachable: fail() always throws
  }
  // A flag recorded by another call while this one re-encoded took the object down; the rewrite above may have put it back.
  {
    const { data: row } = await admin
      .from("image_moderation")
      .select("status, claim_token")
      .eq("bucket", bucket)
      .eq("path", path)
      .maybeSingle();
    if (!(row?.status === "processing" && row?.claim_token === token)) throw await refuse();
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
  // A picture with transparency is also scanned flattened on white, flattened on black and, for partial alpha, with the alpha
  // dropped (final review 780eaf8f finding 1; R5 independent review 39ae9545 finding 2), all made from the re-encoded pixels.
  // A flag on any rendition flags the image; a failed scan of any of them fails closed.
  for (const rendition of encoded.scanRenditions ?? []) {
    if (!verdict?.safe) break;
    try {
      const v = await scan(rendition, userId);
      verdict = !v.safe ? v : v.scanned === false ? null : verdict;
    } catch {
      verdict = null;
    }
  }
  if (!verdict) {
    await fail(SCAN_UNAVAILABLE_REFUSAL, {
      reason: "Safety scan unavailable",
      mime: sniffed,
      bytes,
      scan: { stage: "scan_unavailable", metadata },
    });
  }
  // (fail() always throws; this narrows the type for what follows.)
  if (!verdict) throw new Error(SCAN_UNAVAILABLE_REFUSAL);

  const quarantined = !verdict.safe;
  const reason = quarantined
    ? (verdict.reason ?? `Flagged by automated scan (${verdict.label})`)
    : null;

  // A flagged picture never stays at a public URL (final review 780eaf8f, finding 2). The original goes to the restricted
  // quarantine; if that copy fails, to a private held fallback (image-staging/_held/..., service key, recorded for a retry); if
  // even that fails, only its SHA-256 is kept for the escalation. In every case the public object is removed (before the
  // escalation), and the escalation never points at a public path.
  let held: QuarantineRef | null = null;
  let fallback: HeldFallbackRef | null = null;
  let sha256: string | null = null;
  if (quarantined) {
    const evidence = {
      source: "legacy_direct_upload" as const,
      sourceBucket: bucket,
      sourcePath: path,
      uploaderId: userId,
      bytes: original,
      mime: sniffed as string,
      categories: verdict.categories,
      suspectedCsam: verdict.csam,
      reason,
    };
    try {
      held = await quarantineOriginal(admin, evidence);
    } catch {
      held = null;
    }
    if (!held) {
      try {
        fallback = await holdOriginalPrivately(admin, evidence);
      } catch {
        fallback = null;
      }
    }
    sha256 = fallback?.sha256 ?? (held ? null : await sha256Hex(original));
  }

  const outcome = {
    reason,
    mime: sniffed,
    bytes,
    width: published.width,
    height: published.height,
  };

  if (quarantined) {
    const { error: upErr } = await recordFlag({
      ...outcome,
      status: "quarantined",
      quarantined_at: new Date().toISOString(),
      scan: {
        ...verdict,
        metadata,
        quarantine: held
          ? { bucket: held.bucket, path: held.path, item_id: held.itemId }
          : fallback
            ? { failed: true, held: { bucket: fallback.bucket, path: fallback.path }, sha256 }
            : { failed: true, unpreserved: true, sha256 },
      },
    });
    // Off the public bucket first, so a failing escalation or record cannot leave it there.
    const { error: rmErr } = await remove();
    if (verdict.csam) {
      if (held) await escalate(held.bucket, held.path, verdict.categories);
      else if (fallback) await escalate(fallback.bucket, fallback.path, verdict.categories);
      else await escalate("unpreserved", `sha256:${sha256}`, verdict.categories);
    }
    if (rmErr) throw new Error(`${FLAGGED_REFUSAL} (removal pending)`);
    if (upErr) throw new Error(upErr.message);
    return {
      ok: true as const,
      quarantined: true,
      published: false,
      reason,
      width: published.width,
      height: published.height,
      bytes,
      mime: sniffed,
      metadataStripped: metadata.stripped,
    };
  }
  // Published only while this call's claim still stands: a flag written by another call in the meantime wins, and the object
  // this call rewrote is taken down instead (R5 independent review 39ae9545, finding 1).
  if (!(await settle("pending", { ...outcome, scan: { ...verdict, metadata } }))) {
    throw await refuse();
  }

  return {
    ok: true as const,
    quarantined: false,
    published: true,
    reason,
    width: published.width,
    height: published.height,
    bytes,
    mime: sniffed,
    metadataStripped: metadata.stripped,
  };
}
