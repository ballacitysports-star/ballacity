import type { Org } from "./sample-data";

/**
 * Narrow a list of orgs to trainers ("coach" kind) that offer the given venue address.
 * Matching is case- and whitespace-insensitive. An empty/whitespace venue returns
 * all coach orgs unchanged (mirrors the trainers-feed inline behavior).
 */
export function filterTrainersByVenue(orgs: Org[], venue: string): Org[] {
  const coaches = orgs.filter((o) => o.kind === "coach");
  const target = venue.trim().toLowerCase();
  if (!target) return coaches;
  return coaches.filter((o) =>
    (o.venueAddresses ?? []).some((v) => v.trim().toLowerCase() === target),
  );
}
