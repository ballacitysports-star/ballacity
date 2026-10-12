// Review eligibility.
// You can only review someone you shared a real activity with — a started game,
// an accepted training session, or a team you belong to. The database decides
// (`my_reviewable` / `enforce_review_integrity`); this module only reads it.

import { useMemo } from "react";
import { useMyReviewable } from "@/lib/reviews-db";

export type ClosedTxn = {
  id: string;
  counterpartyId: string; // revieweeId you may now review
  counterpartyName: string;
  gameId: string | null;
  context: string;
  date: string; // ISO, when the shared activity happened
  closesAt: string | null; // ISO, last moment a review is accepted (games only)
};

export function useTransactionsWith(revieweeId: string): ClosedTxn[] {
  const { data } = useMyReviewable();
  return useMemo(
    () =>
      (data ?? [])
        .filter((r) => r.revieweeId === revieweeId)
        .map((r) => ({
          id: `${r.revieweeId}:${r.gameId ?? "standing"}`,
          counterpartyId: r.revieweeId,
          counterpartyName: r.revieweeName,
          gameId: r.gameId,
          context: r.context ?? "",
          date: r.happenedAt ?? "",
          closesAt: r.closesAt,
        })),
    [data, revieweeId],
  );
}

export function useCanReview(revieweeId: string): boolean {
  return useTransactionsWith(revieweeId).length > 0;
}
