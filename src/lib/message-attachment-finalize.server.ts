/* eslint-disable @typescript-eslint/no-explicit-any -- the storage/database client is faked structurally in tests */
import { stripStoredImage } from "@/lib/image-metadata.server";
import { quarantineOriginal, type QuarantineRef } from "@/lib/image-quarantine.server";
import {
  MAX_ATTACHMENT_BYTES,
  attachmentProblem,
  classifyAttachment,
  type AttachmentKind,
} from "@/lib/message-attachment-validation";

export const ATTACHMENT_BUCKET = "message-attachments";
/**
 * Server-only scratch folder for scanning large pictures. The first segment is the nil UUID, a conversation nobody is in, so the
 * read policy (participants only) matches no one, and the second segment is `_scan`, never a user id, so the upload policy
 * (second segment = the uploader) lets no one write here. Only the service role reads and writes it.
 */
export const ATTACHMENT_SCAN_PREFIX = "00000000-0000-0000-0000-000000000000/_scan/";
const INLINE_SCAN_LIMIT = 4 * 1024 * 1024;

export type AttachmentScanVerdict = {
  safe: boolean;
  csam: boolean;
  categories: string[];
  scanned?: boolean;
};

export type AttachmentFinalizeDeps = {
  admin: any;
  scan: (target: string, userId: string) => Promise<AttachmentScanVerdict>;
  /** Escalate a child-safety hit, with the quarantine copy's location (or the attachment's own, if the copy failed). */
  escalate: (bucket: string, path: string, categories: string[]) => Promise<void>;
};

export type AttachmentFinalizeResult = {
  ok: true;
  kind: AttachmentKind;
  mime: string;
  bytes: number;
  objectId: string;
  objectVersion: string;
};

/** The stored object at a path: Storage keeps the id across an overwrite in place (upsert) and gives it a new version. */
type ObjectRef = { id: string; version: string };
const sameObject = (a: ObjectRef | null, b: ObjectRef | null) =>
  !!a && !!b && a.id === b.id && a.version === b.version;
const sameBytes = (a: Uint8Array, b: Uint8Array) => {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
};

const CHANGED = "The file changed while it was being checked. Please attach it again.";

/**
 * Check a stored chat attachment and record the check, bound to the exact storage object that was checked.
 *
 * The check row stores the object's `storage.objects.id` and `version`, and the message-insert trigger
 * (supabase/migrations/20261106120500_attachment_check_binding.sql) accepts the message only while that same object, at that
 * same version, is still at the path. A sender can delete their own unsent file and upload another at the same path (a new
 * id), or overwrite it in place through a signed upload URL minted with upsert (same id, new version); either way a check made
 * on the first file never vouches for the second. Both are read through Storage's info() before the bytes are downloaded and
 * again after every check; if either moved in between, nothing is recorded. After a clean rewrite the server downloads the
 * stored object again, between two info() reads, and records it only if it holds exactly the bytes that were scanned. Once the
 * check row exists, database triggers refuse any further write at the path except the service key's own.
 *
 * A picture is scanned as the clean bytes the server holds: inline up to 4 MB, above that from a server-only scratch copy
 * (ATTACHMENT_SCAN_PREFIX), never by re-fetching the sender's path, which the sender could swap during the scan.
 */
export async function finalizeAttachment(
  deps: AttachmentFinalizeDeps,
  input: { userId: string; conversationId: string; path: string },
): Promise<AttachmentFinalizeResult> {
  const { admin, scan, escalate } = deps;
  const { userId, conversationId, path } = input;
  const bucket = admin.storage.from(ATTACHMENT_BUCKET);
  const remove = () => bucket.remove([path]);
  const objectNow = async (): Promise<ObjectRef | null> => {
    const { data, error } = await bucket.info(path);
    // No version, no binding: fail closed rather than record a check the database would refuse at send.
    return error || !data?.id || !data?.version
      ? null
      : { id: String(data.id), version: String(data.version) };
  };

  const before = await objectNow();
  if (!before) throw new Error("Uploaded file could not be read");
  const { data: blob, error: dlErr } = await bucket.download(path);
  if (dlErr || !blob) throw new Error("Uploaded file could not be read");
  if (blob.size > MAX_ATTACHMENT_BYTES) {
    await remove();
    throw new Error("Attachment too large (max 20MB).");
  }
  const buffer = new Uint8Array(await blob.arrayBuffer());
  const problem = attachmentProblem(buffer);
  const checked = problem ? null : classifyAttachment(buffer);
  if (problem || !checked) {
    await remove();
    throw new Error(problem ?? "That file type is not allowed.");
  }

  let stored: Uint8Array = buffer;
  // The object the check vouches for: the one downloaded, or, when the server rewrote it without metadata, the rewrite.
  let expected: ObjectRef | null = before;
  if (checked.kind === "image" && /^image\/(jpeg|png|webp)$/.test(checked.mime)) {
    // Location and device tags are removed from the stored picture before the recipient or a scanner sees it.
    try {
      const out = await stripStoredImage(admin, ATTACHMENT_BUCKET, path, buffer, checked.mime);
      stored = out.bytes;
      if (out.rewritten) {
        // Storage's upload answer has no version, and the sender could overwrite the path right after the rewrite. Read the
        // object back between two info() calls and bind to it only if it is the rewrite and holds exactly the clean bytes.
        const first = await objectNow();
        const { data: back } = await bucket.download(path);
        const backBytes = back ? new Uint8Array(await back.arrayBuffer()) : null;
        const second = await objectNow();
        expected =
          first &&
          out.objectId &&
          first.id === out.objectId &&
          sameObject(first, second) &&
          backBytes &&
          sameBytes(backBytes, stored)
            ? first
            : null; // fails closed below
      }
    } catch {
      await remove();
      throw new Error("That picture can't be sent. Please try a different one.");
    }
  }

  if (checked.kind === "image") {
    let target: string | null = null;
    let scratch: string | null = null;
    if (stored.byteLength <= INLINE_SCAN_LIMIT) {
      let binary = "";
      for (let i = 0; i < stored.length; i += 0x8000) {
        binary += String.fromCharCode(...stored.subarray(i, i + 0x8000));
      }
      target = `data:${checked.mime};base64,${btoa(binary)}`;
    } else {
      scratch = `${ATTACHMENT_SCAN_PREFIX}${crypto.randomUUID()}`;
      const { error: upErr } = await bucket.upload(scratch, stored, {
        contentType: checked.mime,
        upsert: false,
      });
      if (upErr) scratch = null;
      else {
        const { data } = await bucket.createSignedUrl(scratch, 300);
        target = (data?.signedUrl as string | undefined) ?? null;
      }
    }
    let verdict: AttachmentScanVerdict = {
      safe: true,
      csam: false,
      categories: [],
      scanned: false,
    };
    try {
      if (target) verdict = await scan(target, userId);
    } catch {
      verdict = { safe: true, csam: false, categories: [], scanned: false };
    } finally {
      if (scratch) await bucket.remove([scratch]);
    }
    // Fail closed: an attachment whose safety scan could not run is not accepted (the sender can retry).
    if (verdict.safe && verdict.scanned === false) {
      await remove();
      throw new Error("We couldn't check this image right now. Please try again in a few minutes.");
    }
    if (!verdict.safe) {
      // M4: the original is evidence. Preserve it (as uploaded, metadata included) in the restricted quarantine, escalate with
      // that reference, and only then remove it from the conversation folder. If preserving fails, the file is NOT removed: it
      // stays at its private path with no check row (so it can never be sent) and is escalated from there.
      let held: QuarantineRef | null = null;
      try {
        held = await quarantineOriginal(admin, {
          source: "message_attachment",
          sourceBucket: ATTACHMENT_BUCKET,
          sourcePath: path,
          uploaderId: userId,
          conversationId,
          bytes: buffer,
          mime: checked.mime,
          categories: verdict.categories,
          suspectedCsam: verdict.csam,
          reason: "Flagged by automated scan",
        });
      } catch {
        held = null;
      }
      if (verdict.csam) {
        await escalate(held?.bucket ?? ATTACHMENT_BUCKET, held?.path ?? path, verdict.categories);
      }
      if (held) await remove();
      throw new Error("That picture can't be sent.");
    }
  }

  // Bind the check to the object that was checked. A different id or version means the file was replaced while we looked.
  const after = await objectNow();
  if (!after || !sameObject(after, expected)) {
    await remove();
    throw new Error(CHANGED);
  }

  const row = {
    path,
    user_id: userId,
    conversation_id: conversationId,
    kind: checked.kind,
    mime: checked.mime,
    bytes: stored.byteLength,
    object_id: after.id,
    object_version: after.version,
  };
  let { error } = await admin.from("message_attachment_checks").upsert(row, { onConflict: "path" });
  if (error && /object_(id|version)/.test(String(error.message ?? ""))) {
    // A database that does not have 20261106120500 yet has no object_id/object_version columns (and no trigger that reads
    // them). Deploy order is app first, so this keeps attachments working until the migration lands; from then on both are stored.
    const { object_id: _omitId, object_version: _omitVersion, ...legacy } = row;
    void _omitId;
    void _omitVersion;
    ({ error } = await admin
      .from("message_attachment_checks")
      .upsert(legacy, { onConflict: "path" }));
  }
  if (error) {
    await remove();
    throw new Error("Could not record the attachment check");
  }
  return {
    ok: true,
    kind: checked.kind,
    mime: checked.mime,
    bytes: stored.byteLength,
    objectId: after.id,
    objectVersion: after.version,
  };
}
