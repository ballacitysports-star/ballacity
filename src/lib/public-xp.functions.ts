import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Whether a guardian has chosen to show their child's level and XP publicly. Default off. */
export const getChildPublicXp = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { childUserId: string }) => {
    if (!input?.childUserId) throw new Error("childUserId is required");
    return { childUserId: input.childUserId };
  })
  .handler(async ({ data, context }) => {
    // Row-level security lets a guardian read their child's controls.
    const { data: row } = await context.supabase
      .from("child_controls")
      .select("public_xp")
      .eq("child_user_id", data.childUserId)
      .maybeSingle();
    return { enabled: (row as { public_xp?: boolean } | null)?.public_xp === true };
  });

export const setChildPublicXp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { childUserId: string; enabled: boolean }) => {
    if (!input?.childUserId) throw new Error("childUserId is required");
    return { childUserId: input.childUserId, enabled: input.enabled === true };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // The guardian relationship is verified on the server, never trusted from the UI.
    const { data: ok } = await supabaseAdmin.rpc("is_guardian_of", {
      _parent: context.userId,
      _child: data.childUserId,
    } as never);
    if (ok !== true) throw new Error("Only a verified parent or guardian can change this.");

    const { error } = await supabaseAdmin
      .from("child_controls")
      .upsert({ child_user_id: data.childUserId, public_xp: data.enabled } as never, {
        onConflict: "child_user_id",
      });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("family_audit_log").insert({
      actor_user_id: context.userId,
      child_user_id: data.childUserId,
      action: "child.public_xp_changed",
      context: { enabled: data.enabled },
    } as never);
    return { enabled: data.enabled };
  });
