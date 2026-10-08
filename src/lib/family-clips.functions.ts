import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { familyClipVia, teamShareErrorMessage, type FamilyClipVia } from "@/lib/family-clips";

/**
 * Who besides the parent can watch a family post: the linked child (read-only) and
 * the members and staff of ONE team the parent chose. Every read goes through the
 * database check family_post_viewer_access(), which runs each time, so leaving the
 * team, a safety hold, an ended guardian link or a switch turned off stops access
 * at once. Nothing here widens row-level security or storage access.
 */

export type FamilyClipSummary = {
  id: string;
  title: string;
  caption: string | null;
  createdAt: string;
  via: FamilyClipVia;
};

/** The guardian's per-child opt-in for a reel's child. Off on any doubt. */
async function childAllows(supabase: any, userId: string, reelId: string | undefined, kind: "link" | "team") {
  if (!reelId) return true;
  const { data: reel } = await supabase
    .from("highlight_reels")
    .select("subject_child_id")
    .eq("id", reelId)
    .eq("user_id", userId)
    .maybeSingle();
  const childId = (reel as { subject_child_id?: string | null } | null)?.subject_child_id;
  if (!childId) return false;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.rpc("family_child_allows" as never, {
    _child: childId,
    _kind: kind,
  } as never);
  return data === true;
}

/**
 * What a viewer may do with a family post: the database check for the linked child
 * and the chosen team, plus the parent who added it while they are still a verified
 * guardian and the clip is live. Anything else, or any doubt, is 'none'.
 */
async function clipAccess(admin: any, reelId: string, viewerId: string): Promise<FamilyClipVia | null> {
  const { data: access } = await admin.rpc("family_post_viewer_access" as never, {
    _reel_id: reelId,
    _viewer: viewerId,
  } as never);
  const via = familyClipVia(access);
  if (via) return via;
  const { data: r } = await admin
    .from("highlight_reels")
    .select("user_id,subject_child_id,status,hidden_at")
    .eq("id", reelId)
    .maybeSingle();
  const row = r as { user_id: string; subject_child_id: string | null; status: string; hidden_at: string | null } | null;
  if (!row || row.user_id !== viewerId || !row.subject_child_id) return null;
  if (row.status !== "completed" || row.hidden_at) return null;
  const { data: ok } = await admin.rpc("is_guardian_of", {
    _parent: viewerId,
    _child: row.subject_child_id,
  } as never);
  return ok === true ? "owner" : null;
}

/** Whether choosing a team is switched on. Off on any doubt. */
export const getTeamShareEnabled = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reelId?: string } | undefined) => ({ reelId: input?.reelId }))
  .handler(async ({ data: input, context }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin.rpc("family_team_share_enabled" as never);
      const allowed = data === true && (await childAllows(context.supabase, context.userId, input.reelId, "team"));
      return { enabled: allowed };
    } catch {
      return { enabled: false };
    }
  });

/** The teams the parent can pick for one of their family posts, and the current pick. */
export const listFamilyPostTeams = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reelId: string }) => {
    if (!input?.reelId) throw new Error("reelId is required");
    return { reelId: input.reelId };
  })
  .handler(async ({ data, context }) => {
    const { data: reel, error } = await context.supabase
      .from("highlight_reels")
      .select("subject_child_id,team_share_team_id")
      .eq("id", data.reelId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const childId = (reel as { subject_child_id?: string | null } | null)?.subject_child_id;
    if (!reel || !childId) return { selected: null as string | null, teams: [] as TeamChoice[] };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: memberships } = await supabaseAdmin
      .from("team_members")
      .select("team_id")
      .eq("user_id", childId);
    const ids = Array.from(new Set(((memberships ?? []) as any[]).map((m) => String(m.team_id))));
    let teams: TeamChoice[] = [];
    if (ids.length > 0) {
      const { data: rows } = await supabaseAdmin
        .from("teams")
        .select("id,name")
        .in("id", ids)
        .is("hidden_at", null);
      teams = ((rows ?? []) as any[]).map((t) => ({ id: String(t.id), name: String(t.name) }));
    }
    return {
      selected: ((reel as { team_share_team_id?: string | null }).team_share_team_id ?? null) as
        | string
        | null,
      teams,
    };
  });

type TeamChoice = { id: string; name: string };

/** Picks the one team that may watch a family post, or clears it (private again). */
export const setFamilyPostTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reelId: string; teamId: string | null }) => {
    if (!input?.reelId) throw new Error("reelId is required");
    return { reelId: input.reelId, teamId: input.teamId ? String(input.teamId) : null };
  })
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("highlight_reels")
      .update({ team_share_team_id: data.teamId } as never)
      .eq("id", data.reelId)
      .eq("user_id", context.userId)
      .select("subject_child_id")
      .maybeSingle();
    if (error) throw new Error(teamShareErrorMessage(error) ?? "Could not update who can watch");
    const childId = (row as { subject_child_id?: string | null } | null)?.subject_child_id;
    if (!row || !childId) throw new Error("Only the parent who added this clip can change this.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("family_audit_log").insert({
      actor_user_id: context.userId,
      child_user_id: childId,
      action: data.teamId ? "family_post.team_shared" : "family_post.team_unshared",
      context: data.teamId ? { team_id: data.teamId } : {},
    } as never);
    return { teamId: data.teamId };
  });

/** Whether a child may watch the family clips their parent adds of them. Default on. */
export const getChildFamilyView = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { childUserId: string }) => {
    if (!input?.childUserId) throw new Error("childUserId is required");
    return { childUserId: input.childUserId };
  })
  .handler(async ({ data, context }) => {
    // Row-level security lets a guardian read their child's controls.
    const { data: row } = await context.supabase
      .from("child_controls")
      .select("family_posts_child_view")
      .eq("child_user_id", data.childUserId)
      .maybeSingle();
    const v = (row as { family_posts_child_view?: boolean } | null)?.family_posts_child_view;
    return { enabled: v !== false };
  });

export const setChildFamilyView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { childUserId: string; enabled: boolean }) => {
    if (!input?.childUserId) throw new Error("childUserId is required");
    return { childUserId: input.childUserId, enabled: input.enabled === true };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // The guardian relationship is verified on the server, never trusted from the UI.
    const { data: ok } = await supabaseAdmin.rpc("is_guardian_of", {
      _parent: context.userId,
      _child: data.childUserId,
    } as never);
    if (ok !== true) throw new Error("Only a verified parent or guardian can change this.");

    const { error } = await supabaseAdmin
      .from("child_controls")
      .upsert(
        { child_user_id: data.childUserId, family_posts_child_view: data.enabled } as never,
        { onConflict: "child_user_id" },
      );
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("family_audit_log").insert({
      actor_user_id: context.userId,
      child_user_id: data.childUserId,
      action: "family_post.child_view_changed",
      context: { enabled: data.enabled },
    } as never);
    return { enabled: data.enabled };
  });

/** The guardian's two opt-ins for sharing clips of this child. Both default off. */
export const getChildFamilySharing = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { childUserId: string }) => {
    if (!input?.childUserId) throw new Error("childUserId is required");
    return { childUserId: input.childUserId };
  })
  .handler(async ({ data, context }) => {
    // Row-level security lets a guardian read their child's controls.
    const { data: row } = await context.supabase
      .from("child_controls")
      .select("family_posts_link_sharing,family_posts_team_sharing")
      .eq("child_user_id", data.childUserId)
      .maybeSingle();
    const r = row as { family_posts_link_sharing?: boolean; family_posts_team_sharing?: boolean } | null;
    return { links: r?.family_posts_link_sharing === true, team: r?.family_posts_team_sharing === true };
  });

/**
 * Turns private links or team sharing on or off for one child. Turning one off also
 * ends what it allowed: active links are revoked and clips are taken off the team.
 */
export const setChildFamilySharing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { childUserId: string; kind: "link" | "team"; enabled: boolean }) => {
    if (!input?.childUserId) throw new Error("childUserId is required");
    if (input.kind !== "link" && input.kind !== "team") throw new Error("Unknown setting");
    return { childUserId: input.childUserId, kind: input.kind, enabled: input.enabled === true };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ok } = await supabaseAdmin.rpc("is_guardian_of", {
      _parent: context.userId,
      _child: data.childUserId,
    } as never);
    if (ok !== true) throw new Error("Only a verified parent or guardian can change this.");

    const column = data.kind === "link" ? "family_posts_link_sharing" : "family_posts_team_sharing";
    const { error } = await supabaseAdmin
      .from("child_controls")
      .upsert({ child_user_id: data.childUserId, [column]: data.enabled } as never, {
        onConflict: "child_user_id",
      });
    if (error) throw new Error(error.message);

    if (!data.enabled) {
      const { data: reels } = await supabaseAdmin
        .from("highlight_reels")
        .select("id")
        .eq("subject_child_id", data.childUserId);
      const ids = ((reels ?? []) as { id: string }[]).map((r) => r.id);
      if (ids.length > 0) {
        if (data.kind === "link") {
          await supabaseAdmin
            .from("family_post_links" as never)
            .update({ revoked_at: new Date().toISOString() } as never)
            .in("reel_id", ids)
            .is("revoked_at", null);
        } else {
          await supabaseAdmin
            .from("highlight_reels")
            .update({ team_share_team_id: null } as never)
            .in("id", ids);
        }
      }
    }

    await supabaseAdmin.from("family_audit_log").insert({
      actor_user_id: context.userId,
      child_user_id: data.childUserId,
      action: "family_post.sharing_changed",
      context: { kind: data.kind, enabled: data.enabled },
    } as never);
    return { ok: true };
  });

/** The family clips the signed-in member may watch: their own, and their team's. */
export const listFamilyClips = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FamilyClipSummary[]> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin.rpc("family_posts_visible_to" as never, {
        _viewer: context.userId,
      } as never);
      if (error) return [];
      const out: FamilyClipSummary[] = [];
      for (const r of (data ?? []) as any[]) {
        const via = familyClipVia(r.via);
        if (!via) continue;
        out.push({
          id: String(r.reel_id),
          title: String(r.title ?? "Clip").slice(0, 120),
          caption: r.caption ? String(r.caption).slice(0, 500) : null,
          createdAt: String(r.created_at),
          via,
        });
      }
      return out;
    } catch {
      return [];
    }
  });

export type FamilyClip =
  | { found: false }
  | {
      found: true;
      title: string;
      caption: string | null;
      via: FamilyClipVia;
      videoUrl: string;
      fallbackVideoUrl: string | null;
      thumbnailUrl: string | null;
    };

/** One clip for a permitted viewer, with short-lived signed file links. */
export const getFamilyClip = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { reelId: string }) => {
    if (!input?.reelId) throw new Error("reelId is required");
    return { reelId: input.reelId };
  })
  .handler(async ({ data, context }): Promise<FamilyClip> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { quarantinedMediaPaths, signablePath } = await import(
        "@/lib/reel-visibility.server"
      );
      const { ownedMediaPathOrNull } = await import("@/lib/media-path-guard");

      const via = await clipAccess(supabaseAdmin, data.reelId, context.userId);
      if (!via) return { found: false };

      const { data: r } = await supabaseAdmin
        .from("highlight_reels")
        .select("user_id,title,ai_title,ai_caption,video_path,playback_path,thumbnail_path")
        .eq("id", data.reelId)
        .maybeSingle();
      if (!r) return { found: false };
      const row = r as any;
      const owner = row.user_id as string;

      const quarantined = await quarantinedMediaPaths(supabaseAdmin, [
        row.playback_path,
        row.video_path,
        row.thumbnail_path,
      ]);
      const primary = signablePath(
        ownedMediaPathOrNull(owner, row.playback_path ?? row.video_path),
        quarantined,
      );
      const original = row.playback_path
        ? signablePath(ownedMediaPathOrNull(owner, row.video_path), quarantined)
        : null;
      const thumb = signablePath(ownedMediaPathOrNull(owner, row.thumbnail_path), quarantined);
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
        title: String(row.ai_title || row.title || "Clip").slice(0, 120),
        caption: row.ai_caption ? String(row.ai_caption).slice(0, 500) : null,
        via,
        videoUrl,
        fallbackVideoUrl,
        thumbnailUrl,
      };
    } catch {
      return { found: false };
    }
  });

/**
 * The family clips of one child that the signed-in member may watch: the parent's own,
 * the child's own view, and clips shared with a team they are on. Empty for anyone else.
 */
export const listFamilyClipsAboutChild = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { childUserId: string }) => {
    if (!input?.childUserId) throw new Error("childUserId is required");
    return { childUserId: input.childUserId };
  })
  .handler(async ({ data, context }): Promise<FamilyClipSummary[]> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: reels } = await supabaseAdmin
        .from("highlight_reels")
        .select("id,title,ai_title,ai_caption,created_at")
        .eq("subject_child_id", data.childUserId)
        .eq("status", "completed")
        .is("hidden_at", null)
        .order("created_at", { ascending: false })
        .limit(50);
      const out: FamilyClipSummary[] = [];
      for (const r of (reels ?? []) as any[]) {
        const via = await clipAccess(supabaseAdmin, String(r.id), context.userId);
        if (!via) continue;
        out.push({
          id: String(r.id),
          title: String(r.ai_title || r.title || "Clip").slice(0, 120),
          caption: r.ai_caption ? String(r.ai_caption).slice(0, 500) : null,
          createdAt: String(r.created_at),
          via,
        });
      }
      return out;
    } catch {
      return [];
    }
  });
