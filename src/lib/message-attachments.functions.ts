import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  MAX_ATTACHMENT_BYTES,
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
 * A refused file is deleted. A picture also goes through the safety scan that
 * profile photos get; an unsafe one is deleted and child-safety escalation runs
 * when the scan says so.
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
      throw new Error("Attachment too large (max 20MB).");
    }
    const buffer = new Uint8Array(await blob.arrayBuffer());
    const problem = attachmentProblem(buffer);
    const checked = problem ? null : classifyAttachment(buffer);
    if (problem || !checked) {
      await remove();
      throw new Error(problem ?? "That file type is not allowed.");
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
        throw new Error("That picture can't be sent.");
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
