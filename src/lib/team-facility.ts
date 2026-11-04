/**
 * Facility details of youth teams (G2).
 *
 * For a youth team (kind "team") the practice venue columns of `teams` are empty in public once youth-location privacy is on;
 * the real values are in `team_facility_private`, which the database releases to the team's managers and members, verified
 * guardians of members and moderators. Trainers, gyms and facilities (kind "coach") are public businesses and are never touched.
 * Screens load the private row with the viewer's own session (row-level security decides) and overlay it with these helpers.
 */
export type TeamFacilityExact = {
  team_id: string;
  home_court: string | null;
  venues: string[] | null;
  venue_addresses: unknown;
  primary_venue: string | null;
  venue_geo: unknown;
};

type FacilityColumns = {
  id: string;
  kind?: string | null;
  home_court?: string | null;
  venues?: string[] | null;
  venue_addresses?: unknown;
  primary_venue?: string | null;
  venue_geo?: unknown;
};

export function facilityMap(
  rows: TeamFacilityExact[] | null | undefined,
): Map<string, TeamFacilityExact> {
  return new Map((rows ?? []).map((r) => [r.team_id, r]));
}

const isBlankArray = (v: unknown) => !Array.isArray(v) || v.length === 0;

/** Fill the empty public facility columns of a youth team row from what the database released to this viewer. */
export function withExactFacility<T extends FacilityColumns>(
  row: T,
  exact: Map<string, TeamFacilityExact>,
): T {
  const e = exact.get(row.id);
  if (!e || row.kind === "coach") return row;
  return {
    ...row,
    home_court: row.home_court ?? e.home_court,
    venues: isBlankArray(row.venues) ? (e.venues ?? []) : row.venues,
    venue_addresses: isBlankArray(row.venue_addresses)
      ? (e.venue_addresses ?? [])
      : row.venue_addresses,
    primary_venue: row.primary_venue ?? e.primary_venue,
    venue_geo: isBlankArray(row.venue_geo) ? (e.venue_geo ?? []) : row.venue_geo,
  };
}

/** Which facility details an edit removes. Writing an empty value cannot be told from a round trip, so removal is explicit. */
export function clearedFacilityFields(patch: {
  homeCourt?: string | null;
  venues?: string[] | null;
  venueAddresses?: unknown[] | null;
  venueGeo?: unknown[] | null;
}): string[] {
  const out: string[] = [];
  if (patch.homeCourt !== undefined && !(patch.homeCourt ?? "").trim()) out.push("home_court");
  if (patch.venues !== undefined && (patch.venues ?? []).length === 0) out.push("venues");
  if (patch.venueAddresses !== undefined && (patch.venueAddresses ?? []).length === 0)
    out.push("venue_addresses");
  if (patch.venueGeo !== undefined && (patch.venueGeo ?? []).length === 0) out.push("venue_geo");
  return out;
}
