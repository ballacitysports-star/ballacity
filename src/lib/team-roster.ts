/**
 * Team roster, roles and invitations.
 *
 * Authorization lives in Postgres: `team_members`/`team_invites` are protected
 * by RLS, and every mutation goes through a SECURITY DEFINER RPC that
 * re-checks the caller's team role. Nothing in this module is a security
 * boundary — it exists to keep the UI honest about what the server will allow
 * and to translate server error codes into plain sentences.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const TEAM_ROLES = ["owner", "manager", "coach", "captain", "player"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/** Roles a manager may assign. `owner` follows team ownership and is not assignable. */
export const ASSIGNABLE_ROLES: TeamRole[] = ["manager", "coach", "captain", "player"];

export const ROLE_META: Record<TeamRole, { label: string; blurb: string; emoji: string }> = {
  owner: { label: "Owner", blurb: "Created the team. Full control.", emoji: "👑" },
  manager: { label: "Manager", blurb: "Manages roster, roles and invites.", emoji: "🗂️" },
  coach: { label: "Coach", blurb: "Manages roster and invites.", emoji: "📋" },
  captain: { label: "Captain", blurb: "Leads the squad on game day.", emoji: "🎯" },
  player: { label: "Player", blurb: "On the roster.", emoji: "🏅" },
};

/** Roles the server treats as team management (mirrors `is_team_manager`). */
export const MANAGER_ROLES: TeamRole[] = ["owner", "manager", "coach"];
/** Roles allowed to change another member's role (mirrors `team_set_member_role`). */
const ROLE_ADMIN_ROLES: TeamRole[] = ["owner", "manager"];

export type TeamPermissions = {
  role: TeamRole | null;
  isMember: boolean;
  canInvite: boolean;
  canRemoveMembers: boolean;
  canAssignRoles: boolean;
  canEditTeam: boolean;
  canLeave: boolean;
};

export function teamPermissions(role: TeamRole | null): TeamPermissions {
  const isManager = !!role && MANAGER_ROLES.includes(role);
  return {
    role,
    isMember: !!role,
    canInvite: isManager,
    canRemoveMembers: isManager,
    canAssignRoles: !!role && ROLE_ADMIN_ROLES.includes(role),
    // `teams` UPDATE is `auth.uid() = owner_id`, so a manager’s write is refused.
    canEditTeam: role === "owner",
    canLeave: !!role && role !== "owner",
  };
}

export type RosterMember = {
  id: string;
  teamId: string;
  userId: string;
  role: TeamRole;
  jerseyNumber: string | null;
  position: string | null;
  joinedAt: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  initials: string | null;
};

export type TeamInvite = {
  id: string;
  teamId: string;
  inviteeId: string;
  invitedBy: string;
  role: TeamRole;
  message: string | null;
  status: "pending" | "accepted" | "declined" | "cancelled" | "expired";
  expiresAt: string;
  createdAt: string;
  /** Invitee view only: whether a guardian must approve before accepting. */
  needsGuardian?: boolean;
  guardianApproved?: boolean;
  /** Present for roster/invitee views once the profile join resolves. */
  displayName?: string;
  username?: string | null;
  avatarUrl?: string | null;
  teamName?: string;
};

const ROSTER_ORDER: Record<TeamRole, number> = {
  owner: 0,
  manager: 1,
  coach: 2,
  captain: 3,
  player: 4,
};

/**
 * Server error codes raised by the team RPCs, in plain language.
 *
 * The role-guard codes come from guard_team_member_role_change() (migration
 * 20260910000000). The same escalation is also pinned by RLS in 20260912013327,
 * which fails silently with zero rows instead — so a blocked write may surface
 * either as one of these messages or as "nothing changed".
 */
export function teamRosterErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : String((err as { message?: string })?.message ?? err ?? "");
  if (raw.includes("NOT_TEAM_MANAGER"))
    return "Only the team's owner, managers or coaches can do that.";
  if (raw.includes("NOT_TEAM_OWNER")) return "Only the team's owner can hand the team over.";
  if (raw.includes("TARGET_NOT_MANAGER"))
    return "A team can only be handed to a manager. Promote them first.";
  if (raw.includes("ALREADY_OWNER")) return "You already own this team.";
  if (raw.includes("TEAM_NOT_FOUND")) return "That team no longer exists.";
  if (raw.includes("ALREADY_MEMBER")) return "That player is already on the roster.";
  if (raw.includes("SELF_INVITE")) return "You're already on this team.";
  if (raw.includes("OWNER_NOT_INVITABLE") || raw.includes("OWNER_ROLE_FIXED"))
    return "The owner role follows team ownership and can't be assigned.";
  if (raw.includes("OWNER_NOT_REMOVABLE"))
    return "The team owner can't be removed from the roster.";
  if (raw.includes("BLOCKED")) return "You can't invite this player.";
  if (raw.includes("INVITE_NOT_FOUND")) return "That invitation no longer exists.";
  if (raw.includes("INVITE_NOT_PENDING")) return "That invitation was already answered.";
  if (raw.includes("INVITE_EXPIRED"))
    return "That invitation expired. Ask the team to send a new one.";
  if (raw.includes("CHILD_ACTIVITY_LOCKED"))
    return "A parent or guardian has paused team activity on this account.";
  if (raw.includes("WAIVER_REQUIRED")) return "Sign the team's waiver before joining.";
  if (raw.includes("GUARDIAN_APPROVAL_REQUIRED"))
    return "A parent or guardian must approve this invite first.";
  if (raw.includes("NOT_INVITEE")) return "That invitation was sent to someone else.";
  if (raw.includes("NOT_A_MEMBER")) return "That player isn't on the roster.";
  if (raw.includes("duplicate key")) return "That player already has a pending invitation.";
  if (raw.includes("AUTH_REQUIRED")) return "Sign in to manage a team roster.";
  return "Couldn't update the roster. Try again.";
}

async function attachProfiles<T extends { userId: string }>(rows: T[]) {
  const ids = [...new Set(rows.map((r) => r.userId))];
  if (ids.length === 0) return new Map<string, Record<string, unknown>>();
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, username, avatar_url, avatar_initials")
    .in("id", ids);
  return new Map(((data ?? []) as Record<string, any>[]).map((p) => [p["id"] as string, p]));
}

export async function fetchTeamRoster(teamId: string): Promise<RosterMember[]> {
  const { data, error } = await supabase
    .from("team_members")
    .select("id, team_id, user_id, role, jersey_number, position, created_at")
    .eq("team_id", teamId);
  if (error) throw error;
  const base = ((data ?? []) as Record<string, any>[]).map((r) => ({
    id: String(r["id"]),
    teamId: String(r["team_id"]),
    userId: String(r["user_id"]),
    role: r["role"] as TeamRole,
    jerseyNumber: (r["jersey_number"] as string) ?? null,
    position: (r["position"] as string) ?? null,
    joinedAt: String(r["created_at"]),
  }));
  const profiles = await attachProfiles(base);
  return base
    .map((m) => {
      const p = profiles.get(m.userId);
      return {
        ...m,
        displayName: (p?.["display_name"] as string) || (p?.["username"] as string) || "Player",
        username: (p?.["username"] as string) ?? null,
        avatarUrl: (p?.["avatar_url"] as string) ?? null,
        initials: (p?.["avatar_initials"] as string) ?? null,
      };
    })
    .sort(
      (a, b) =>
        ROSTER_ORDER[a.role] - ROSTER_ORDER[b.role] || a.displayName.localeCompare(b.displayName),
    );
}

export function useTeamRoster(teamId: string | undefined) {
  return useQuery({
    queryKey: ["team-roster", teamId],
    queryFn: () => fetchTeamRoster(teamId!),
    enabled: !!teamId,
    staleTime: 30_000,
  });
}

/** The viewer's role on a team, derived from the roster (RLS-visible). */
export function useMyTeamRole(teamId: string | undefined): TeamRole | null {
  const { user } = useAuth();
  const roster = useTeamRoster(teamId);
  if (!user) return null;
  return roster.data?.find((m) => m.userId === user.id)?.role ?? null;
}

export function useTeamPermissions(teamId: string | undefined): TeamPermissions {
  return teamPermissions(useMyTeamRole(teamId));
}

/** Pending invitations sent by a team (managers only — RLS enforces it). */
export function useTeamPendingInvites(teamId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["team-invites", "team", teamId],
    queryFn: async (): Promise<TeamInvite[]> => {
      const { data, error } = await supabase
        .from("team_invites")
        .select(
          "id, team_id, invitee_id, invited_by, role, message, status, expires_at, created_at",
        )
        .eq("team_id", teamId!)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = ((data ?? []) as Record<string, any>[]).map((r) => ({
        id: String(r["id"]),
        teamId: String(r["team_id"]),
        inviteeId: String(r["invitee_id"]),
        invitedBy: String(r["invited_by"]),
        role: r["role"] as TeamRole,
        message: (r["message"] as string) ?? null,
        status: r["status"] as TeamInvite["status"],
        expiresAt: String(r["expires_at"]),
        createdAt: String(r["created_at"]),
        userId: String(r["invitee_id"]),
      }));
      const profiles = await attachProfiles(rows);
      return rows.map(({ userId, ...r }) => {
        const p = profiles.get(userId);
        return {
          ...r,
          displayName: (p?.["display_name"] as string) || (p?.["username"] as string) || "Player",
          username: (p?.["username"] as string) ?? null,
          avatarUrl: (p?.["avatar_url"] as string) ?? null,
        };
      });
    },
    enabled: !!teamId && enabled,
    staleTime: 15_000,
  });
}

/** Invitations addressed to the signed-in player. */
export function useMyTeamInvites() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["team-invites", "mine", user?.id],
    queryFn: async (): Promise<TeamInvite[]> => {
      const { data, error } = await supabase
        .from("team_invites")
        .select(
          "id, team_id, invitee_id, invited_by, role, message, status, expires_at, created_at, guardian_approved_at",
        )
        .eq("invitee_id", user!.id)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as Record<string, any>[];
      const { data: links } = await supabase
        .from("guardian_links")
        .select("id")
        .eq("child_user_id", user!.id)
        .eq("status", "active")
        .limit(1);
      const hasGuardian = (links ?? []).length > 0;
      const teamIds = [...new Set(rows.map((r) => String(r["team_id"])))];
      const names = new Map<string, string>();
      if (teamIds.length) {
        const { data: teams } = await supabase.from("teams").select("id, name").in("id", teamIds);
        ((teams ?? []) as Record<string, any>[]).forEach((t) =>
          names.set(String(t["id"]), String(t["name"])),
        );
      }
      return rows.map((r) => ({
        id: String(r["id"]),
        teamId: String(r["team_id"]),
        inviteeId: String(r["invitee_id"]),
        invitedBy: String(r["invited_by"]),
        role: r["role"] as TeamRole,
        message: (r["message"] as string) ?? null,
        status: r["status"] as TeamInvite["status"],
        expiresAt: String(r["expires_at"]),
        createdAt: String(r["created_at"]),
        teamName: names.get(String(r["team_id"])) ?? "A team",
        needsGuardian: hasGuardian,
        guardianApproved: !!r["guardian_approved_at"],
      }));
    },
    enabled: !!user,
    staleTime: 15_000,
  });
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase.rpc as any)(name, args);
  if (error) throw error;
  return data;
}

export function useTeamRosterActions(teamId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["team-roster", teamId] });
    qc.invalidateQueries({ queryKey: ["team-invites"] });
  };

  const invite = useMutation({
    mutationFn: (v: { userId: string; role: TeamRole; message?: string }) =>
      rpc("team_invite_player", {
        _team: teamId,
        _user: v.userId,
        _role: v.role,
        _message: v.message ?? null,
      }),
    onSuccess: (inviteId) => {
      invalidate();
      void import("@/lib/guardian-push.functions").then((m) => m.pingGuardians("team_invite", inviteId));
    },
  });

  const cancelInvite = useMutation({
    mutationFn: (inviteId: string) => rpc("team_cancel_invite", { _invite: inviteId }),
    onSuccess: invalidate,
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => rpc("team_remove_member", { _team: teamId, _user: userId }),
    onSuccess: invalidate,
  });

  /**
   * Jersey and position are plain columns, not an RPC: the manager branch of
   * `team_members_manager_update` already allows them, and the role guard only
   * refuses `role`. A caller without rights matches no rows and no-ops.
   */
  const setDetails = useMutation({
    mutationFn: async (v: {
      userId: string;
      jerseyNumber: string | null;
      position: string | null;
    }) => {
      const { error } = await supabase
        .from("team_members")
        .update({ jersey_number: v.jerseyNumber, position: v.position })
        .eq("team_id", teamId)
        .eq("user_id", v.userId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const setRole = useMutation({
    mutationFn: (v: { userId: string; role: TeamRole }) =>
      rpc("team_set_member_role", { _team: teamId, _user: v.userId, _role: v.role }),
    onSuccess: invalidate,
  });

  return { invite, cancelInvite, removeMember, setRole, setDetails };
}

/**
 * Hand a team to one of its managers. Everything moves together server-side —
 * `teams.owner_id`, both roster rows and the team's single `account_profiles`
 * row — so the whole roster and the viewer's own profile list go stale at once.
 */
export function useTransferTeamOwnership(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => rpc("transfer_team_ownership", { _team: teamId, _to: userId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-roster", teamId] });
      qc.invalidateQueries({ queryKey: ["my-team-memberships"] });
      qc.invalidateQueries({ queryKey: ["my-teams"] });
    },
  });
}

export function useRespondToTeamInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { inviteId: string; accept: boolean }) =>
      rpc("team_respond_invite", { _invite: v.inviteId, _accept: v.accept }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-invites"] });
      qc.invalidateQueries({ queryKey: ["team-roster"] });
      qc.invalidateQueries({ queryKey: ["my-teams"] });
    },
  });
}

/** Teams the viewer belongs to, whatever their role (not just owned). */
export function useMyTeamMemberships() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-team-memberships", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_members")
        .select("team_id, role")
        .eq("user_id", user!.id);
      if (error) throw error;
      const rows = ((data ?? []) as Record<string, any>[]).map((r) => ({
        teamId: String(r["team_id"]),
        role: r["role"] as TeamRole,
      }));
      if (rows.length === 0) return [];
      const { data: teams } = await supabase
        .from("teams")
        .select("id, name, handle, avatar, kind, sports, city")
        .in(
          "id",
          rows.map((r) => r.teamId),
        );
      const byId = new Map(
        ((teams ?? []) as Record<string, any>[]).map((t) => [String(t["id"]), t]),
      );
      return rows
        .map((r) => {
          const t = byId.get(r.teamId);
          if (!t) return null;
          return {
            ...r,
            name: String(t["name"]),
            handle: String(t["handle"] ?? ""),
            avatar: String(t["avatar"] ?? ""),
            kind: String(t["kind"] ?? "team"),
            sports: (t["sports"] as string[]) ?? [],
            city: (t["city"] as string) ?? "",
          };
        })
        .filter((v): v is NonNullable<typeof v> => !!v)
        .sort((a, b) => ROSTER_ORDER[a.role] - ROSTER_ORDER[b.role]);
    },
    enabled: !!user,
    staleTime: 30_000,
  });
}
