/**
 * Who counts as a minor for what a player's public pages show about where they will be.
 *
 * age_cohort_of answers "unknown" for an account with no birthday, and a lookup can fail. Both used
 * to read as adult on the passport and the player card, so a child who never entered a birthday, or
 * any child during a failed read, had their attendance, upcoming runs and venues published. Only a
 * confirmed adult cohort lifts the floor; anything else, a new cohort value included, keeps it.
 */
export const MINOR_COHORTS: readonly string[] = ["child_under_13", "teen_13_15", "teen_16_17"];

/** True unless the cohort is a confirmed adult and the lookup succeeded. */
export function keepsMinorPrivacyFloor(cohort: unknown, lookupFailed = false): boolean {
  return lookupFailed || cohort !== "adult";
}

/** A confirmed minor cohort: for what is shown about the person (guardian badge, contact the guardian). */
export function isConfirmedMinorCohort(cohort: unknown): boolean {
  return typeof cohort === "string" && MINOR_COHORTS.includes(cohort);
}
