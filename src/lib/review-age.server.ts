/**
 * Age rules for reviews, applied on the server before anything is sent to an AI service or
 * stored. The database enforces the same rules (migration 20261108100000_minor_review_privacy):
 * this module exists so that text about, or written by, a person under 18 is not even sent for
 * moderation or analysis, and so the user gets a plain message instead of a database error.
 *
 * Fail closed: only a confirmed adult passes. An unknown cohort, a missing profile, a failed
 * lookup and an id that is not a user id all count as "not an adult".
 */

export const REVIEW_AUTHOR_MESSAGE = "Reviews are available to adults only for now.";
export const REVIEW_SUBJECT_MESSAGE = "Reviews are not available for this person.";

/** Reviews about these kinds are about a person; the rest are about teams, trainers or places. */
export function isPersonReview(revieweeKind: string): boolean {
  return revieweeKind === "player" || revieweeKind === "host";
}

// The service-role client is typed by the generated function list; this only needs `rpc`.
type Rpc = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (...args: any[]) => PromiseLike<{ data: unknown; error: unknown }>;
};

/** True only when `userId` is a confirmed adult (profiles.age_cohort = 'adult'). */
export async function isConfirmedAdult(
  admin: Rpc,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data, error } = await admin.rpc("age_cohort_of", { _user: userId });
    return !error && data === "adult";
  } catch {
    return false;
  }
}

/** Throws a user-facing Error when the author or (for a person) the subject is not a confirmed adult. */
export async function assertReviewAllowedByAge(
  admin: Rpc,
  input: { authorId: string; revieweeKind: string; revieweeId: string },
): Promise<void> {
  if (!(await isConfirmedAdult(admin, input.authorId))) throw new Error(REVIEW_AUTHOR_MESSAGE);
  if (isPersonReview(input.revieweeKind) && !(await isConfirmedAdult(admin, input.revieweeId))) {
    throw new Error(REVIEW_SUBJECT_MESSAGE);
  }
}

/**
 * Whether AI may read reviews about this subject or write a summary of them. A person who is
 * not a confirmed adult is never analysed or summarised; teams, trainers and places are.
 */
export async function mayAnalyseSubject(
  admin: Rpc,
  input: { revieweeKind: string; revieweeUserId: string | null },
): Promise<boolean> {
  if (!isPersonReview(input.revieweeKind)) return true;
  return isConfirmedAdult(admin, input.revieweeUserId);
}

/**
 * Keeps only the reviews the database says may be published to people other than their author. That is every review
 * written by AND about adults after they were adults: reviews written by or about someone who was under 18 (or of
 * unknown age) when they were written stay nonpublic permanently, even once that person turns 18, so they must not
 * feed an AI summary or an aggregate that others can read either. One call to `publishable_review_ids`
 * (service role); a failed call drops everything (fail closed).
 */
export async function onlyPublishable<T extends { id: string }>(
  admin: Rpc,
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0) return [];
  try {
    const { data, error } = await admin.rpc("publishable_review_ids", {
      _ids: rows.map((r) => r.id),
    });
    if (error || !Array.isArray(data)) return [];
    const ok = new Set((data as unknown[]).map((v) => String(v)));
    return rows.filter((r) => ok.has(String(r.id)));
  } catch {
    return [];
  }
}
