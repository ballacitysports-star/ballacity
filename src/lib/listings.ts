import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { ListingSubjectType } from "@/lib/listings.functions";

export type MyClaim = {
  id: string;
  status: "pending" | "needs_info" | "approved" | "denied" | "withdrawn";
  denialReason: string | null;
  /** The reviewer's question, when they asked for more information. */
  infoRequest: string | null;
  createdAt: string;
};

/** How a claimant is connected to the listing. Stated, then checked by a moderator. */
export const CLAIM_RELATIONSHIPS = [
  "original_poster",
  "owner",
  "coach",
  "gym_owner",
  "employee",
  "authorized_rep",
] as const;
export type ClaimRelationship = (typeof CLAIM_RELATIONSHIPS)[number];

export const CLAIM_RELATIONSHIP_LABEL: Record<ClaimRelationship, string> = {
  original_poster: "I posted the original announcement",
  owner: "I own or run this team or organization",
  coach: "I'm a coach here",
  gym_owner: "I own this gym or facility",
  employee: "I work here",
  authorized_rep: "I'm authorized to represent it",
};

/** Claim states in the words the app shows (pending -> "pending review", etc.). */
export const CLAIM_STATUS_LABEL: Record<MyClaim["status"], string> = {
  pending: "Pending review",
  needs_info: "More information needed",
  approved: "Verified listing manager",
  denied: "Rejected",
  withdrawn: "Withdrawn",
};

/** Turn a listing RPC's error code into something a person can act on. */
export function listingErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : String((err as { message?: string })?.message ?? err ?? "");
  if (raw.includes("NOT_MODERATOR")) return "Only moderators can do that.";
  if (raw.includes("OWN_CLAIM"))
    return "You can't review your own claim. Another moderator has to.";
  if (raw.includes("RELATIONSHIP_REQUIRED")) return "Say how you're connected to this listing.";
  if (raw.includes("ATTESTATION_REQUIRED"))
    return "Confirm that your claim is accurate and that you're authorized to make it.";
  if (raw.includes("NOTE_REQUIRED")) return "Say what information you need from the claimant.";
  if (raw.includes("NOTE_TOO_LONG")) return "That note is too long.";
  if (raw.includes("CLAIM_NOT_AWAITING_INFO"))
    return "That claim isn't waiting for more information.";
  if (raw.includes("MESSAGE_REQUIRED")) return "Write a reply first.";
  if (raw.includes("EVIDENCE_TOO_LONG")) return "That link is too long.";
  if (raw.includes("ALREADY_CLAIMED")) return "Someone already claims this listing.";
  if (raw.includes("CLAIM_ALREADY_PENDING"))
    return "You already have a claim waiting on this listing.";
  if (raw.includes("CLAIM_NOT_PENDING")) return "That claim was already reviewed.";
  if (raw.includes("CLAIM_NOT_FOUND")) return "That claim no longer exists.";
  if (raw.includes("NOT_CLAIM_OWNER")) return "That claim belongs to someone else.";
  if (raw.includes("LISTING_NOT_FOUND")) return "That listing no longer exists.";
  if (raw.includes("OWNER_SET_BY_CLAIM_ONLY"))
    return "Ownership can only change through an approved claim.";
  if (raw.includes("HANDLE_TAKEN")) return "That handle is already in use.";
  if (raw.includes("ID_TAKEN")) return "A listing with that handle already exists.";
  if (raw.includes("NAME_REQUIRED")) return "Give the listing a name.";
  if (raw.includes("MESSAGE_TOO_LONG")) return "That message is too long.";
  if (raw.includes("USER_MISMATCH") || raw.includes("AUTH_REQUIRED"))
    return "Sign in to claim a listing.";
  return raw || "Something went wrong.";
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await (supabase.rpc as any)(name, args);
  if (error) throw error;
  return data;
}

/** The signed-in viewer's own claim on one listing, if they have filed one. */
export function useMyClaim(subjectType: ListingSubjectType, subjectId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["listing-claim", subjectType, subjectId, user?.id],
    queryFn: async (): Promise<MyClaim | null> => {
      const { data, error } = await (supabase as any)
        .from("listing_claims")
        .select("id, status, denial_reason, info_request, created_at")
        .eq("subject_type", subjectType)
        .eq("subject_id", subjectId)
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        status: data.status,
        denialReason: data.denial_reason ?? null,
        infoRequest: data.info_request ?? null,
        createdAt: data.created_at,
      };
    },
    enabled: !!user && !!subjectId,
    staleTime: 15_000,
  });
}

export function useClaimListing(subjectType: ListingSubjectType, subjectId: string | undefined) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["listing-claim", subjectType, subjectId] });
  };

  const submit = useMutation({
    mutationFn: (v: {
      relationship: ClaimRelationship;
      attest: boolean;
      message?: string;
      evidenceUrl?: string;
    }) =>
      rpc("submit_listing_claim_details", {
        _type: subjectType,
        _id: subjectId,
        _relationship: v.relationship,
        _attest: v.attest,
        _message: v.message ?? null,
        _evidence: v.evidenceUrl ?? null,
      }),
    onSuccess: invalidate,
  });

  const respond = useMutation({
    mutationFn: (v: { claimId: string; message: string; evidenceUrl?: string }) =>
      rpc("respond_listing_claim", {
        _claim: v.claimId,
        _message: v.message,
        _evidence: v.evidenceUrl ?? null,
      }),
    onSuccess: invalidate,
  });

  const withdraw = useMutation({
    mutationFn: (claimId: string) => rpc("withdraw_listing_claim", { _claim: claimId }),
    onSuccess: invalidate,
  });

  return { submit, withdraw, respond };
}
