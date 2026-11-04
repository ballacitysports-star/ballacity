import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { isConfirmedAdult, shapeNotificationForRecipient } from "@/lib/notification-templates";

const inputSchema = z.object({
  user_id: z.string().uuid(),
  type: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  body: z.string().max(2000).nullable().optional(),
  link: z.string().max(2000).nullable().optional(),
});

export const createNotificationForUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const callerId = context.userId;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.user_id !== callerId) {
      // Verify the caller has a legitimate relationship with the target user
      // before sending them an in-app notification. Asked with the service
      // role: `_caller` is the verified session user, and the database gives
      // a signed-in client a fixed answer for this two-party helper (SEC-2).
      const { data: allowed, error: relErr } = await supabaseAdmin.rpc("can_notify" as any, {
        _caller: callerId,
        _target: data.user_id,
      });
      // A refusal (or a failed check) is not told to the caller: the answer would say whether the
      // target is a minor, has guardian controls, or blocked them. The notification is dropped and
      // the caller gets the same answer as when it is delivered; the refusal is logged here only.
      if (relErr || !allowed) {
        console.warn("[notifications] not delivered", {
          reason: relErr ? "check_failed" : "not_permitted",
          type: data.type,
        });
        return { ok: true };
      }
    }

    // A recipient who is not a confirmed adult gets fixed wording by type, never the caller's text or link.
    const isSelf = data.user_id === callerId;
    const content = shapeNotificationForRecipient(
      { type: data.type, title: data.title, body: data.body ?? null, link: data.link ?? null },
      {
        isSelf,
        isConfirmedAdult: isSelf
          ? true
          : await isConfirmedAdult(supabaseAdmin as any, data.user_id),
      },
    );
    const { error } = await supabaseAdmin.from("notifications").insert({
      user_id: data.user_id,
      type: content.type,
      title: content.title,
      body: content.body,
      link: content.link,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
