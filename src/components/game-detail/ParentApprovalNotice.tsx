import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import type { ChildPolicyState, FeatureDecision } from "@/lib/child-policy";

const FALLBACK_REASON = "A parent or guardian must approve this account first.";

/**
 * A parent/guardian must approve this account before a NEW join; leaving or
 * withdrawing a join made before consent was revoked stays available.
 */
export function consentBlocksNewJoin({
  alreadyInFlow,
  participation,
}: {
  alreadyInFlow: boolean;
  participation: FeatureDecision;
}): boolean {
  return !alreadyInFlow && !participation.allowed;
}

/** States the approval flow (/onboarding/child) can move forward. */
function asksForApproval(state: ChildPolicyState): boolean {
  return (
    state === "PARENTAL_CONSENT_REQUIRED" ||
    state === "PARENTAL_CONSENT_PENDING" ||
    state === "PARENTAL_CONSENT_REVOKED"
  );
}

/**
 * Why the join button is off for a minor, and where to go about it. The button
 * itself stays disabled (the database refuses the join anyway); this replaces a
 * dead, unexplained button with the reason and, when a parent's approval is what
 * is missing, a link to the flow where the minor asks for it. A guardian who
 * turned games off, or an age review, has no step for the minor to take, so
 * those get the reason alone.
 */
export function ParentApprovalNotice({
  reason,
  consentState,
  className = "",
}: {
  reason: string | null;
  consentState: ChildPolicyState;
  className?: string;
}) {
  const showLink = asksForApproval(consentState);
  const pending = consentState === "PARENTAL_CONSENT_PENDING";
  return (
    <p
      className={`flex items-start gap-1.5 text-[11px] font-medium text-muted-foreground ${className}`}
      role="status"
      data-testid="parent-approval-notice"
    >
      <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">
        <span className="font-semibold text-foreground">Can’t join:</span>{" "}
        {reason || FALLBACK_REASON}
        {showLink && (
          <>
            {" "}
            <Link
              to="/onboarding/child"
              className="font-semibold text-primary underline underline-offset-2"
            >
              {pending ? "Check your approval request" : "Ask your parent or guardian"}
            </Link>
          </>
        )}
      </span>
    </p>
  );
}
