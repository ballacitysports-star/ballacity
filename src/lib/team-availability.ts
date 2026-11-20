/** Shared, client-safe helpers for per-event team availability. */

import { FEATURE_ERROR_MESSAGES, errorCode, knownErrorMessage } from "@/lib/user-error";

export const AVAILABILITY_STATUSES = ["available", "maybe", "unavailable"] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

export const AVAILABILITY_LABEL: Record<AvailabilityStatus, string> = {
  available: "Available",
  maybe: "Maybe",
  unavailable: "Can't make it",
};

export type AvailabilityAnswer = {
  userId: string;
  status: AvailabilityStatus;
  note: string | null;
  byGuardian: boolean;
};

export type AvailabilitySummary = Record<AvailabilityStatus, number> & { noReply: number };

/**
 * Counts answers for the given roster. Answers from people no longer on the
 * roster are ignored so the totals always add up to the roster size.
 */
export function summarizeAvailability(
  rosterIds: string[],
  answers: AvailabilityAnswer[],
): AvailabilitySummary {
  const byUser = new Map(answers.map((a) => [a.userId, a.status]));
  const summary: AvailabilitySummary = { available: 0, maybe: 0, unavailable: 0, noReply: 0 };
  for (const id of new Set(rosterIds)) {
    const status = byUser.get(id);
    if (status) summary[status] += 1;
    else summary.noReply += 1;
  }
  return summary;
}

export function describeAvailabilityError(message: string | undefined): string {
  // Bare NOT_ALLOWED: say who may answer, which the catalog's general sentence cannot.
  if (errorCode(message) === "NOT_ALLOWED") return FEATURE_ERROR_MESSAGES.availabilityNotAllowed;
  return knownErrorMessage(message) ?? "Couldn't save your availability. Please try again.";
}
