import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

/**
 * Account-synced feed preferences. The client keeps localStorage as the
 * offline cache (and the only store for signed-out visitors); these functions
 * mirror the same blob to the signed-in user's row so the setup follows them
 * between devices.
 *
 * The blob crosses the RPC boundary as JSON text so the payload stays a plain
 * serializable string rather than an open-ended record.
 */
export const getFeedPreferences = createServerFn({ method: "GET" }).handler(async () => {
  const { readFeedPreferencesForRequest } = await import("@/lib/feed-prefs.server");
  return readFeedPreferencesForRequest();
});

export const saveFeedPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { prefsJson: string }) => {
    if (typeof input?.prefsJson !== "string" || input.prefsJson.length > 100_000) {
      throw new Error("Invalid feed preferences payload");
    }
    return input;
  })
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const parsed = JSON.parse(data.prefsJson) as Record<string, unknown>;
    const savedViews = Array.isArray(parsed.savedViews) ? parsed.savedViews : [];
    delete parsed.savedViews;
    const { error } = await context.supabase.from("feed_preferences").upsert(
      {
        user_id: context.userId,
        prefs: parsed as Json,
        saved_views: savedViews,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
