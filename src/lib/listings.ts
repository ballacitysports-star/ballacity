import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { ListingSubjectType } from "@/lib/listings.functions";

export type MyClaim = {
  id: string;
  status: "pending" | "approved" | "denied" | "withdrawn";
  denialReason: string | null;
  createdAt: string;
};

/** Turn a listing RPC's error code into something a person can act on. */
export function listingErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : String((err as { message?: string })?.message ?? err ?? "");
  if (raw.includes("NOT_MODERATOR")) return "Only moderators can do that.";
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
        .select("id, status, denial_reason, created_at")
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
    mutationFn: (v: { message?: string; evidenceUrl?: string }) =>
      rpc("submit_listing_claim", {
        _type: subjectType,
        _id: subjectId,
        _message: v.message ?? null,
        _evidence: v.evidenceUrl ?? null,
      }),
    onSuccess: invalidate,
  });

  const withdraw = useMutation({
    mutationFn: (claimId: string) => rpc("withdraw_listing_claim", { _claim: claimId }),
    onSuccess: invalidate,
  });

  return { submit, withdraw };
}
