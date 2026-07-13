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
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
