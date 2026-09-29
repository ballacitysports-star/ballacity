import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Permanently delete the currently authenticated user's account.
 *
 * The erase itself lives in `purgeUserAccount` so a guardian deleting a
 * managed child runs exactly the same steps.
 */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { purgeUserAccount } = await import("@/lib/account-purge.server");
    await purgeUserAccount(userId);
    return { ok: true };
  });
