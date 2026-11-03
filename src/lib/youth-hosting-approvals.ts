/**
 * Hosting approvals for 16-17 year olds (PRIV-2B).
 *
 * A 16-17 year old can host a youth-inclusive game only with a single-use, expiring approval from a verified
 * guardian or an adult administrator of the organization the game runs under. The database re-checks everything
 * (who approved, that the link is still active, that the game is not 18+, that the approval is unused); this
 * module is the client's view of it: the data calls, the state of an approval, and the plain-language reasons a
 * chosen approval cannot be used for the game being created.
 */
import { supabase } from "@/integrations/supabase/client";
import { gameAgeRangeIsAdultOnly } from "@/lib/city-seo";

export type HostingApproval = {
  id: string;
  kind: "guardian" | "organization";
  minor_id: string;
  approver_id: string;
  org_id: string | null;
  status: "active" | "used" | "revoked" | "expired";
  game_id: string | null;
  expires_at: string;
  created_at: string;
  used_at: string | null;
  revoked_at: string | null;
  payment_manager_id: string | null;
};

export type ApprovalState = "ready" | "used" | "revoked" | "expired";

export function approvalState(
  a: Pick<HostingApproval, "status" | "expires_at">,
  now = Date.now(),
): ApprovalState {
  if (a.status === "revoked") return "revoked";
  if (a.status === "used") return "used";
  if (a.status === "expired" || new Date(a.expires_at).getTime() <= now) return "expired";
  return "ready";
}

export const APPROVAL_VALIDITY_OPTIONS = [
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
  { hours: 336, label: "14 days" },
] as const;

/** Approvals a teen could use right now, soonest to expire first. */
export function usableApprovals(
  list: HostingApproval[],
  minorId: string,
  now = Date.now(),
): HostingApproval[] {
  return list
    .filter((a) => a.minor_id === minorId && approvalState(a, now) === "ready")
    .sort((a, b) => a.expires_at.localeCompare(b.expires_at));
}

/** Why the chosen approval cannot cover the game being created, or null when it can. */
export function approvalBlocksGame(input: {
  approval: HostingApproval | null;
  price: number;
  minAge: number | null;
  maxAge: number | null;
  isPrivate: boolean;
  sessions: number;
}): string | null {
  const { approval } = input;
  if (!approval)
    return "Ask your guardian or your club's administrator to approve this game first.";
  if (gameAgeRangeIsAdultOnly({ min_age: input.minAge, max_age: input.maxAge })) {
    return "An approval can't make you the host of an 18+ game. Choose an age range that includes players under 18.";
  }
  if (input.sessions > 1)
    return "An approval covers one game. Publish one date, then ask for another approval.";
  if (input.price > 0 && !approval.payment_manager_id) {
    return "Paid games need a guardian or club administrator to manage payment. Ask for an approval that includes it.";
  }
  if (approval.kind === "organization" && input.isPrivate) {
    return "A game approved by a club has to be public so it can be listed under the club.";
  }
  return null;
}

/** Friendly wording for the database's refusal codes. */
export function hostingErrorMessage(err: unknown): string | null {
  const text = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const map: Array<[string, string]> = [
    ["ADULT_HOST_REQUIRED", "A game for ages 18 and over has to be hosted by an adult."],
    [
      "MINOR_HOST_APPROVAL_REQUIRED",
      "A guardian or club administrator has to approve this game first.",
    ],
    [
      "MINOR_HOST_APPROVAL_INVALID",
      "That approval has expired, was already used or was withdrawn. Ask for a new one.",
    ],
    [
      "MINOR_HOST_PAYMENT_MANAGER_REQUIRED",
      "A paid game needs a guardian or club administrator to manage payment.",
    ],
    ["MINOR_CANNOT_COLLECT_PAYMENTS", "Only an adult can collect payment for a game."],
    ["CHILD_CANNOT_HOST", "An adult has to host games that include children."],
    ["AGE_NOT_ELIGIBLE", "This game isn't open to your age."],
  ];
  const hit = map.find(([code]) => text.includes(code));
  return hit ? hit[1] : null;
}

/** Query keys carry the viewer's id so a cached list can never be shown to the next person on this device. */
export const hostingApprovalsKey = (viewerId: string | null | undefined) =>
  ["hosting-approvals", viewerId ?? "anon"] as const;
export const teenChildrenKey = (viewerId: string | null | undefined) =>
  ["guardian-teen-children", viewerId ?? "anon"] as const;

const TABLE = "minor_hosting_approvals" as never;

export async function fetchHostingApprovals(): Promise<HostingApproval[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(
      "id, kind, minor_id, approver_id, org_id, status, game_id, expires_at, created_at, used_at, revoked_at, payment_manager_id",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as unknown as HostingApproval[];
}

function rpcError(error: { message?: string } | null): Error {
  const raw = error?.message ?? "";
  const known: Array<[string, string]> = [
    ["NOT_GUARDIAN", "Only a verified guardian of this player can approve hosting."],
    ["NOT_ORG_ADMIN", "Only an adult administrator of this organization can approve hosting."],
    ["NOT_ELIGIBLE", "This player can't be approved for hosting."],
    ["NOT_MEMBER", "This player isn't a member of the organization."],
    ["INVALID_DURATION", "Choose a valid length of time."],
  ];
  const hit = known.find(([code]) => raw.includes(code));
  return new Error(hit ? hit[1] : "Couldn't save that approval. Try again.");
}

export async function grantGuardianApproval(input: {
  minorId: string;
  validHours: number;
  managePayments: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc(
    "grant_minor_hosting_approval" as never,
    {
      _minor: input.minorId,
      _valid_hours: input.validHours,
      _manage_payments: input.managePayments,
    } as never,
  );
  if (error) throw rpcError(error);
  return data as unknown as string;
}

export async function grantOrgApproval(input: {
  minorId: string;
  orgId: string;
  validHours: number;
  managePayments: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc(
    "grant_org_minor_hosting_approval" as never,
    {
      _minor: input.minorId,
      _org: input.orgId,
      _valid_hours: input.validHours,
      _manage_payments: input.managePayments,
    } as never,
  );
  if (error) throw rpcError(error);
  return data as unknown as string;
}

export async function revokeHostingApproval(id: string): Promise<void> {
  const { error } = await supabase.rpc(
    "revoke_minor_hosting_approval" as never,
    { _approval: id } as never,
  );
  if (error) throw rpcError(error);
}
