import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const TEAM_LEADER_ROLES = ["owner", "manager", "coach"] as const;
export type TeamLeaderRole = (typeof TEAM_LEADER_ROLES)[number];

export type GuardianTeamContact = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  initials: string | null;
  role: TeamLeaderRole;
};

type LeaderRow = {
  user_id: string;
  role: string;
  profiles?: {
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
    avatar_initials: string | null;
  } | null;
};

const ROLE_ORDER: Record<TeamLeaderRole, number> = { owner: 0, manager: 1, coach: 2 };

export function selectGuardianTeamContacts(
  rows: LeaderRow[],
  currentUserId: string,
): GuardianTeamContact[] {
  return rows
    .filter(
      (row): row is LeaderRow & { role: TeamLeaderRole } =>
        row.user_id !== currentUserId &&
        TEAM_LEADER_ROLES.includes(row.role as TeamLeaderRole),
    )
    .map((row) => ({
      userId: row.user_id,
      displayName:
        row.profiles?.display_name || row.profiles?.username || "Team leader",
      avatarUrl: row.profiles?.avatar_url ?? null,
      initials: row.profiles?.avatar_initials ?? null,
      role: row.role,
    }))
    .sort(
      (a, b) =>
        ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.displayName.localeCompare(b.displayName),
    );
}

export const listGuardianTeamContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ teamId: z.string().min(1).max(100) }).parse(data),
  )
  .handler(async ({ data, context }): Promise<GuardianTeamContact[]> => {
    const { data: children, error: childrenError } = await context.supabase.rpc(
      "guardian_children_overview",
    );
    if (childrenError) throw new Error("Could not verify your linked children.");

    const childIds = ((children ?? []) as { child_user_id: string }[]).map(
      (child) => child.child_user_id,
    );
    if (childIds.length === 0) return [];

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count, error: membershipError } = await supabaseAdmin
      .from("team_members")
      .select("id", { count: "exact", head: true })
      .eq("team_id", data.teamId)
      .in("user_id", childIds);
    if (membershipError) throw new Error("Could not verify this team.");
    if (!count) return [];

    const { data: leaders, error: leadersError } = await supabaseAdmin
      .from("team_members")
      .select(
        "user_id,role,profiles!team_members_user_id_fkey(display_name,username,avatar_url,avatar_initials)",
      )
      .eq("team_id", data.teamId)
      .in("role", [...TEAM_LEADER_ROLES]);
    if (leadersError) throw new Error("Could not load this team's contacts.");

    return selectGuardianTeamContacts((leaders ?? []) as unknown as LeaderRow[], context.userId);
  });