import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ATTACHMENT_METADATA_MESSAGE,
  ATTACHMENT_TOO_LARGE_MESSAGE,
  ATTACHMENT_TYPE_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  UNSAFE_ATTACHMENT_MESSAGE,
  attachmentProblem,
  classifyAttachment,
  parseAttachmentPath,
} from "@/lib/message-attachment-validation";

const BUCKET = "message-attachments";

/**
 * Checks an uploaded chat attachment from its stored bytes and, if it passes,
 * records that it did. A message that carries an attachment is accepted by the
 * database only when this record exists for that path, that sender and that
 * conversation, so the check cannot be skipped by calling the API directly.
 *
 * A refused file is deleted. A picture has its location and other personal
 * metadata removed from the stored file first (G3), then goes through the
 * safety scan that profile photos get; an unsafe one is deleted and
 * child-safety escalation runs when the scan says so.
 */
export const finalizeMessageAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { path: string }) => z.object({ path: z.string().min(1).max(500) }).parse(d))
  .handler(async ({ context, data }) => {
    const parsed = parseAttachmentPath(data.path);
    if (!parsed || parsed.senderId !== context.userId.toLowerCase()) {
      throw new Error("You can only finalize your own uploads");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // The sender must be in the conversation they are attaching to.
    const { data: member } = await supabaseAdmin
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", parsed.conversationId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!member) throw new Error("You are not in this conversation");

    const remove = () => supabaseAdmin.storage.from(BUCKET).remove([data.path]);

    const { data: blob, error: dlErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .download(data.path);
    if (dlErr || !blob) throw new Error("Uploaded file could not be read");
    if (blob.size > MAX_ATTACHMENT_BYTES) {
      await remove();
      throw new Error(ATTACHMENT_TOO_LARGE_MESSAGE);
    }
    let buffer: Uint8Array = new Uint8Array(await blob.arrayBuffer());
    const problem = attachmentProblem(buffer);
    const checked = problem ? null : classifyAttachment(buffer);
    if (problem || !checked) {
      await remove();
      throw new Error(problem ?? ATTACHMENT_TYPE_MESSAGE);
    }

    if (checked.kind === "image") {
      // G3: the browser re-encodes only large photos, so a small one arrives with its GPS and camera tags. They come
      // off the stored file before the scan and the check row; a picture that cannot be cleaned is deleted, not sent.
      // Videos and PDFs are stored as sent (their metadata is not handled here).
      const { stripStoredImage } = await import("@/lib/image-metadata.server");
      const stripped = await stripStoredImage(supabaseAdmin, {
        bucket: BUCKET,
        path: data.path,
        bytes: buffer,
        mime: checked.mime,
        cacheControl: "3600",
      });
      if (!stripped.ok) {
        await remove();
        throw new Error(ATTACHMENT_METADATA_MESSAGE);
      }
      buffer = stripped.bytes;
    }

    if (checked.kind === "image") {
      const { scanImageForSafety } = await import("@/lib/image-safety.server");
      let target: string | null;
      if (buffer.byteLength <= 4 * 1024 * 1024) {
        let binary = "";
        for (let i = 0; i < buffer.length; i += 0x8000) {
          binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
        }
        target = `data:${checked.mime};base64,${btoa(binary)}`;
      } else {
        const { imageObjectUrl } = await import("@/lib/image-moderation.server");
        target = await imageObjectUrl(supabaseAdmin, BUCKET, data.path);
      }
      const verdict = target
        ? await scanImageForSafety(target, { userId: context.userId })
        : { safe: true, csam: false, categories: [] as string[] };
      if (!verdict.safe) {
        await remove();
        if (verdict.csam) {
          const { escalateImageForChildSafety } = await import("@/lib/ai/moderation.server");
          await escalateImageForChildSafety(supabaseAdmin, {
            bucket: BUCKET,
            path: data.path,
            categories: verdict.categories,
            source: "image_upload",
          });
        }
        throw new Error(UNSAFE_ATTACHMENT_MESSAGE);
      }
    }

    const { error } = await supabaseAdmin.from("message_attachment_checks" as never).upsert(
      {
        path: data.path,
        user_id: context.userId,
        conversation_id: parsed.conversationId,
        kind: checked.kind,
        mime: checked.mime,
        bytes: buffer.byteLength,
      } as never,
      { onConflict: "path" },
    );
    if (error) {
      await remove();
      throw new Error("Could not record the attachment check");
    }
    return { ok: true as const, kind: checked.kind, mime: checked.mime, bytes: buffer.byteLength };
  });
