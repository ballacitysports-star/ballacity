import { Link } from "@tanstack/react-router";
import { ShieldAlert, History } from "lucide-react";
import { useMyAgeChangeEvents, useMyChildStatus } from "@/lib/child-safety";
import { COHORT_META, parseCohort } from "@/lib/child-policy";

const OUTCOME_LABELS: Record<string, string> = {
  applied: "Applied",
  review_required: "Held for safety review",
  review_approved: "Approved by safety team",
  review_denied: "Not approved",
};

function cohortLabel(value: string | null): string {
  if (!value) return "Unknown";
  return COHORT_META[parseCohort(value)].short;
}

/**
 * Age-change transparency. Changing a date of birth to a cohort with more
 * permissions never takes effect on its own — the database keeps the previous
 * cohort and flags the account for review. This panel explains that state and
 * shows the history so a member is never silently restricted.
 */
export function AgeReviewNotice() {
  const { status, isLoading } = useMyChildStatus();
  const { events } = useMyAgeChangeEvents();

  if (isLoading || !status) return null;
  const pendingReview = status.ageReviewRequired;
  if (!pendingReview && events.length === 0) return null;

  return (
    <section className="mx-auto mt-4 w-full max-w-xl px-3">
      <div className="rounded-2xl border border-border bg-surface p-4">
        {pendingReview ? (
          <>
            <div className="flex items-center gap-2 text-amber-600">
              <ShieldAlert className="h-4 w-4" aria-hidden />
              <span className="section-eyebrow">
                Age change under review
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Your date of birth changed in a way that would unlock more features, so your account
              keeps its current age settings until our safety team reviews it. Nothing you have
              already set up is affected.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Current age group:{" "}
              <span className="font-semibold">{COHORT_META[status.cohort].label}</span>
            </p>
            <Link
              to="/contact"
              className="mt-2 inline-block text-xs font-semibold text-primary underline"
            >
              Contact support about this review
            </Link>
          </>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground">
            <History className="h-4 w-4" aria-hidden />
            <span className="section-eyebrow">Age change history</span>
          </div>
        )}

        {events.length > 0 ? (
          <ul className="mt-3 space-y-1.5">
            {events.slice(0, 6).map((e) => (
              <li key={e.id} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="min-w-0">
                  <span className="font-medium text-foreground">
                    {OUTCOME_LABELS[e.outcome] ?? e.outcome}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    {cohortLabel(e.fromCohort)} → {cohortLabel(e.toCohort)}
                  </span>
                </span>
                <time className="shrink-0 text-muted-foreground" dateTime={e.createdAt}>
                  {new Date(e.createdAt).toLocaleDateString()}
                </time>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
