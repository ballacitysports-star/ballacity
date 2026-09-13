import { useMemo } from "react";
import { useMyChildren, useParentRequests } from "@/lib/child-safety";
import { useMyMinorInvites } from "@/lib/family-invites";
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
  source: "consent" | "invite" | "request" | "age_review";
  title: string;
  detail: string;
  /** Nothing is auto-approved: this is what the guardian must do next. */
  actionLabel: string | null;
  /** Same-origin path the action opens, when the action lives on another screen. */
  actionTo: string | null;
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
export function buildFamilyApprovals(input: {
  children: GuardianChild[];
  invites: MinorInvite[];
  requests: ParentRequestRow[];
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

  // Things needing the guardian first, newest first inside each group.
  return items.sort((a, b) => {
    if (a.urgency !== b.urgency) return a.urgency === "action_needed" ? -1 : 1;
    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  });
}

/** Live approvals for the signed-in guardian. */
export function useFamilyApprovals() {
  const { children, isLoading: childrenLoading } = useMyChildren();
  const invites = useMyMinorInvites();
  const { requests } = useParentRequests();

  const approvals = useMemo(
    () =>
      buildFamilyApprovals({
        children,
        invites: invites.data ?? [],
        requests,
      }),
    [children, invites.data, requests],
  );

  return {
    approvals,
    actionNeeded: approvals.filter((a) => a.urgency === "action_needed"),
    isLoading: childrenLoading || invites.isLoading,
  };
}
