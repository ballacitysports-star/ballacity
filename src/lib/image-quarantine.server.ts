/* eslint-disable @typescript-eslint/no-explicit-any -- the storage/database client is faked structurally in tests */
/**
 * Restricted quarantine for flagged image originals (SEC-6, review finding M4).
 *
 * A picture the safety scan flags is evidence. It is copied, byte for byte as uploaded, into the private `image-quarantine`
 * bucket (no API role can read, list, write or delete there; supabase/migrations/20261108120000_image_quarantine_reencode.sql),
 * recorded in image_quarantine_items with its SHA-256, and only then escalated and removed from where it was uploaded. If the
 * copy or the record fails, the caller keeps the source file where it is (private) and escalates with that location instead:
 * evidence is never deleted before it is preserved.
 *
 * Reviewers reach an original only through `mintQuarantineReviewUrl`: an audited, single-use grant from a SECURITY DEFINER RPC,
 * exchanged by the server for a 60-second signed URL. Retention and legal hold are enforced by the database; see
 * docs/privacy/sec6-image-reencode-quarantine.md.
 */

export const IMAGE_QUARANTINE_BUCKET = "image-quarantine";

export type QuarantineSource = "image_upload" | "message_attachment" | "legacy_direct_upload";

export type QuarantineInput = {
  source: QuarantineSource;
  sourceBucket: string;
  sourcePath: string;
  uploaderId: string | null;
  conversationId?: string | null;
  /** The original bytes exactly as uploaded (metadata included: it may matter to an investigation). */
  bytes: Uint8Array;
  mime: string;
  categories: string[];
  suspectedCsam: boolean;
  reason: string | null;
};

export type QuarantineRef = { bucket: string; path: string; itemId: string };

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Copy a flagged original into the quarantine and record it. Throws when either step fails; the caller must then keep the
 * source file (never delete it) and escalate with the source location.
 */
export async function quarantineOriginal(
  admin: any,
  input: QuarantineInput,
): Promise<QuarantineRef> {
  const ext = EXT[input.mime];
  if (!ext) throw new Error("Only pictures are quarantined");
  const path = `${input.source}/${crypto.randomUUID()}.${ext}`;
  const sha256 = await sha256Hex(input.bytes);
  const { error: upErr } = await admin.storage
    .from(IMAGE_QUARANTINE_BUCKET)
    .upload(path, input.bytes, { contentType: input.mime, upsert: false });
  if (upErr) throw new Error(`Quarantine copy failed: ${upErr.message ?? upErr}`);
  const { data, error } = await admin
    .from("image_quarantine_items")
    .insert({
      object_path: path,
      source: input.source,
      source_bucket: input.sourceBucket,
      source_path: input.sourcePath,
      uploader_id: input.uploaderId,
      conversation_id: input.conversationId ?? null,
      mime: input.mime,
      bytes: input.bytes.byteLength,
      sha256,
      categories: input.categories,
      suspected_csam: input.suspectedCsam,
      reason: input.reason,
    })
    .select("id")
    .single();
  // The copy stays in the quarantine (the database refuses to delete an unrecorded object) for manual reconciliation.
  if (error || !data?.id) throw new Error(`Quarantine record failed: ${error?.message ?? "no id"}`);
  return { bucket: IMAGE_QUARANTINE_BUCKET, path, itemId: String(data.id) };
}

export const REVIEW_URL_SECONDS = 60;

/**
 * Open a quarantined original for an authorized reviewer. `userClient` is the reviewer's own (RLS) client: the definer RPC checks
 * the role and writes the audit row. The service client exchanges the single-use grant for the path and signs a short URL.
 */
export async function mintQuarantineReviewUrl(
  userClient: any,
  admin: any,
  input: { itemId: string; reason: string },
): Promise<{ url: string; expiresInSeconds: number }> {
  const { data: grantId, error: reqErr } = await userClient.rpc("request_quarantine_review", {
    _item_id: input.itemId,
    _reason: input.reason,
  });
  if (reqErr || !grantId) throw new Error(reqErr?.message ?? "Review not allowed");
  const { data: rows, error: useErr } = await admin.rpc("consume_quarantine_review", {
    _grant_id: grantId,
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (useErr || !row?.object_path) throw new Error(useErr?.message ?? "Review link expired");
  const ttl = Math.min(Number(row.url_ttl_seconds) || REVIEW_URL_SECONDS, REVIEW_URL_SECONDS);
  const { data: signed, error: signErr } = await admin.storage
    .from(IMAGE_QUARANTINE_BUCKET)
    .createSignedUrl(row.object_path, ttl);
  if (signErr || !signed?.signedUrl) throw new Error("Could not open the quarantined original");
  return { url: String(signed.signedUrl), expiresInSeconds: ttl };
}

export type QuarantineSweepResult = { due: number; destroyed: number; failed: number };

/**
 * Destroy quarantined originals whose retention has ended and that are not under legal hold. The database refuses anything else
 * (image_quarantine_guard), so this cannot remove evidence early even if the query below were wrong. Superadmin-triggered;
 * not scheduled. Dry run by default.
 */
export async function sweepExpiredQuarantine(
  admin: any,
  opts: { now?: Date; dryRun?: boolean; limit?: number } = {},
): Promise<QuarantineSweepResult> {
  const now = (opts.now ?? new Date()).toISOString();
  const { data, error } = await admin
    .from("image_quarantine_items")
    .select("id, object_path")
    .eq("legal_hold", false)
    .neq("status", "destroyed")
    .lte("retain_until", now)
    .limit(opts.limit ?? 500);
  if (error) throw new Error(error.message);
  const due = (data ?? []) as { id: string; object_path: string }[];
  const result: QuarantineSweepResult = { due: due.length, destroyed: 0, failed: 0 };
  if (opts.dryRun !== false) return result;
  for (const item of due) {
    const { error: rmErr } = await admin.storage
      .from(IMAGE_QUARANTINE_BUCKET)
      .remove([item.object_path]);
    if (rmErr) {
      result.failed += 1;
      continue;
    }
    const { error: upErr } = await admin
      .from("image_quarantine_items")
      .update({ status: "destroyed", destroyed_at: new Date().toISOString() })
      .eq("id", item.id);
    if (upErr) result.failed += 1;
    else result.destroyed += 1;
  }
  return result;
}
