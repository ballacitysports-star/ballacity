/**
 * Which hard-coded legal copy counsel has reviewed.
 *
 * Copy that lives in code (not in the admin-published `legal_documents`
 * table) shows a "LEGAL REVIEW REQUIRED" tag while it is still a draft. Flip
 * an entry to `true` only once counsel has approved that exact wording; the
 * tags and "pending legal review" phrases for it then disappear everywhere.
 * If counsel changed the wording, also bump that copy's version (for the
 * acknowledgments, SAFETY_ACK_VERSION) so people agree to the new text.
 *
 * Terms, Privacy and the other admin-managed documents are not listed here:
 * their banner clears itself as soon as a version is published.
 */
export const LEGAL_REVIEW = {
  /** Join/host risk acknowledgments and host disclaimer (safety.ts, game-policy.ts). */
  safetyAcknowledgments: false,
  /** Retention periods described in retention.ts and Account → Privacy. */
  retention: false,
} as const;

export type LegalReviewArea = keyof typeof LEGAL_REVIEW;

export function isLegalReviewed(area: LegalReviewArea): boolean {
  return LEGAL_REVIEW[area];
}
