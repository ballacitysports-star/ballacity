import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Account-synced feed preferences. The client keeps localStorage as the
 * offline cache (and the only store for signed-out visitors); these functions
 * mirror the same blob to the signed-in user's row so the setup follows them
 * between devices.
 */
export const getFeedPreferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("feed_preferences")
      .select("prefs, saved_views, updated_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      prefs: (data.prefs ?? {}) as Record<string, unknown>,
      savedViews: (data.saved_views ?? []) as unknown[],
      updatedAt: data.updated_at as string,
    };
  });

export const saveFeedPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { prefs: Record<string, unknown>; savedViews: unknown[] }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).from("feed_preferences").upsert(
      {
        user_id: context.userId,
        prefs: data.prefs,
        saved_views: data.savedViews,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
