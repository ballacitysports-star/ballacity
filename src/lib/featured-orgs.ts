/**
 * Featured facilities are hand-picked highlights at the top of the /orgs
 * directory. The cap keeps "Featured" meaningful: if everyone is featured,
 * no one is.
 */
export const MAX_FEATURED_ORGS = 6;

/** What a moderator reads when the cap is reached (setOrgFeatured); listingErrorMessage shows it as it is. */
export const FEATURED_LIMIT_MESSAGE = `You can feature up to ${MAX_FEATURED_ORGS} facilities. Unfeature one first.`;

/** What a moderator reads when the facility they tried to feature or unfeature is gone (setOrgFeatured). */
export const FACILITY_NOT_FOUND_MESSAGE = "This facility no longer exists. Refresh the list.";

export function canFeatureAnother(currentCount: number): boolean {
  return currentCount < MAX_FEATURED_ORGS;
}

export function isFeatured(org: { featured_at?: string | null }): boolean {
  return !!org.featured_at;
}
