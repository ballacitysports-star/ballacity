import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

/**
 * Account-synced feed preferences. The client keeps localStorage as the
 * offline cache (and the only store for signed-out visitors); these functions
 * mirror the same blob to the signed-in user's row so the setup follows them
 * between devices.
 *
 * The blob crosses the RPC boundary as JSON text so the payload stays a plain
 * serializable string rather than an open-ended record.
 */
export const getFeedPreferences = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ prefsJson: string; updatedAt: string } | null> => {
    const authHeader = getRequest()?.headers?.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;

    const token = authHeader.replace("Bearer ", "");
    if (!token) return null;

    const supabaseUrl = process.env["SUPABASE_URL"];
    const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!supabaseUrl || !publishableKey) return null;

    const supabase = createClient<Database>(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    const userId = claimsData?.claims?.sub;
    if (claimsError || !userId) return null;

    const { data, error } = await supabase
      .from("feed_preferences")
      .select("prefs, saved_views, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const prefs = { ...((data.prefs ?? {}) as object), savedViews: data.saved_views ?? [] };
    return { prefsJson: JSON.stringify(prefs), updatedAt: String(data.updated_at) };
  },
);

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
        prefs: parsed,
        saved_views: savedViews,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
