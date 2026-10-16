import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeAthleteProgress, type AthleteProgress } from "@/lib/athlete-xp";

export type PassportTeam = {
  id: string;
  name: string;
  handle: string | null;
  avatar: string | null;
  kind: string | null;
  role: string;
};

export type PassportAccolade = {
  postId: string;
  title: string;
  kind: string | null;
  teamId: string;
  teamName: string | null;
  date: string | null;
};

export type PassportRun = {
  id: string;
  title: string;
  sport: string | null;
  date: string;
  location: string | null;
  orgId: string | null;
};

export type PlayerPassport = {
  teams: PassportTeam[];
  accolades: PassportAccolade[];
  upcomingRuns: PassportRun[];
  /** Null for minors or when the player hides games played. */
  progress?: AthleteProgress | null;
};

const EMPTY: PlayerPassport = { teams: [], accolades: [], upcomingRuns: [], progress: null };

/**
 * Fails closed: only a confirmed adult cohort unlocks attendance and run
 * details. A failed lookup, "unknown" (no birthday) or any new cohort value is
 * treated as a minor, so the privacy floor can't be lost to a bad read.
 */
export function isPassportMinor(cohort: unknown, lookupFailed = false): boolean {
  return lookupFailed || cohort !== "adult";
}

/**
 * A player's footprint on the platform for `/players/$userId`: team badges,
 * verified tryout/camp attendance and the public runs they've joined.
 *
 * Same privacy model as `getPlayerCard`: nothing for private profiles or
 * across a block, and minors never publish attendance or where they'll be
 * (team badges only). Tryout scores and notes are never returned.
 */
export const getPlayerPassport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<PlayerPassport> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = data.userId;

    const [visRes, blockRes, cohortRes, flagsRes, profRes] = await Promise.all([
      supabaseAdmin.rpc("profile_visibility_of", { _user: userId }),
      supabaseAdmin.rpc("blocks_exist_between", { _a: context.userId, _b: userId }),
      supabaseAdmin.rpc("age_cohort_of", { _user: userId }),
      supabaseAdmin.rpc("public_privacy_flags" as never, { _ids: [userId] } as never),
      supabaseAdmin.from("profiles").select("suspended_at").eq("id", userId).maybeSingle(),
    ]);
    const visibility = visRes.data as string | null;
    if (visibility !== "public" && visibility !== "members") return EMPTY;
    if (blockRes.data === true) return EMPTY;
    if (!profRes.data || profRes.data.suspended_at) return EMPTY;

    const isMinor = isPassportMinor(cohortRes.data, !!cohortRes.error);
    const flags = ((flagsRes.data ?? []) as { show_games_played?: boolean | null }[])[0] ?? {};
    const showGames = flags.show_games_played !== false;

    const { data: memberRows } = await supabaseAdmin
      .from("team_members")
      .select("role, teams(id, name, handle, avatar, kind, hidden_at)")
      .eq("user_id", userId)
      .limit(20);
    const teams: PassportTeam[] = [];
    for (const row of (memberRows ?? []) as {
      role: string;
      teams: {
        id: string;
        name: string;
        handle: string | null;
        avatar: string | null;
        kind: string | null;
        hidden_at: string | null;
      } | null;
    }[]) {
      const t = row.teams;
      if (!t || t.hidden_at) continue;
      teams.push({
        id: t.id,
        name: t.name,
        handle: t.handle,
        avatar: t.avatar,
        kind: t.kind,
        role: row.role,
      });
    }

    // Minors: team badges only, never where they've been or will be.
    if (isMinor) return { teams, accolades: [], upcomingRuns: [], progress: null };

    const [rsvpRes, joinRes] = await Promise.all([
      supabaseAdmin
        .from("tryout_rsvps")
        .select("id, post_id, team_id")
        .eq("user_id", userId)
        .limit(50),
      showGames
        ? supabaseAdmin
            .from("game_participants")
            .select("game_id, attended")
            .eq("user_id", userId)
            .limit(500)
        : Promise.resolve({ data: [] as { game_id: string; attended: boolean | null }[] }),
    ]);

    let accolades: PassportAccolade[] = [];
    let attendedTryouts = 0;
    const rsvps = rsvpRes.data ?? [];
    if (rsvps.length > 0) {
      const { data: evals } = await supabaseAdmin
        .from("tryout_evaluations")
        .select("rsvp_id")
        .in(
          "rsvp_id",
          rsvps.map((r) => r.id),
        )
        .eq("attended", true);
      const attended = new Set((evals ?? []).map((e) => e.rsvp_id));
      attendedTryouts = attended.size;
      const postIds = rsvps.filter((r) => attended.has(r.id)).map((r) => r.post_id);
      if (postIds.length > 0) {
        const { data: posts } = await supabaseAdmin
          .from("team_posts")
          .select("id, title, kind, team_id, event_date, teams(name)")
          .in("id", postIds);
        accolades = (
          (posts ?? []) as {
            id: string;
            title: string;
            kind: string | null;
            team_id: string;
            event_date: string | null;
            teams: { name: string } | null;
          }[]
        )
          .map((p) => ({
            postId: p.id,
            title: p.title,
            kind: p.kind,
            teamId: p.team_id,
            teamName: p.teams?.name ?? null,
            date: p.event_date,
          }))
          .sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime())
          .slice(0, 12);
      }
    }

    let upcomingRuns: PassportRun[] = [];
    const gameIds = (joinRes.data ?? []).map((r) => r.game_id).filter(Boolean);
    if (gameIds.length > 0) {
      const { data: games } = await supabaseAdmin
        .from("hosted_games")
        .select("id, title, sport, date, location, org_id")
        .in("id", gameIds)
        .eq("is_private", false)
        .is("hidden_at", null)
        .is("cancelled_at", null)
        .gte("date", new Date().toISOString())
        .order("date", { ascending: true })
        .limit(5);
      upcomingRuns = (games ?? []).map((g) => ({
        id: g.id,
        title: g.title,
        sport: g.sport,
        date: g.date,
        location: g.location,
        orgId: g.org_id,
      }));
    }

    let progress: AthleteProgress | null = null;
    if (showGames) {
      const marked = (joinRes.data ?? []).filter((r) => r.attended != null);
      const [datesRes, hostedRes, lateRes] = await Promise.all([
        marked.length
          ? supabaseAdmin
              .from("hosted_games")
              .select("id, date")
              .in(
                "id",
                marked.map((r) => r.game_id),
              )
          : Promise.resolve({ data: [] as { id: string; date: string }[] }),
        supabaseAdmin
          .from("hosted_games")
          .select("id", { count: "exact", head: true })
          .eq("host_id", userId)
          .is("cancelled_at", null)
          .lt("date", new Date().toISOString()),
        supabaseAdmin
          .from("late_cancellations")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("cancelled_by", userId),
      ]);
      const dateOf = new Map((datesRes.data ?? []).map((g) => [g.id, +new Date(g.date)]));
      const history = [...marked]
        .sort((a, b) => (dateOf.get(b.game_id) ?? 0) - (dateOf.get(a.game_id) ?? 0))
        .map((r) => r.attended === true);
      progress = computeAthleteProgress({
        attendedRuns: history.filter(Boolean).length,
        noShows: history.filter((x) => !x).length,
        lateCancels: lateRes.count ?? 0,
        hostedGames: hostedRes.count ?? 0,
        attendedTryouts,
        attendanceHistory: history,
      });
    }

    return { teams, accolades, upcomingRuns, progress };
  });
