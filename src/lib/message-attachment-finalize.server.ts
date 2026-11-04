/* eslint-disable @typescript-eslint/no-explicit-any -- the storage/database client is faked structurally in tests */
import { stripStoredImage } from "@/lib/image-metadata.server";
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
  escalate: (path: string, categories: string[]) => Promise<void>;
};

export type AttachmentFinalizeResult = {
  ok: true;
  kind: AttachmentKind;
  mime: string;
  bytes: number;
  objectId: string;
};

const CHANGED = "The file changed while it was being checked. Please attach it again.";

/**
 * Check a stored chat attachment and record the check, bound to the exact storage object that was checked.
 *
 * The check row stores the object's `storage.objects.id`, and the message-insert trigger
 * (supabase/migrations/20261106120500_attachment_check_binding.sql) accepts the message only while that same object is still
 * at the path. A sender can delete their own unsent file and upload another at the same path (msg_attach_delete_sender), but
 * the new object has a new id, so a check made on the first file never vouches for the second. The id is read before the
 * bytes are downloaded and again after every check; if it moved in between, nothing is recorded.
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
  const objectIdNow = async (): Promise<string | null> => {
    const { data, error } = await bucket.info(path);
    return error || !data?.id ? null : String(data.id);
  };

  const before = await objectIdNow();
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
  let expected: string | null = before;
  if (checked.kind === "image" && /^image\/(jpeg|png|webp)$/.test(checked.mime)) {
    // Location and device tags are removed from the stored picture before the recipient or a scanner sees it.
    try {
      const out = await stripStoredImage(admin, ATTACHMENT_BUCKET, path, buffer, checked.mime);
      stored = out.bytes;
      if (out.rewritten) expected = out.objectId; // null (Storage did not say) fails closed below
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
      await remove();
      if (verdict.csam) await escalate(path, verdict.categories);
      throw new Error("That picture can't be sent.");
    }
  }

  // Bind the check to the object that was checked. A different id here means the file was replaced while we looked.
  const after = await objectIdNow();
  if (!after || !expected || after !== expected) {
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
    object_id: after,
  };
  let { error } = await admin.from("message_attachment_checks").upsert(row, { onConflict: "path" });
  if (error && /object_id/.test(String(error.message ?? ""))) {
    // A database that does not have 20261106120500 yet has no object_id column (and no trigger that reads it). Deploy order
    // is app first, so this keeps attachments working until the migration lands; from then on the id is stored.
    const { object_id: _omit, ...legacy } = row;
    void _omit;
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
    objectId: after,
  };
}
