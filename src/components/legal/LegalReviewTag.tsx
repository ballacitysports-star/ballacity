import { isLegalReviewed, type LegalReviewArea } from "@/lib/legal-review";
import { LEGAL_REVIEW_LABEL } from "@/lib/safety";

/** The inline "LEGAL REVIEW REQUIRED" tag, hidden once counsel has reviewed `area`. */
export function LegalReviewTag({ area }: { area: LegalReviewArea }) {
  if (isLegalReviewed(area)) return null;
  return (
    <span className="mr-1 rounded bg-secondary px-1.5 py-0.5 micro-label">
      {LEGAL_REVIEW_LABEL}
    </span>
  );
}
