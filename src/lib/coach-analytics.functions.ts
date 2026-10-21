import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildTeamAnalytics,
  shareErrorMessage,
  shareModeForCohort,
  type ShareMode,
  type TeamAnalytics,
} from "@/lib/coach-analytics";
import type { AdvancedAnalytics } from "@/lib/reel-analytics";

/**
 * Athletes share their Pro Analytics with the coaching staff of one team at a time.
 * Adults and 16-17 choose for themselves; for 13-15 only a verified guardian can.
 * Never for under 13. Every coach read goes through coach_analytics_athletes() in the
 * database, which re-checks the switch, the age rule, team membership, locks and the
 * guardian link each time.
 */

/** Whether the feature switch is on. Off on any doubt. */
export const getCoachAnalyticsEnabled = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin.rpc("coach_analytics_enabled" as never);
      return { enabled: data === true };
    } catch {
      return { enabled: false };
    }
  });

type Subject = { subjectId: string; mode: ShareMode; actorIsSubject: boolean };

/** Who the setting is about and whether the caller may change it. Throws if not theirs. */
async function resolveSubject(admin: any, actorId: string, userId?: string): Promise<Subject> {
  const subjectId = userId && userId !== actorId ? userId : actorId;
  if (subjectId !== actorId) {
    const { data: ok } = await admin.rpc("is_guardian_of", { _parent: actorId, _child: subjectId } as never);
    if (ok !== true) throw new Error("Only a verified parent or guardian can change this.");
  }
  const { data: cohort } = await admin.rpc("age_cohort_of", { _user: subjectId } as never);
  return { subjectId, mode: shareModeForCohort(cohort as string | null), actorIsSubject: subjectId === actorId };
}

export type AnalyticsShareTeam = { teamId: string; name: string; shared: boolean };

export const listAnalyticsShares = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId?: string } | undefined) => ({ userId: input?.userId }))
  .handler(async ({ data, context }): Promise<{ mode: ShareMode; teams: AnalyticsShareTeam[] }> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const s = await resolveSubject(supabaseAdmin, context.userId, data.userId);
      // Who may act: the athlete for self-managed ages, the guardian for 13-15.
      const canAct = (s.mode === "self" && s.actorIsSubject) || (s.mode === "guardian" && !s.actorIsSubject);
      if (s.mode === "unavailable") return { mode: "unavailable", teams: [] };

      const [{ data: members }, { data: shares }] = await Promise.all([
        supabaseAdmin.from("team_members").select("team_id, teams(id, name, hidden_at)").eq("user_id", s.subjectId).limit(30),
        supabaseAdmin.from("analytics_team_shares" as never).select("team_id").eq("user_id", s.subjectId),
      ]);
      const on = new Set(((shares ?? []) as { team_id: string }[]).map((r) => r.team_id));
      const teams: AnalyticsShareTeam[] = [];
      for (const m of (members ?? []) as any[]) {
        const t = m.teams;
        if (!t || t.hidden_at) continue;
        teams.push({ teamId: String(t.id), name: String(t.name ?? "Team"), shared: on.has(String(t.id)) });
      }
      return { mode: canAct ? s.mode : s.actorIsSubject ? s.mode : "unavailable", teams };
    } catch {
      return { mode: "unavailable", teams: [] };
    }
  });

export const setAnalyticsShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId?: string; teamId: string; enabled: boolean }) => {
    if (!input?.teamId) throw new Error("teamId is required");
    return { userId: input.userId, teamId: input.teamId, enabled: input.enabled === true };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const s = await resolveSubject(supabaseAdmin, context.userId, data.userId);
    if (s.mode === "unavailable") throw new Error("Sharing analytics with coaches isn't available for this account.");
    if (s.mode === "self" && !s.actorIsSubject) throw new Error("Only the athlete can turn this on.");
    if (s.mode === "guardian" && s.actorIsSubject) throw new Error("A parent or guardian has to turn this on.");

    if (data.enabled) {
      const { error } = await supabaseAdmin
        .from("analytics_team_shares" as never)
        .upsert(
          { user_id: s.subjectId, team_id: data.teamId, set_by: context.userId } as never,
          { onConflict: "user_id,team_id", ignoreDuplicates: true },
        );
      if (error) throw new Error(shareErrorMessage(error.message) ?? "Could not turn this on");
    } else {
      const { error } = await supabaseAdmin
        .from("analytics_team_shares" as never)
        .delete()
        .eq("user_id", s.subjectId)
        .eq("team_id", data.teamId);
      if (error) throw new Error(error.message);
    }

    if (!s.actorIsSubject) {
      await supabaseAdmin.from("family_audit_log").insert({
        actor_user_id: context.userId,
        child_user_id: s.subjectId,
        action: "child.analytics_share_changed",
        context: { enabled: data.enabled },
      } as never);
    }
    return { enabled: data.enabled };
  });

export type CoachTeamView = { allowed: false } | ({ allowed: true } & TeamAnalytics);

/** What coaching staff see for one team: only athletes who chose to share. */
export const getTeamAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { teamId: string }) => {
    if (!input?.teamId) throw new Error("teamId is required");
    return { teamId: input.teamId };
  })
  .handler(async ({ data, context }): Promise<CoachTeamView> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: staff } = await supabaseAdmin.rpc("is_team_manager", {
        _team: data.teamId,
        _user: context.userId,
      } as never);
      const { data: ids, error } = await supabaseAdmin.rpc("coach_analytics_athletes" as never, {
        _viewer: context.userId,
        _team: data.teamId,
      } as never);
      if (staff !== true || error) return { allowed: false };

      const userIds = ((ids ?? []) as { user_id: string }[]).map((r) => r.user_id);
      if (userIds.length === 0) return { allowed: true, ...buildTeamAnalytics([]) };

      const [{ data: reels }, { data: profiles }] = await Promise.all([
        supabaseAdmin
          .from("highlight_reels")
          .select("id,user_id,title,ai_title,created_at,ai_advanced_analytics")
          .in("user_id", userIds)
          .eq("status", "completed")
          .eq("is_draft", false)
          .is("hidden_at", null)
          .is("subject_child_id", null)
          .not("ai_advanced_analytics", "is", null)
          .order("created_at", { ascending: false })
          .limit(500),
        supabaseAdmin.from("profiles").select("id, display_name").in("id", userIds),
      ]);
      const names = new Map(((profiles ?? []) as any[]).map((p) => [String(p.id), String(p.display_name ?? "Player")]));
      const byUser = new Map<string, any[]>();
      for (const r of (reels ?? []) as any[]) {
        byUser.set(r.user_id, [
          ...(byUser.get(r.user_id) ?? []),
          {
            id: String(r.id),
            title: String(r.ai_title || r.title || "Reel"),
            created_at: String(r.created_at),
            analytics: r.ai_advanced_analytics as AdvancedAnalytics,
          },
        ]);
      }
      return {
        allowed: true,
        ...buildTeamAnalytics(
          userIds.map((id) => ({
            userId: id,
            name: names.get(id) ?? "Player",
            avatarUrl: null,
            reels: byUser.get(id) ?? [],
          })),
        ),
      };
    } catch {
      return { allowed: false };
    }
  });
