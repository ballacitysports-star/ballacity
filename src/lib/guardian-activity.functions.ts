import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ChildTeam = { teamId: string; name: string; role: string; jersey: number | null; position: string | null };
export type ChildGame = {
  gameId: string;
  title: string;
  sport: string;
  date: string;
  location: string | null;
  status: "joined" | "requested";
};
export type ChildActivity = {
  childUserId: string;
  name: string;
  avatarUrl: string | null;
  teams: ChildTeam[];
  upcoming: ChildGame[];
  recent: ChildGame[];
};

/**
 * Teams and games for the caller's linked children only. The child list comes
 * from the guardian-scoped `guardian_children_overview` RPC (as the caller),
 * so the privileged reads below are restricted to children this guardian is
 * authorised for — no client-supplied ids are trusted.
 */
export const listChildrenActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ChildActivity[]> => {
    const { data: rows, error } = await context.supabase.rpc("guardian_children_overview");
    if (error) throw new Error(error.message);
    const kids = (rows ?? []) as unknown as {
      child_user_id: string;
      display_name: string | null;
      avatar_url: string | null;
    }[];
    if (kids.length === 0) return [];
    const ids = kids.map((k) => k.child_user_id);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [tm, gp, jr] = await Promise.all([
      supabaseAdmin
        .from("team_members")
        .select("team_id,user_id,role,jersey_number,position")
        .in("user_id", ids),
      supabaseAdmin.from("game_participants").select("game_id,user_id").in("user_id", ids),
      supabaseAdmin
        .from("join_requests")
        .select("game_id,player_id")
        .in("player_id", ids)
        .eq("status", "pending"),
    ]);
    const teamIds = [...new Set((tm.data ?? []).map((r) => r.team_id))];
    const gameIds = [
      ...new Set([...(gp.data ?? []).map((r) => r.game_id), ...(jr.data ?? []).map((r) => r.game_id)]),
    ];
    const [teams, games] = await Promise.all([
      teamIds.length
        ? supabaseAdmin.from("teams").select("id,name").in("id", teamIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      gameIds.length
        ? supabaseAdmin
            .from("hosted_games")
            .select("id,title,sport,date,location,cancelled_at")
            .in("id", gameIds)
        : Promise.resolve({ data: [] as never[] }),
    ]);
    const teamName = new Map((teams.data ?? []).map((t) => [t.id, t.name]));
    const gameById = new Map(
      ((games.data ?? []) as {
        id: string;
        title: string;
        sport: string;
        date: string;
        location: string | null;
        cancelled_at: string | null;
      }[]).map((g) => [g.id, g]),
    );
    const now = Date.now();

    return kids.map((k) => {
      const mk = (gid: string, status: ChildGame["status"]): ChildGame | null => {
        const g = gameById.get(gid);
        if (!g || g.cancelled_at) return null;
        return { gameId: g.id, title: g.title, sport: g.sport, date: g.date, location: g.location, status };
      };
      const all = [
        ...(gp.data ?? []).filter((r) => r.user_id === k.child_user_id).map((r) => mk(r.game_id, "joined")),
        ...(jr.data ?? []).filter((r) => r.player_id === k.child_user_id).map((r) => mk(r.game_id, "requested")),
      ].filter((g): g is ChildGame => !!g);
      const upcoming = all
        .filter((g) => new Date(g.date).getTime() >= now)
        .sort((a, b) => a.date.localeCompare(b.date));
      const recent = all
        .filter((g) => g.status === "joined" && new Date(g.date).getTime() < now)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 5);
      return {
        childUserId: k.child_user_id,
        name: k.display_name ?? "Your child",
        avatarUrl: k.avatar_url,
        teams: (tm.data ?? [])
          .filter((r) => r.user_id === k.child_user_id)
          .map((r) => ({
            teamId: r.team_id,
            name: teamName.get(r.team_id) ?? "Team",
            role: String(r.role),
            jersey: r.jersey_number as number | null,
            position: r.position as string | null,
          })),
        upcoming,
        recent,
      };
    });
  });
