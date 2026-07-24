import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Permanently delete the currently authenticated user's account.
 *
 * Related linked profile rows (teams, trainer_orgs, player_availabilities, etc.)
 * are removed via ON DELETE CASCADE from auth.users, or via the existing
 * account-type triggers. This uses the Supabase Admin API to delete the auth user.
 */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
