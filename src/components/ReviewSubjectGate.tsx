import type { ReactNode } from "react";
import { useReviewSubjectIsAdult } from "@/lib/review-subject";
import type { RevieweeKind } from "@/lib/reviews";

/**
 * Renders its children only for a subject whose reviews and reputation may be shown: a confirmed
 * adult, or something that is not a person (a team, trainer or place). For a person under 18, a
 * person of unknown age, or while the age is still loading, it renders nothing.
 */
export function ReviewSubjectGate({
  revieweeId,
  revieweeKind = "player",
  children,
}: {
  revieweeId: string;
  revieweeKind?: RevieweeKind;
  children: ReactNode;
}) {
  const adult = useReviewSubjectIsAdult(revieweeId, revieweeKind);
  return adult === true ? <>{children}</> : null;
}
