import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

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
      if (relErr) throw new Error(relErr.message);
      if (!allowed) throw new Error("Not authorized to notify this user");
    }

    const { error } = await supabaseAdmin.from("notifications").insert({
      user_id: data.user_id,
      type: data.type,
      title: data.title,
      body: data.body ?? null,
      link: data.link ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
