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

/**
 * Paths in the highlight-videos bucket that are quarantined for child safety.
 *
 * RLS blocks quarantined objects for every signed-in reader, but service-role
 * code bypasses RLS, so every admin-side signing path must consult this first.
 * Fails closed: if the check itself errors, all candidate paths are treated as
 * quarantined and no URL is signed.
 */
export async function quarantinedMediaPaths(
  admin: any,
  paths: (string | null | undefined)[],
): Promise<Set<string>> {
  const candidates = Array.from(new Set(paths.filter((p): p is string => !!p)));
  if (candidates.length === 0) return new Set();
  try {
    const { data, error } = await admin
      .from("image_moderation")
      .select("path")
      .eq("bucket", "highlight-videos")
      .eq("status", "quarantined")
      .in("path", candidates);
    if (error) throw new Error(error.message);
    return new Set(((data ?? []) as any[]).map((r) => String(r.path)));
  } catch {
    return new Set(candidates);
  }
}

/** Owner-scoped path that is safe to sign, or null when missing or quarantined. */
export function signablePath(path: string | null, quarantined: Set<string>): string | null {
  if (!path) return null;
  return quarantined.has(path) ? null : path;
}
