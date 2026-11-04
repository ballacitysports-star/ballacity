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
  { value: "other", label: "Other (describe in the reference)" },
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

/** Mirrors the database rule: a case or ticket reference, 4 to 200 characters. */
export function evidenceRefProblem(ref: string): string | null {
  const v = ref.trim();
  if (v.length < 4) return "Add a reference to the evidence you checked (at least 4 characters).";
  if (v.length > 200) return "Keep the reference under 200 characters.";
  return null;
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
  if (m.includes("CONFLICT_OF_INTEREST"))
    return "You cannot verify a relationship you are part of.";
  if (m.includes("EVIDENCE_REQUIRED")) return "Add a reference to the evidence you checked.";
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
