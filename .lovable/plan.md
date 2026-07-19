## Add Trainers / Gyms switchable tabs on the Trainers page

Currently `/trainers` lists only individual trainer profiles (orgs where `kind === "coach"`). Gyms/organizations already exist as `trainer_orgs` (with a detail page at `/orgs/$orgId`) but have no browse surface. We'll add a segmented toggle at the top of the Trainers page to switch between the two lists.

### Changes

**1. `src/routes/_tabs.trainers.tsx`**
- Extend `trainersSearchSchema` with `mode: "trainers" | "gyms"` (default `"trainers"`), persisted via URL like other filters.
- Add a two-button segmented control right under the page header ("Trainers" / "Gyms"), styled to match existing pill toggles on the page.
- When `mode === "trainers"`: current behavior (unchanged list, filters, map, sort, density toggle).
- When `mode === "gyms"`:
  - Source data from the existing `listTrainerOrgs` query (already loaded).
  - Reuse the search input (filters name / city / handle) and the density (grid/list) + map/list view toggles.
  - Hide filters that only make sense for trainers (specialty, availability, session rate, org membership filter). Keep: search, sport (if we store gym sports — otherwise hide), city, distance radius, sort (nearest / A–Z).
  - Render each gym with an `OrgCard`-style tile linking to `/orgs/{id}`.
- Update page `<h1>` / meta title to reflect the active tab ("Trainers" vs "Gyms near you").

**2. Empty + loading states**
- Reuse existing skeletons; add a "No gyms yet — create one" CTA linking to the gym creation flow (currently `/teams/create` scoped to gyms if we have it, otherwise omit the CTA and just show empty copy).

### Out of scope
- No schema changes. No new gym creation flow (trainer_orgs are created from the trainer wizard today).
- No changes to `/orgs/$orgId` detail page.
- No changes to Teams page.

### Technical notes
- URL stays shareable: `/trainers?mode=gyms&q=...&sort=nearest`.
- Distance sort for gyms uses the gym's `city` → geocoded lat/lng if available on `trainer_orgs`; if not present, we fall back to A–Z and hide the radius slider for gyms.
