## Goal
Add Vitest integration coverage proving the trainer venue filter narrows both (a) the trainers feed list and (b) the availability month resolver.

## Changes

### 1. Extract a pure feed filter (small refactor)
The current venue-filter logic lives inline inside a `useMemo` in `src/routes/_tabs.trainers.tsx` and can't be imported by tests. Extract it into a pure helper so it's testable without rendering the route.

- New: `src/lib/trainer-feed-filter.ts`
  - `filterTrainersByVenue(orgs: Org[], venue: string): Org[]` — case-insensitive, trim-normalized match against `org.venueAddresses`, returns all `coach`-kind orgs when `venue` is empty (mirrors current inline behavior).
- Update `src/routes/_tabs.trainers.tsx` to call the helper in place of the inline `.filter(...)` (behavior-preserving; no UI change).

### 2. New test files

- `src/lib/trainer-feed-filter.test.ts`
  - Empty venue → returns all coach orgs unchanged.
  - Exact-match venue narrows to trainers offering that address.
  - Case + whitespace insensitive.
  - Non-coach orgs (teams) are excluded when filter is applied.
  - Trainer with multiple venues matches on any of them.
  - Unknown venue → empty result.

- `src/lib/availability-resolve.venue.test.ts`
  - Weekly-only slots: `resolveDay` with `venueFilter` set returns only windows whose `venue` matches (case/whitespace-insensitive).
  - Rules-tier slots: recurring rule with venue A vs B — filter keeps only A.
  - Overrides tier: date override with per-venue windows — filter narrows correctly.
  - Merged tiers (weekly + rule + override same day): filter applies across all sources; dedupe still respects venue.
  - `venueFilter` = null/"" returns the full unfiltered set.
  - Windows without a `venue` field are excluded when a filter is active.

## Technical notes
- Tests use existing Vitest setup (mirrors `notification-prefs.test.ts`, `distance.test.ts`); no new deps.
- Fixtures are inline plain objects — no DB, no Supabase, no React rendering — keeping these as fast integration tests around pure logic.
- Resolver tests import `resolveDay` from `src/lib/availability-resolve.ts` and exercise the exported public API only.
- Feed tests import from the new `trainer-feed-filter.ts`; the route file only changes to call the helper.

## Out of scope
- E2E (Playwright) coverage of the feed URL param — already implicitly covered by sticky-filter work; can be added later if desired.
- Distance/radius, sport, specialty filters (not part of this request).