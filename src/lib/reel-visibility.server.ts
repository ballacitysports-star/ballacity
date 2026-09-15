/**
 * Server-only helpers for audience-gated public reel reads.
 * Never import this from client code — it is loaded inside server-fn handlers.
 */

import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Best-effort caller identity for otherwise-public server functions.
 *
 * The client bearer attacher sends an Authorization header on every server-fn
 * call, so a signed-in visitor can be recognised here — but a missing or
 * invalid token is not an error, it simply means "anonymous". Reels from
 * 16-17 year olds ('members' audience) are only shown when this returns an id.
 */
export async function optionalSupabaseUserId(): Promise<string | null> {
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return null;

    const request = getRequest();
    const authHeader = request?.headers?.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) return null;

    const client = createClient(url, key, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getClaims(token);
    if (error || !data?.claims?.sub) return null;
    return String(data.claims.sub);
  } catch {
    return null;
  }
}

/**
 * Ids of reels the caller may see, in feed order, gated in SQL by
 * `public.reel_audience()` — never filtered in JS after the fact.
 */
export async function eligibleFeedReelIds(
  admin: any,
  args: { cursor: string | null; sport: string | null; limit: number; includeMembers: boolean },
): Promise<string[]> {
  const { data, error } = await admin.rpc("public_reel_feed_ids", {
    _cursor: args.cursor,
    _sport: args.sport,
    _limit: args.limit,
    _include_members: args.includeMembers,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => String(r.id));
}

/** Ids of one user's reels the caller may see, newest first. */
export async function eligibleUserReelIds(
  admin: any,
  args: { userId: string; limit: number; includeMembers: boolean },
): Promise<string[]> {
  const { data, error } = await admin.rpc("public_user_reel_ids", {
    _user_id: args.userId,
    _limit: args.limit,
    _include_members: args.includeMembers,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => String(r.id));
}
