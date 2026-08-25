import { createClient } from "@supabase/supabase-js";
import { getRequest } from "@tanstack/react-start/server";
import type { Database } from "@/integrations/supabase/types";

export type FeedPreferencesResult = { prefsJson: string; updatedAt: string } | null;

export async function readFeedPreferencesForRequest(): Promise<FeedPreferencesResult> {
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
}