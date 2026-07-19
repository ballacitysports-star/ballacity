## Goal

Add an E2E spec that simulates a user opening a bookmarked deep-link URL — one that already carries `venue=` and `radius=` search params — and confirms the venueFilter selection (both venue chip and slider value) is preserved as they move across trainer tabs, into a trainer profile, and into the booking sheet.

## New file

`e2e/trainers-venue-filter-bookmark.spec.ts`

Modeled on the existing `e2e/trainers-venue-filter.spec.ts` for session restore + skip semantics, but starting from a pre-built URL rather than clicking the Filters UI.

## Test flow

1. **Restore Supabase session** (same helper as existing spec; skip if env vars missing).
2. **Pick a real venue** by briefly visiting `/trainers`, opening Filters, reading the first venue chip's `title` and `data-*` (or reusing the same chip-scan helper) to obtain a valid `venue` value present in seeded data. Skip if none.
3. **Construct a bookmarked URL**: `/trainers?venue=<encoded venue>&radius=25` and `page.goto()` it directly (fresh navigation, no prior in-app state).
4. **Assert URL params survive hydration** — after `networkidle`, URL still contains both `venue=` and `radius=25`.
5. **Assert slider reflects bookmarked value**: `getByRole('slider', { name: 'Distance radius' })` has `aria-valuenow="25"`.
6. **Assert venue chip is marked active** (lime border class) when Filters panel is opened.
7. **Cross-tab persistence**: click the Map view toggle (or the tab switcher present on `/trainers`) and assert `venue=` and `radius=25` remain in the URL.
8. **Profile link persistence**: click first trainer card → wait for `/trainers/:id` → assert both params ride along.
9. **Booking sheet persistence**: click `Book session` on the profile → assert the dialog opens and (best-effort) that the sticky venue label appears inside the dialog (via `getByText(venue)` scoped to `role=dialog`).
10. **Back-link persistence**: click "Back to trainers" → assert both params return to the feed URL.

## Notes

- Reuse `restoreSession` and the venue-chip discovery pattern from the existing spec to keep behavior consistent.
- Use `encodeURIComponent(venue)` when building the bookmarked URL.
- Keep the whole spec inside a single `test(...)` so the bookmark → navigation chain is one continuous session.
- Run with `bunx playwright test e2e/trainers-venue-filter-bookmark.spec.ts`.
