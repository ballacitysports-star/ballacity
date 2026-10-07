/**
 * Featured facilities are hand-picked highlights at the top of the /orgs
 * directory. The cap keeps "Featured" meaningful: if everyone is featured,
 * no one is.
 */
export const MAX_FEATURED_ORGS = 6;

export function canFeatureAnother(currentCount: number): boolean {
  return currentCount < MAX_FEATURED_ORGS;
}

export function isFeatured(org: { featured_at?: string | null }): boolean {
  return !!org.featured_at;
}
