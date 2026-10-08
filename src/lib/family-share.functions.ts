import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  generateShareToken,
  hashShareToken,
  isPlausibleShareToken,
  normalizeShareDays,
  shareErrorMessage,
} from "@/lib/family-share";

/**
 * Private share links for family posts (see 20261008160000_family_post_links.sql).
 * Every rule is enforced in the database; this layer creates links, lists the
 * parent's own, revokes them, and serves the one public page they open.
 */

export type FamilyShareLink = {
  id: string;
  expiresAt: string;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
};

/** Whether the share-link switch (and family posts) are on. Off on any doubt. */
export const getFamilyShareEnabled = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin.rpc("family_share_enabled" as never);
      return { enabled: data === true };
    } catch {
      return { enabled: false };
    }
  });

export const listFamilyPostLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reelId: string }) => {
    if (!input?.reelId) throw new Error("reelId is required");
    return { reelId: input.reelId };
  })
  .handler(async ({ data, context }): Promise<FamilyShareLink[]> => {
    // Row-level security returns only links this member created.
    const { data: rows, error } = await context.supabase
      .from("family_post_links" as never)
      .select("id,expires_at,revoked_at,view_count,last_viewed_at,created_at")
      .eq("reel_id", data.reelId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return ((rows ?? []) as any[]).map((r) => ({
      id: r.id as string,
      expiresAt: r.expires_at as string,
      revokedAt: (r.revoked_at as string | null) ?? null,
      viewCount: Number(r.view_count) || 0,
      lastViewedAt: (r.last_viewed_at as string | null) ?? null,
      createdAt: r.created_at as string,
    }));
  });

/**
 * Creates a link to one of the caller's own family posts. The secret is returned
 * once and never stored; only its hash is.
 */
export const createFamilyPostLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reelId: string; days?: number }) => {
    if (!input?.reelId) throw new Error("reelId is required");
    return { reelId: input.reelId, days: normalizeShareDays(input.days) };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // The caller must own a family post; the database re-checks guardianship.
    const { data: reel, error: readErr } = await context.supabase
      .from("highlight_reels")
      .select("id,subject_child_id")
      .eq("id", data.reelId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    const childId = (reel as { subject_child_id?: string | null } | null)?.subject_child_id;
    if (!reel || !childId) throw new Error("Only the parent who added this clip can share it.");

    const token = generateShareToken();
    const expiresAt = new Date(Date.now() + data.days * 24 * 60 * 60 * 1000).toISOString();
    const { data: row, error } = await supabaseAdmin
      .from("family_post_links" as never)
      .insert({
        reel_id: data.reelId,
        created_by: context.userId,
        token_hash: await hashShareToken(token),
        expires_at: expiresAt,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(shareErrorMessage(error) ?? "Could not create the link");

    // Visible to the family in the activity trail.
    await supabaseAdmin.from("family_audit_log").insert({
      actor_user_id: context.userId,
      child_user_id: childId,
      action: "family_post.link_created",
      context: { days: data.days },
    } as never);

    return { id: (row as { id: string }).id, token, expiresAt };
  });

export const revokeFamilyPostLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { linkId: string }) => {
    if (!input?.linkId) throw new Error("linkId is required");
    return { linkId: input.linkId };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: link, error } = await supabaseAdmin
      .from("family_post_links" as never)
      .update({ revoked_at: new Date().toISOString() } as never)
      .eq("id", data.linkId)
      .eq("created_by", context.userId)
      .is("revoked_at", null)
      .select("reel_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!link) return { revoked: false };

    const { data: reel } = await supabaseAdmin
      .from("highlight_reels")
      .select("subject_child_id")
      .eq("id", (link as { reel_id: string }).reel_id)
      .maybeSingle();
    const childId = (reel as { subject_child_id?: string | null } | null)?.subject_child_id;
    if (childId) {
      await supabaseAdmin.from("family_audit_log").insert({
        actor_user_id: context.userId,
        child_user_id: childId,
        action: "family_post.link_revoked",
        context: {},
      } as never);
    }
    return { revoked: true };
  });

export type SharedFamilyPost =
  | { found: false }
  | {
      found: true;
      title: string;
      caption: string | null;
      videoUrl: string | null;
      fallbackVideoUrl: string | null;
      thumbnailUrl: string | null;
    };

/**
 * Public: opens the single clip a share link points to, or reports nothing found
 * (never why: revoked, expired, held and unknown links look identical). Returns no
 * child name, no owner and no profile.
 */
export const getSharedFamilyPost = createServerFn({ method: "GET" })
  .inputValidator((input: { token: string }) => ({
    token: isPlausibleShareToken(input?.token) ? input.token : "",
  }))
  .handler(async ({ data }): Promise<SharedFamilyPost> => {
    if (!data.token) return { found: false };
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { quarantinedMediaPaths, signablePath } = await import(
        "@/lib/reel-visibility.server"
      );
      const { ownedMediaPathOrNull } = await import("@/lib/media-path-guard");

      const { data: rows, error } = await supabaseAdmin.rpc("resolve_family_post_link" as never, {
        _token_hash: await hashShareToken(data.token),
      } as never);
      if (error) return { found: false };
      const r = ((rows ?? []) as any[])[0];
      if (!r) return { found: false };

      const owner = r.owner_id as string;
      const quarantined = await quarantinedMediaPaths(supabaseAdmin, [
        r.playback_path,
        r.video_path,
        r.thumbnail_path,
      ]);
      const primary = signablePath(
        ownedMediaPathOrNull(owner, r.playback_path ?? r.video_path),
        quarantined,
      );
      const original = r.playback_path
        ? signablePath(ownedMediaPathOrNull(owner, r.video_path), quarantined)
        : null;
      const thumb = signablePath(ownedMediaPathOrNull(owner, r.thumbnail_path), quarantined);
      if (!primary) return { found: false };

      const sign = async (p: string | null) =>
        p
          ? ((await supabaseAdmin.storage.from("highlight-videos").createSignedUrl(p, 3600)).data
              ?.signedUrl ?? null)
          : null;
      const [videoUrl, fallbackVideoUrl, thumbnailUrl] = await Promise.all([
        sign(primary),
        sign(original),
        sign(thumb),
      ]);
      if (!videoUrl) return { found: false };

      return {
        found: true,
        title: String(r.title ?? "Highlight").slice(0, 120),
        caption: r.caption ? String(r.caption).slice(0, 500) : null,
        videoUrl,
        fallbackVideoUrl,
        thumbnailUrl,
      };
    } catch {
      return { found: false };
    }
  });
