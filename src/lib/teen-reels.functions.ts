import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { teenReelErrorMessage, teenReelState, type TeenReelState } from "@/lib/reel-privacy";

/**
 * A guardian's view and controls for a 13-15 player's reels.
 *
 * Reels from ages 13 to 15 are never public or member-wide. They stay with the player
 * and their verified guardian unless a guardian approves ONE team the player is on.
 * Every call here checks, on the server, that the caller is a verified guardian of this
 * child and that the child is currently 13-15; the database then re-checks everything
 * on the write (guard_teen_reel_team) and on every read (teen_reel_viewer_access).
 * Players cannot approve anything themselves.
 */

type Admin = any;

async function admin(): Promise<Admin> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Throws unless `actor` is a verified guardian of `childId` and the child is 13-15. */
async function assertGuardianOfTeen(a: Admin, actor: string, childId: string) {
  const { data: ok } = await a.rpc("is_guardian_of", { _parent: actor, _child: childId } as never);
  if (ok !== true) throw new Error("Only a verified parent or guardian can do this.");
  const { data: cohort } = await a.rpc("age_cohort_of", { _user: childId } as never);
  if (cohort !== "teen_13_15") {
    throw new Error("Reel approvals are for players aged 13 to 15.");
  }
}

async function ownedReel(a: Admin, childId: string, reelId: string) {
  const { data } = await a
    .from("highlight_reels")
    .select("id,user_id,subject_child_id")
    .eq("id", reelId)
    .eq("user_id", childId)
    .is("subject_child_id", null)
    .maybeSingle();
  if (!data) throw new Error("That reel isn't available.");
  return data as { id: string; user_id: string };
}

export type TeenReelRow = {
  id: string;
  title: string;
  status: string;
  isDraft: boolean;
  onHold: boolean;
  createdAt: string;
  state: TeenReelState;
  teamId: string | null;
  teamName: string | null;
  approvedAt: string | null;
};

export type TeenReelTeam = { teamId: string; name: string };

export const listTeenReels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { childUserId: string }) => {
    if (!input?.childUserId) throw new Error("childUserId is required");
    return { childUserId: input.childUserId };
  })
  .handler(async ({ data, context }): Promise<{ reels: TeenReelRow[]; teams: TeenReelTeam[] }> => {
    const a = await admin();
    await assertGuardianOfTeen(a, context.userId, data.childUserId);

    const [{ data: reels }, { data: members }] = await Promise.all([
      a
        .from("highlight_reels")
        .select(
          "id,title,ai_title,status,is_draft,hidden_at,created_at,team_share_team_id,guardian_team_approved_by,guardian_team_approved_at",
        )
        .eq("user_id", data.childUserId)
        .is("subject_child_id", null)
        .order("created_at", { ascending: false })
        .limit(50),
      a.from("team_members").select("team_id, teams(id, name, hidden_at)").eq("user_id", data.childUserId).limit(30),
    ]);

    const teams: TeenReelTeam[] = [];
    for (const m of (members ?? []) as any[]) {
      const t = m.teams;
      if (t && !t.hidden_at) teams.push({ teamId: String(t.id), name: String(t.name ?? "Team") });
    }
    const nameOf = new Map(teams.map((t) => [t.teamId, t.name]));

    return {
      teams,
      reels: ((reels ?? []) as any[]).map((r) => ({
        id: String(r.id),
        title: String(r.ai_title || r.title || "Reel"),
        status: String(r.status),
        isDraft: r.is_draft === true,
        onHold: !!r.hidden_at,
        createdAt: String(r.created_at),
        state: teenReelState(r),
        teamId: r.team_share_team_id ?? null,
        teamName: r.team_share_team_id ? (nameOf.get(String(r.team_share_team_id)) ?? "Team") : null,
        approvedAt: r.guardian_team_approved_at ?? null,
      })),
    };
  });

export type TeenReelPlayback =
  | { found: false }
  | { found: true; videoUrl: string; fallbackVideoUrl: string | null; thumbnailUrl: string | null };

/** Signed links so a guardian can watch a reel before deciding. */
export const getTeenReelPlayback = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { childUserId: string; reelId: string }) => {
    if (!input?.childUserId || !input?.reelId) throw new Error("childUserId and reelId are required");
    return { childUserId: input.childUserId, reelId: input.reelId };
  })
  .handler(async ({ data, context }): Promise<TeenReelPlayback> => {
    try {
      const a = await admin();
      await assertGuardianOfTeen(a, context.userId, data.childUserId);
      await ownedReel(a, data.childUserId, data.reelId);
      // The database says whether this caller may watch it right now (safety hold, lock).
      const { data: access } = await a.rpc("teen_reel_viewer_access", {
        _reel_id: data.reelId,
        _viewer: context.userId,
      } as never);
      if (access !== "guardian") return { found: false };

      const { quarantinedMediaPaths, signablePath } = await import("@/lib/reel-visibility.server");
      const { ownedMediaPathOrNull } = await import("@/lib/media-path-guard");
      const { data: r } = await a
        .from("highlight_reels")
        .select("user_id,video_path,playback_path,thumbnail_path")
        .eq("id", data.reelId)
        .maybeSingle();
      if (!r) return { found: false };
      const row = r as any;
      const owner = row.user_id as string;
      const quarantined = await quarantinedMediaPaths(a, [row.playback_path, row.video_path, row.thumbnail_path]);
      const primary = signablePath(ownedMediaPathOrNull(owner, row.playback_path ?? row.video_path), quarantined);
      const original = row.playback_path
        ? signablePath(ownedMediaPathOrNull(owner, row.video_path), quarantined)
        : null;
      const thumb = signablePath(ownedMediaPathOrNull(owner, row.thumbnail_path), quarantined);
      if (!primary) return { found: false };
      const sign = async (p: string | null) =>
        p ? ((await a.storage.from("highlight-videos").createSignedUrl(p, 3600)).data?.signedUrl ?? null) : null;
      const [videoUrl, fallbackVideoUrl, thumbnailUrl] = await Promise.all([sign(primary), sign(original), sign(thumb)]);
      return videoUrl ? { found: true, videoUrl, fallbackVideoUrl, thumbnailUrl } : { found: false };
    } catch {
      return { found: false };
    }
  });

/**
 * Approve one of the child's teams for a reel, or pass teamId: null to take it back to
 * guardian-only. The database refuses anything that is not a verified guardian acting
 * for a posted, unheld reel and a team the child is on.
 */
export const setTeenReelTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { childUserId: string; reelId: string; teamId: string | null }) => {
    if (!input?.childUserId || !input?.reelId) throw new Error("childUserId and reelId are required");
    return { childUserId: input.childUserId, reelId: input.reelId, teamId: input.teamId || null };
  })
  .handler(async ({ data, context }) => {
    const a = await admin();
    await assertGuardianOfTeen(a, context.userId, data.childUserId);
    await ownedReel(a, data.childUserId, data.reelId);

    const patch = data.teamId
      ? { team_share_team_id: data.teamId, guardian_team_approved_by: context.userId, guardian_team_approved_at: null }
      : { team_share_team_id: null, guardian_team_approved_by: null, guardian_team_approved_at: null };
    const { error } = await a.from("highlight_reels").update(patch as never).eq("id", data.reelId);
    if (error) throw new Error(teenReelErrorMessage(error.message) ?? "Could not save this choice");

    await a.from("family_audit_log").insert({
      actor_user_id: context.userId,
      child_user_id: data.childUserId,
      action: data.teamId ? "teen_reel.team_approved" : "teen_reel.team_revoked",
      context: { team_id: data.teamId },
    } as never);
    return { state: (data.teamId ? "team" : "guardian") as TeenReelState };
  });

/** A guardian deletes a reel and its files. Always allowed for a verified guardian of a 13-15 player. */
export const deleteTeenReel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { childUserId: string; reelId: string }) => {
    if (!input?.childUserId || !input?.reelId) throw new Error("childUserId and reelId are required");
    return { childUserId: input.childUserId, reelId: input.reelId };
  })
  .handler(async ({ data, context }) => {
    const a = await admin();
    await assertGuardianOfTeen(a, context.userId, data.childUserId);
    await ownedReel(a, data.childUserId, data.reelId);

    const { data: reel } = await a
      .from("highlight_reels")
      .select("video_path,playback_path,thumbnail_path,audio_path,frame_paths")
      .eq("id", data.reelId)
      .maybeSingle();
    const r = (reel ?? {}) as any;
    const paths = [r.video_path, r.playback_path, r.thumbnail_path, r.audio_path, ...((r.frame_paths as string[] | null) ?? [])].filter(
      (p): p is string => typeof p === "string" && p.length > 0,
    );
    if (paths.length > 0) await a.storage.from("highlight-videos").remove(paths);

    const { error } = await a.from("highlight_reels").delete().eq("id", data.reelId).eq("user_id", data.childUserId);
    if (error) throw new Error(error.message);

    await a.from("family_audit_log").insert({
      actor_user_id: context.userId,
      child_user_id: data.childUserId,
      action: "teen_reel.deleted_by_guardian",
      context: {},
    } as never);
    return { deleted: true };
  });
