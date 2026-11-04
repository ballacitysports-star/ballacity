import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseAttachmentPath } from "@/lib/message-attachment-validation";

/**
 * Checks an uploaded chat attachment from its stored bytes and, if it passes,
 * records that it did. A message that carries an attachment is accepted by the
 * database only when this record exists for that path, that sender and that
 * conversation, so the check cannot be skipped by calling the API directly.
 *
 * A refused file is deleted. A picture also goes through the safety scan that
 * profile photos get; an unsafe one is moved to the restricted quarantine
 * (never simply deleted: it is evidence) and child-safety escalation runs
 * when the scan says so. The record is bound to the storage object that was
 * checked (see finalizeAttachment), so replacing the file at the same path
 * afterwards does not carry the check over.
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

    const { finalizeAttachment } = await import("@/lib/message-attachment-finalize.server");
    const { scanImageForSafety } = await import("@/lib/image-safety.server");
    const out = await finalizeAttachment(
      {
        admin: supabaseAdmin,
        scan: (target, userId) => scanImageForSafety(target, { userId }),
        escalate: async (bucket, path, categories) => {
          const { escalateImageForChildSafety } = await import("@/lib/ai/moderation.server");
          await escalateImageForChildSafety(supabaseAdmin, {
            bucket,
            path,
            categories,
            source: "image_upload",
          });
        },
      },
      { userId: context.userId, conversationId: parsed.conversationId, path: data.path },
    );
    return { ok: true as const, kind: out.kind, mime: out.mime, bytes: out.bytes };
  });
