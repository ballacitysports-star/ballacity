import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { StaffAccess } from "@/lib/staff";

/**
 * The caller's staff tiers, read through the same security-definer helpers the
 * dashboards enforce. This only chooses navigation; every dashboard still
 * checks its own role on the server.
 */
export const getMyStaffAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StaffAccess> => {
    const [sa, admin, mod] = await Promise.all([
      context.supabase.rpc("is_superadmin", { _user_id: context.userId }),
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
      context.supabase.rpc("is_moderator", { _user_id: context.userId }),
    ]);
    return {
      isSuperadmin: sa.data === true,
      isAdmin: admin.data === true,
      isModerator: mod.data === true,
    };
  });
