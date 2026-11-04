/* eslint-disable @typescript-eslint/no-explicit-any -- the database client is faked structurally in tests */
/**
 * One server call at a time per image path (SEC-6, R5 independent review 39ae9545, finding 1). See
 * supabase/migrations/20261108130000_image_processing_claim.sql: claim_image_processing atomically marks a path 'processing' under a
 * fresh token (refused while another call holds a live claim, and always for a quarantined or removed path); every non-flag outcome
 * is then written with finish_image_processing, which only succeeds while that same claim still stands. A flag is written
 * unconditionally and so always wins over a concurrent "safe" verdict. A claim older than 10 minutes can be taken over.
 */

export const PROCESSING_BUSY =
  "This image is already being processed. Please try again in a moment.";

export type ClaimResult = { token: string | null; status: string | null };

/** Claim `bucket/path` for processing. Throws only when the database cannot be asked. */
export async function claimImagePath(
  admin: any,
  bucket: string,
  path: string,
  ownerId: string,
): Promise<ClaimResult> {
  const { data, error } = await admin.rpc("claim_image_processing", {
    _bucket: bucket,
    _path: path,
    _owner_id: ownerId,
  });
  if (error) throw new Error("Could not check this image's moderation state");
  const row = (Array.isArray(data) ? data[0] : data) as
    { claim_token?: string | null; status?: string | null } | null | undefined;
  return { token: row?.claim_token ?? null, status: row?.status ?? null };
}

/** A path that was flagged (by the scan or a moderator) is never processed again. */
export function isFlaggedStatus(status: string | null | undefined): boolean {
  return status === "quarantined" || status === "removed";
}

/**
 * Settle a claim: 'pending' / 'removed' write the outcome, 'released' deletes the row. True only when the claim still stood;
 * false when it was lost (a flag or a moderator decision was written in between, or a stale claim was taken over) or the call
 * failed. On false the caller must not publish, and must not remove anything another call may be holding as evidence.
 */
export async function finishImagePath(
  admin: any,
  bucket: string,
  path: string,
  token: string,
  status: "pending" | "removed" | "released",
  fields: Record<string, unknown> = {},
): Promise<boolean> {
  const { data, error } = await admin.rpc("finish_image_processing", {
    _bucket: bucket,
    _path: path,
    _claim_token: token,
    _status: status,
    _fields: fields,
  });
  return !error && data === true;
}
