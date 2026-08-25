import { createClient } from "@supabase/supabase-js";
import { getRequest } from "@tanstack/react-start/server";
import type { Database, Json } from "@/integrations/supabase/types";

export type FeedPreferencesResult = { prefsJson: string; updatedAt: string } | null;

function getServerClientForBearer() {
  const authHeader = getRequest()?.headers?.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.replace("Bearer ", "");
  if (!token) return null;

  const supabaseUrl = process.env["SUPABASE_URL"];
  const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!supabaseUrl || !publishableKey) return null;

  return {
    token,
    supabase: createClient<Database>(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    }),
  };
}

async function getUserScopedClient() {
  const client = getServerClientForBearer();
  if (!client) return null;

  const { data: claimsData, error: claimsError } = await client.supabase.auth.getClaims(
    client.token,
  );
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) return null;

  return { ...client, userId };
}

export async function readFeedPreferencesForRequest(): Promise<FeedPreferencesResult> {
  const client = await getUserScopedClient();
  if (!client) return null;

  const { data, error } = await client.supabase
    .from("feed_preferences")
    .select("prefs, saved_views, updated_at")
    .eq("user_id", client.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const prefs = { ...((data.prefs ?? {}) as object), savedViews: data.saved_views ?? [] };
  return { prefsJson: JSON.stringify(prefs), updatedAt: String(data.updated_at) };
}

export async function writeFeedPreferencesForRequest(prefsJson: string): Promise<{ ok: boolean }> {
  const client = await getUserScopedClient();
  if (!client) return { ok: false };

  const parsed = JSON.parse(prefsJson) as Record<string, unknown>;
  const savedViews = Array.isArray(parsed.savedViews) ? parsed.savedViews : [];
  delete parsed.savedViews;

  const { error } = await client.supabase.from("feed_preferences").upsert(
    {
      user_id: client.userId,
      prefs: parsed as Json,
      saved_views: savedViews,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
  return { ok: true };
}
