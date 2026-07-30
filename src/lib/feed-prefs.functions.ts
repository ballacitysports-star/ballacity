import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Account-synced feed preferences. The client keeps localStorage as the
 * offline cache (and the only store for signed-out visitors); these functions
 * mirror the same blob to the signed-in user's row so the setup follows them
 * between devices.
 *
 * The blob crosses the RPC boundary as JSON text so the payload stays a plain
 * serializable string rather than an open-ended record.
 */
export const getFeedPreferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ prefsJson: string; updatedAt: string } | null> => {
    const { data, error } = await (context.supabase as any)
      .from("feed_preferences")
      .select("prefs, saved_views, updated_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const prefs = { ...((data.prefs ?? {}) as object), savedViews: data.saved_views ?? [] };
    return { prefsJson: JSON.stringify(prefs), updatedAt: String(data.updated_at) };
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
    const { error } = await (context.supabase as any).from("feed_preferences").upsert(
      {
        user_id: context.userId,
        prefs: parsed,
        saved_views: savedViews,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
