/** Minimal team / trainer shape the directory text search looks at. */
export type OrgSearchable = {
  name: string;
  handle: string;
  tagline: string;
  city: string;
  sports: readonly string[];
};

/**
 * Case-insensitive substring match used by the teams, trainers and Discover
 * searches, so the same query finds the same orgs everywhere.
 */
export function matchesOrgQuery(o: OrgSearchable, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (o.name + o.handle + o.tagline + o.city + o.sports.join(" "))
    .toLowerCase()
    .includes(needle);
}
