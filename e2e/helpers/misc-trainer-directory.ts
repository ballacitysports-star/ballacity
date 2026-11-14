/**
 * A fixed trainer directory for the /trainers venue-filter specs.
 *
 * Those specs used to read whatever trainers the backend held and skip when
 * none had a venue, so the outcome depended on the data in each place: the
 * local stack has no trainers at all, and the shared sandbox has whatever
 * other runs left. Instead, `listTeams` (the server function the org store
 * hydrates from) answers with two coaches at two different venues, so the
 * venue filter always has something to narrow, and to narrow by exactly one.
 *
 * Everything else on the page (ratings, follower counts, the booking sheet's
 * reads) still goes to the real backend with the real session.
 */
import type { Page } from "@playwright/test";
import type { Sport } from "../../src/lib/sample-data";
import { stubServerFn } from "./server-fn";

/** Every sport, so the viewer's own default sport filter can never hide a coach. */
const ALL_SPORTS: Sport[] = [
  "Baseball",
  "Basketball",
  "Football",
  "Pickleball",
  "Running",
  "Soccer",
  "Softball",
  "Tennis",
  "Volleyball",
];

export type LatLng = { lat: number; lng: number };

export type DirectoryCoach = { id: string; name: string; venue: string; geo: LatLng };

/**
 * A viewer location in Springfield, IL. Both venues below are a few km from it,
 * well inside the bookmark spec's 25-mile radius, so only the venue filter can
 * hide a coach there, never the radius.
 */
export const SPRINGFIELD_VIEWER: LatLng = { lat: 39.7817, lng: -89.6501 };

/** Filtered to by the specs. The chip shows the part before the first comma. */
export const HARBOR_COACH: DirectoryCoach = {
  id: "3c1d4a52-6b7e-4f80-9a1b-2c3d4e5f6a71",
  name: "Harbor Skills Lab",
  venue: "Harbor Fieldhouse, 12 Pier Rd, Springfield",
  geo: { lat: 39.8017, lng: -89.6436 },
};

/** The coach the venue filter must hide. */
export const NORTHSIDE_COACH: DirectoryCoach = {
  id: "3c1d4a52-6b7e-4f80-9a1b-2c3d4e5f6a72",
  name: "Northside Hoops Coaching",
  venue: "Northside Rec Center, 400 Elm St, Springfield",
  geo: { lat: 39.8317, lng: -89.6401 },
};

/** No fixture account owns these, so the profile shows the visitor's "Book session" bar. */
const UNCLAIMED_OWNER = "3c1d4a52-6b7e-4f80-9a1b-2c3d4e5f6a00";

function coachRow(coach: DirectoryCoach, createdAt: string) {
  return {
    id: coach.id,
    owner_id: UNCLAIMED_OWNER,
    kind: "coach",
    name: coach.name,
    handle: coach.name.toLowerCase().replace(/[^a-z]+/g, ""),
    tagline: "Private and small-group sessions",
    city: "Springfield",
    founded: 2020,
    sports: ALL_SPORTS,
    bio: "",
    achievements: [],
    accent: "#a3ff12",
    avatar: coach.name.slice(0, 2).toUpperCase(),
    avatar_url: null,
    cover: "",
    league: null,
    home_court: null,
    wins: 0,
    losses: 0,
    staff: [],
    credentials: [],
    rate_per_hour: 60,
    skill_min: 1,
    skill_max: 5,
    followers: 0,
    verified: true,
    format: null,
    formats: [],
    venues: [coach.venue.split(",")[0]],
    venue_addresses: [coach.venue],
    venue_geo: [{ address: coach.venue, placeId: `e2e-${coach.id}`, ...coach.geo }],
    primary_venue: coach.venue,
    cadence: "Weekly",
    cadences: ["Weekly"],
    positions_needed: {},
    rating_system: null,
    rating_min: null,
    rating_max: null,
    distances: [],
    session_types: ["1:1"],
    age_groups: [],
    availability_slots: [],
    availability_overrides: [],
    availability_rules: [],
    timezone: "America/New_York",
    cancel_cutoff_min: null,
    refund_rule: null,
    late_refund_pct: null,
    created_at: createdAt,
  };
}

/** Answer `listTeams` with the two coaches above. Call before the first navigation. */
export async function stubTrainerDirectory(page: Page) {
  // The decoded server-fn id names the export; `listMyTeams` must not match.
  await stubServerFn(page, /(^|[^A-Za-z])listTeams([^A-Za-z]|$)/, [
    coachRow(HARBOR_COACH, "2026-10-02T12:00:00Z"),
    coachRow(NORTHSIDE_COACH, "2026-10-01T12:00:00Z"),
  ]);
}
