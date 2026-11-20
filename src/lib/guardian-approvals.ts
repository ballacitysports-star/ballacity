/**
 * Guardian approvals for a minor's pending team invites and game join requests.
 *
 * Reads go through the browser client: RLS lets a guardian SELECT rows for
 * children they are linked to. Approve/decline go through the SECURITY DEFINER
 * RPCs, which re-check the guardian link server-side.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyChildren } from "@/lib/child-safety";
import { isGuardianOnlyRequest } from "@/lib/guarded-open-join";
import { errorCode, userErrorMessage } from "@/lib/user-error";

export type GuardianTeamInvite = {
  id: string;
  childUserId: string;
  childName: string;
  teamId: string;
  teamName: string;
  role: string;
  message: string | null;
  expiresAt: string;
  createdAt: string;
};

export type GuardianJoinRequest = {
  id: string;
  childUserId: string;
  childName: string;
  gameId: string;
  gameTitle: string;
  gameDate: string | null;
  message: string | null;
  createdAt: string;
  /** The host already said yes; the child is waiting only on the guardian. */
  hostApproved: boolean;
  /** The game is open (no host approval): the guardian's answer is the only one needed. */
  guardianOnly: boolean;
};

/**
 * The guardian dashboard's words for a refused approval. guardian_approve_team_invite raises the child's own
 * WAIVER_REQUIRED (the waiver is the child's, signed on their behalf), so it is worded for the parent here.
 */
export function guardianApprovalError(e: unknown): string {
  if (errorCode(e) === "WAIVER_REQUIRED") return "Sign the team's waiver for your child first.";
  return userErrorMessage(e, "Something went wrong. Please try again.");
}

export function useGuardianApprovals() {
  const { children, isLoading: childrenLoading } = useMyChildren();
  const ids = children.map((c) => c.childUserId).sort();
  const names = new Map(children.map((c) => [c.childUserId, c.displayName]));

  const query = useQuery({
    queryKey: ["guardian-approvals", ids],
    enabled: ids.length > 0,
    staleTime: 15_000,
    queryFn: async () => {
      const [inv, req] = await Promise.all([
        supabase
          .from("team_invites")
          .select("id, team_id, invitee_id, role, message, expires_at, created_at")
          .in("invitee_id", ids)
          .eq("status", "pending")
          .is("guardian_approved_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false }),
        supabase
          .from("join_requests")
          .select("id, game_id, player_id, message, created_at, status, idempotency_key")
          .in("player_id", ids)
          // A host who answers first must not hide the request from the guardian.
          .in("status", ["pending", "approved"])
          .is("guardian_approved_at", null)
          .order("created_at", { ascending: false }),
      ]);
      if (inv.error) throw inv.error;
      if (req.error) throw req.error;

      const teamIds = [...new Set((inv.data ?? []).map((r) => r.team_id))];
      const gameIds = [...new Set((req.data ?? []).map((r) => r.game_id))];
      const [teams, games] = await Promise.all([
        teamIds.length
          ? supabase.from("teams").select("id, name").in("id", teamIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        gameIds.length
          ? supabase.from("hosted_games").select("id, title, date").in("id", gameIds)
          : Promise.resolve({ data: [] as { id: string; title: string; date: string }[] }),
      ]);
      // A request sent to the guardian alone is only theirs to answer while the game stays open; the public join
      // policy says whether it still is (the host may have turned approval on since).
      const guardianOnlyGames = [
        ...new Set((req.data ?? []).filter(isGuardianOnlyRequest).map((r) => r.game_id)),
      ];
      const openGames = new Set<string>();
      await Promise.all(
        guardianOnlyGames.map(async (id) => {
          const { data } = await supabase.rpc("get_game_join_policy", { _game_id: id });
          const row = Array.isArray(data) ? data[0] : data;
          if (row && row.requires_approval === false) openGames.add(id);
        }),
      );
      const teamName = new Map((teams.data ?? []).map((t) => [t.id, t.name]));
      const game = new Map((games.data ?? []).map((g) => [g.id, g]));

      const invites: GuardianTeamInvite[] = (inv.data ?? []).map((r) => ({
        id: r.id,
        childUserId: r.invitee_id,
        childName: names.get(r.invitee_id) ?? "Your child",
        teamId: r.team_id,
        teamName: teamName.get(r.team_id) ?? "A team",
        role: String(r.role),
        message: r.message ?? null,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
      }));
      const requests: GuardianJoinRequest[] = (req.data ?? []).map((r) => ({
        id: r.id,
        childUserId: r.player_id,
        childName: names.get(r.player_id) ?? "Your child",
        gameId: r.game_id,
        gameTitle: game.get(r.game_id)?.title ?? "A game",
        gameDate: game.get(r.game_id)?.date ?? null,
        message: r.message ?? null,
        createdAt: r.created_at,
        hostApproved: r.status === "approved",
        guardianOnly:
          r.status === "pending" && isGuardianOnlyRequest(r) && openGames.has(r.game_id),
      }));
      return { invites, requests };
    },
  });

  return {
    invites: query.data?.invites ?? [],
    requests: query.data?.requests ?? [],
    isLoading: childrenLoading || (ids.length > 0 && query.isLoading),
    hasChildren: ids.length > 0,
    error: query.error,
  };
}

export function useGuardianDecision() {
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: ["guardian-approvals"] });
    qc.invalidateQueries({ queryKey: ["guardian-children"] });
    qc.invalidateQueries({ queryKey: ["team-invites"] });
    qc.invalidateQueries({ queryKey: ["team-members"] });
  };
  const invite = useMutation({
    mutationFn: async (v: { id: string; approve: boolean }) => {
      const { error } = await supabase.rpc("guardian_approve_team_invite", {
        _invite: v.id,
        _approve: v.approve,
      });
      if (error) throw error;
    },
    onSettled: done,
  });
  const request = useMutation({
    mutationFn: async (v: { id: string; approve: boolean }) => {
      const { error } = await supabase.rpc("guardian_approve_join_request", {
        _request: v.id,
        _approve: v.approve,
      });
      if (error) throw error;
    },
    onSettled: done,
  });
  return { invite, request };
}
