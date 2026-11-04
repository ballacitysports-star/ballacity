/**
 * First-guardian verification (SEC-4): shared wording and input rules for the
 * staff queue and the family-join page. The database is the enforcement point
 * (staff_verify_guardian_claim and friends); this file only keeps the app's
 * labels and pre-checks in step with it.
 */

/** Verification methods staff_verify_guardian_claim accepts. */
export const VERIFICATION_METHODS = [
  { value: "government_id", label: "Government ID checked" },
  { value: "consent_document", label: "Signed consent document" },
  { value: "video_call", label: "Video call with ID" },
  { value: "school_or_league_record", label: "School or league record" },
  { value: "court_order", label: "Court order / guardianship papers" },
  { value: "other", label: "Other (always needs a second reviewer)" },
] as const;

export type VerificationMethod = (typeof VERIFICATION_METHODS)[number]["value"];

/** Signals that the claimant built a relationship with the child themselves. */
export const SIGNAL_LABELS: Record<string, string> = {
  shared_team: "Shares a team with the child (coach, owner, teammate or team invite)",
  shared_game: "Shares a game with the child (host, player or join request)",
  contact_request: "Sent or received a contact request with the child",
  conversation: "Already has a conversation with the child",
};

export function describeSignals(signals: readonly string[] | null | undefined): string[] {
  return (signals ?? []).map((s) => SIGNAL_LABELS[s] ?? s.replace(/_/g, " "));
}

/**
 * Mirrors private_sec.guardian_case_ref: a case reference in the support
 * system, never the evidence itself. 8 to 64 characters, a 2-10 letter prefix,
 * a hyphen, at least 4 digits and an optional suffix (GV-20261104,
 * ZD-48213-B). Case does not matter; the database stores it upper-case.
 */
export const CASE_REF_PATTERN = /^[A-Z]{2,10}-[0-9]{4,}(-[A-Z0-9]{1,20})?$/;

export function normalizeCaseRef(ref: string): string {
  return ref.trim().toUpperCase();
}

export function evidenceRefProblem(ref: string): string | null {
  const v = normalizeCaseRef(ref);
  if (v.length < 8 || v.length > 64 || !CASE_REF_PATTERN.test(v))
    return "Use the case reference (like GV-20261104 or ZD-48213-B), never the document or a link.";
  return null;
}

/** Why a claim needs two reviewers (private_sec.guardian_claim_suspicion). */
export const SUSPICION_LABELS: Record<string, string> = {
  relationship_signals: "Already knows the player through BallaCity",
  name_mismatch: "The invitation named a different child",
  other_claims: "This person has other open or declined claims",
  method_other: "Verified by an 'other' method",
  reopened_on_appeal: "Reopened after an appeal",
  account_recovery: "Account recovery",
  link_restoration: "Restoring a link revoked for suspected fraud",
  fraud_revocation: "Revoked for suspected fraud",
};

export function describeSuspicion(reasons: readonly string[] | null | undefined): string[] {
  return (reasons ?? []).map((r) => SUSPICION_LABELS[r] ?? r.replace(/_/g, " "));
}

export type ReviewStage = "single_review" | "first_review" | "second_review";

/** The verify button's label for where the claim's review stands. */
export function verifyActionLabel(stage: ReviewStage): string {
  if (stage === "first_review") return "Record first review";
  if (stage === "second_review") return "Second review: verify and link";
  return "Verify and link";
}

/** What staff see about the invitation's child name versus the redeemer's profile. */
export function nameMatchNote(
  inviteChildName: string | null | undefined,
  nameMatch: boolean | null | undefined,
): string | null {
  if (!inviteChildName) return null;
  if (nameMatch === false)
    return `Invitation was for "${inviteChildName}", which does not match this player: a forwarded or stolen link?`;
  return `Invitation was for "${inviteChildName}".`;
}

/** The message after a staff verification call, from its result. */
export function verifyResultMessage(result: unknown): string {
  return result === "second_review_required"
    ? "First review recorded. A different staff member must make the second review."
    : "Verified. The guardian is now linked.";
}

/** Mirrors the database rule for decline, revoke and restore reasons. */
export function reasonProblem(reason: string): string | null {
  const v = reason.trim();
  if (v.length < 4) return "Give a reason (at least 4 characters).";
  if (v.length > 500) return "Keep the reason under 500 characters.";
  return null;
}

/** Friendly text for the error codes the SEC-4 functions raise. */
export function friendlyGuardianClaimError(message: string | null | undefined): string {
  const m = message ?? "";
  if (m.includes("SIGNALS_NOT_ACKNOWLEDGED"))
    return "This person already shares a team, game or conversation with the child. Confirm you checked that before verifying.";
  if (m.includes("SECOND_REVIEWER_REQUIRED"))
    return "You made the first review. A different staff member must make the second.";
  if (m.includes("CONFLICT_OF_INTEREST"))
    return "You cannot review this: you are part of it, submitted it or declined it before.";
  if (m.includes("EVIDENCE_REQUIRED"))
    return "Use the case reference (like GV-20261104), never the document or a link.";
  if (m.includes("APPEAL_EXISTS")) return "This decision was already appealed.";
  if (m.includes("APPEAL_NOT_AVAILABLE")) return "Only a claim BallaCity declined can be appealed.";
  if (m.includes("APPEAL_WINDOW_CLOSED")) return "Appeals close 30 days after the decision.";
  if (m.includes("APPEAL_RATE_LIMITED")) return "Too many appeals recently. Contact support.";
  if (m.includes("APPEAL_REASON_REQUIRED")) return "Explain the appeal (at least 20 characters).";
  if (m.includes("HOLD_EXISTS")) return "This guardian is already suspended.";
  if (m.includes("CLAIM_ALREADY_OPEN")) return "A newer claim between them is already waiting.";
  if (m.includes("METHOD_INVALID")) return "Choose how the guardian was verified.";
  if (m.includes("GUARDIAN_NOT_ELIGIBLE"))
    return "The guardian must be a verified adult account in good standing.";
  if (m.includes("CHILD_NOT_MINOR")) return "This account is no longer a minor.";
  if (m.includes("BLOCKED")) return "One of them has blocked the other.";
  if (m.includes("REASON_REQUIRED")) return "Give a reason.";
  if (m.includes("REQUEST_NOT_FOUND")) return "That request is no longer waiting.";
  if (m.includes("LINK_NOT_FOUND")) return "That link is no longer in that state.";
  if (m.includes("NOT_AUTHORIZED")) return "Only BallaCity staff can do this.";
  return "Something went wrong. Please try again.";
}
