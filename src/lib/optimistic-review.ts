/**
 * The host's optimistic approve or decline on the game page, and its undo when the review fails.
 * Kept apart from the page so the order of taps, undos and reads can be tested directly.
 *
 * The undo puts back only the row the tap changed, not the whole list as it was at the tap.
 * Between the tap and the undo the list can change: a read sent after the tap can land (it holds
 * the server's rows, newer than the list at the tap), and the host can tap another row, since each
 * row has its own busy state. Putting the whole old list back would wipe both. Putting back one row
 * keeps them, and for that row the server still holds the old status, because the review failed.
 * The row goes back only while it still shows this tap's mark: once a read has replaced it, the
 * read holds the server's row, and that wins even when the review threw but landed after all.
 */
import type { JoinRequest } from "@/lib/payments";

/** The list with row `reqId` shown as reviewed, and the row as it was before, if it was there. */
export function markReviewed(
  rows: JoinRequest[],
  reqId: string,
  status: "approved" | "rejected",
  reviewedAt: string,
): { rows: JoinRequest[]; before: JoinRequest | undefined } {
  const before = rows.find((r) => r.id === reqId);
  return {
    rows: rows.map((r) => (r.id === reqId ? { ...r, status, reviewed_at: reviewedAt } : r)),
    before,
  };
}

/**
 * The list with row `before` put back as it was before the tap, if the row still carries the
 * tap's mark (`reviewedAt`, which no server row shares). Nothing changes when the row was not in
 * the list at the tap, when it has left the list since, or when a read has replaced it since.
 */
export function undoReview(
  rows: JoinRequest[],
  before: JoinRequest | undefined,
  reviewedAt: string,
): JoinRequest[] {
  if (!before) return rows;
  return rows.map((r) => (r.id === before.id && r.reviewed_at === reviewedAt ? before : r));
}
