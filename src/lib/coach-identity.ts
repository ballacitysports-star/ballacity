import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * P2-2: a person's private coach identity. The database keeps one account_profiles
 * row of kind "coach" while the person is owner, manager or coach on at least one
 * team (migration 20261106190000_coach_identity). It is not a profile to act as: the
 * switcher shows it as a way into "Teams you coach", one list across every team.
 * The switcher reads the same roster roles the database row is kept in step with.
 * Nobody else can see it, and it is not listed in Discover.
 */
export const COACHING_ROLES = ["owner", "manager", "coach"] as const;
export type CoachingRole = (typeof COACHING_ROLES)[number];

export function isCoachingRole(role: unknown): role is CoachingRole {
  return (COACHING_ROLES as readonly unknown[]).includes(role);
}

export type CoachedTeam = { id: string; name: string; handle: string | null; role: CoachingRole };

type MembershipRow = {
  role: string;
  teams: { id: string; name: string; handle: string | null; hidden_at?: string | null } | null;
};

/** Teams where the person holds a coaching role, owner first, then by name; hidden teams are left out. */
export function coachedTeamsFrom(rows: MembershipRow[]): CoachedTeam[] {
  const rank: Record<CoachingRole, number> = { owner: 0, manager: 1, coach: 2 };
  return rows
    .filter((r) => r.teams && !r.teams.hidden_at && isCoachingRole(r.role))
    .map((r) => ({
      id: r.teams!.id,
      name: r.teams!.name,
      handle: r.teams!.handle,
      role: r.role as CoachingRole,
    }))
    .sort((a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name));
}

export const ROLE_LABEL: Record<CoachingRole, string> = {
  owner: "Owner",
  manager: "Manager",
  coach: "Coach",
};

export function useCoachedTeams(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["coached-teams", user?.id ?? "anon"],
    enabled: enabled && !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<CoachedTeam[]> => {
      const { data, error } = await supabase
        .from("team_members")
        .select("role, teams(id, name, handle, hidden_at)")
        .eq("user_id", user!.id)
        .in("role", [...COACHING_ROLES]);
      if (error) throw error;
      return coachedTeamsFrom((data ?? []) as unknown as MembershipRow[]);
    },
  });
}
