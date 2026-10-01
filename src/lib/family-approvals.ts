import { useMemo } from "react";
import { useMyChildren, useParentRequests } from "@/lib/child-safety";
import { useMyMinorInvites } from "@/lib/family-invites";
import {
  useMyChildrensPendingTeamInvites,
  type GuardianPendingTeamInvite,
} from "@/lib/team-roster";
import { useMyChildrensUnsignedWaivers, type GuardianUnsignedWaiver } from "@/lib/team-waivers";
import { listMyChildrensJoinRequests, type JoinRequest } from "@/lib/payments";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { GuardianChild, ParentRequestRow } from "@/lib/child-safety.functions";
import type { MinorInvite } from "@/lib/family-invites.functions";

/**
 * One reusable shape for every guardian-facing approval in the app, so new
 * features can surface an item in the Parent Center without inventing their
 * own UI, wording or state machine.
 */
export type FamilyApproval = {
  id: string;
  /** Which feature raised it — used for grouping and for the icon/label. */
  source: "consent" | "invite" | "request" | "age_review" | "team_join" | "game_join" | "waiver";
  title: string;
  detail: string;
  /** Nothing is auto-approved: this is what the guardian must do next. */
  actionLabel: string | null;
  /** Same-origin path the action opens, when the action lives on another screen. */
  actionTo: string | null;
  /**
   * An inline Approve/Decline/Sign affordance, in place of (or alongside)
   * actionTo — the first sources with an action the guardian can take right
   * here, rather than only a link to go look elsewhere. The builder stays
   * pure/data-only: the mutation itself is wired up by whatever renders it
   * (FamilyApprovalsPanel), the same way parent.index.tsx's ChildPanel
   * already wires its own inline mutations.
   */
  approveAction?: { kind: "team_invite" | "join_request" | "waiver"; id: string; teamId?: string };
  urgency: "action_needed" | "waiting";
  childUserId: string | null;
  createdAt: string | null;
};

function relationshipLabel(relationship: string): string {
  return relationship.replace(/_/g, " ");
}

/**
 * Pure builder — collects pending items from every family feature. Kept free of
 * React so it can be unit-tested and reused by other surfaces (notifications,
 * admin views, future approval types).
 */
export type GuardianJoinRequest = JoinRequest & { gameTitle: string; childDisplayName: string };

export function buildFamilyApprovals(input: {
  children: GuardianChild[];
  invites: MinorInvite[];
  requests: ParentRequestRow[];
  teamInvites?: GuardianPendingTeamInvite[];
  joinRequests?: GuardianJoinRequest[];
  unsignedWaivers?: GuardianUnsignedWaiver[];
}): FamilyApproval[] {
  const items: FamilyApproval[] = [];

  for (const child of input.children) {
    const status = child.consent?.status ?? null;
    if (status === "pending" || status === "required") {
      items.push({
        id: `consent:${child.childUserId}`,
        source: "consent",
        title: `Approve consent for ${child.displayName}`,
        detail:
          "Their account stays limited until you confirm you're their parent or legal guardian. " +
          "Open the approval link they sent you — approving needs that link, so it cannot be done " +
          "from this page.",
        actionLabel: "Review consent",
        actionTo: "/parent",
        urgency: "action_needed",
        childUserId: child.childUserId,
        createdAt: child.consent?.requestedAt ?? null,
      });
    }
    if (status === "revoked") {
      items.push({
        id: `consent-revoked:${child.childUserId}`,
        source: "consent",
        title: `${child.displayName}'s account is paused`,
        detail:
          "You withdrew consent. Their activity stays restricted until consent is given again.",
        actionLabel: "Review consent",
        actionTo: "/parent",
        urgency: "action_needed",
        childUserId: child.childUserId,
        createdAt: child.consent?.revokedAt ?? null,
      });
    }
  }

  for (const invite of input.invites) {
    if (invite.status !== "pending") continue;
    items.push({
      id: `invite:${invite.id}`,
      source: "invite",
      title: `Waiting for ${invite.childName} to accept`,
      detail: `Invitation as your ${relationshipLabel(invite.relationship)} expires ${new Date(
        invite.expiresAt,
      ).toLocaleDateString()}.`,
      actionLabel: null,
      actionTo: null,
      urgency: "waiting",
      childUserId: null,
      createdAt: invite.createdAt,
    });
  }

  for (const request of input.requests) {
    if (request.status !== "open" && request.status !== "in_progress") continue;
    items.push({
      id: `request:${request.id}`,
      source: "request",
      title: `${request.kind.replace(/_/g, " ")} request in progress`,
      detail:
        request.details ?? "Our safety team is handling this. We'll email you when it's done.",
      actionLabel: null,
      actionTo: null,
      urgency: "waiting",
      childUserId: request.child_user_id,
      createdAt: request.created_at,
    });
  }

  for (const invite of input.teamInvites ?? []) {
    if (invite.guardianApproved) continue;
    items.push({
      id: `team-invite:${invite.id}`,
      source: "team_join",
      title: `${invite.childDisplayName} was invited to ${invite.teamName}`,
      detail: `Approve before they can accept and join the roster.`,
      actionLabel: "Review invite",
      actionTo: "/parent",
      approveAction: { kind: "team_invite", id: invite.id, teamId: invite.teamId },
      urgency: "action_needed",
      childUserId: invite.inviteeId,
      createdAt: invite.createdAt,
    });
  }

  for (const request of input.joinRequests ?? []) {
    if (request.guardian_approved_at) continue;
    items.push({
      id: `join-request:${request.id}`,
      source: "game_join",
      title: `${request.childDisplayName} wants to join ${request.gameTitle}`,
      detail: "Approve before they can take part in this game.",
      actionLabel: "Review request",
      actionTo: "/parent",
      approveAction: { kind: "join_request", id: request.id },
      urgency: "action_needed",
      childUserId: request.player_id,
      createdAt: request.created_at,
    });
  }

  for (const waiver of input.unsignedWaivers ?? []) {
    items.push({
      id: `waiver:${waiver.waiverId}:${waiver.childUserId}`,
      source: "waiver",
      title: `${waiver.teamName} needs a signed waiver for ${waiver.childDisplayName}`,
      detail: "They can't join the team's roster until this is signed.",
      actionLabel: "Sign waiver",
      actionTo: "/parent",
      approveAction: { kind: "waiver", id: waiver.waiverId, teamId: waiver.teamId },
      urgency: "action_needed",
      childUserId: waiver.childUserId,
      createdAt: null,
    });
  }

  // Things needing the guardian first, newest first inside each group.
  return items.sort((a, b) => {
    if (a.urgency !== b.urgency) return a.urgency === "action_needed" ? -1 : 1;
    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  });
}

/** Child display names + the game titles their join requests reference. */
function useEnrichedJoinRequests(childUserIds: string[]) {
  return useQuery({
    queryKey: ["my-childrens-join-requests", childUserIds],
    queryFn: async (): Promise<GuardianJoinRequest[]> => {
      const rows = await listMyChildrensJoinRequests();
      if (rows.length === 0) return [];
      const gameIds = [...new Set(rows.map((r) => r.game_id))];
      const [{ data: games }, { data: children }] = await Promise.all([
        supabase.from("hosted_games").select("id, title").in("id", gameIds),
        supabase.from("profiles").select("id, display_name, username").in("id", childUserIds),
      ]);
      const gameTitles = new Map(
        ((games ?? []) as Record<string, unknown>[]).map((g) => [
          String(g["id"]),
          String(g["title"]),
        ]),
      );
      const childNames = new Map(
        ((children ?? []) as Record<string, unknown>[]).map((p) => [
          String(p["id"]),
          (p["display_name"] as string) || (p["username"] as string) || "Your child",
        ]),
      );
      return rows.map((r) => ({
        ...r,
        gameTitle: gameTitles.get(r.game_id) ?? "a game",
        childDisplayName: childNames.get(r.player_id) ?? "Your child",
      }));
    },
    enabled: childUserIds.length > 0,
    staleTime: 15_000,
  });
}

/** Live approvals for the signed-in guardian. */
export function useFamilyApprovals() {
  const { children, isLoading: childrenLoading } = useMyChildren();
  const invites = useMyMinorInvites();
  const { requests } = useParentRequests();
  const childUserIds = useMemo(() => children.map((c) => c.childUserId), [children]);
  const teamInvites = useMyChildrensPendingTeamInvites();
  const joinRequests = useEnrichedJoinRequests(childUserIds);
  const unsignedWaivers = useMyChildrensUnsignedWaivers(childUserIds);

  const approvals = useMemo(
    () =>
      buildFamilyApprovals({
        children,
        invites: invites.data ?? [],
        requests,
        teamInvites: teamInvites.data ?? [],
        joinRequests: joinRequests.data ?? [],
        unsignedWaivers: unsignedWaivers.data ?? [],
      }),
    [children, invites.data, requests, teamInvites.data, joinRequests.data, unsignedWaivers.data],
  );

  return {
    approvals,
    actionNeeded: approvals.filter((a) => a.urgency === "action_needed"),
    isLoading: childrenLoading || invites.isLoading,
  };
}
