## Goal
Keep the selected venue filter sticky as I move between the trainers feed → trainer profile → booking sheet, so I don't have to re-pick it at each stop.

## Current state (verified)
- Feed (`src/routes/_tabs.trainers.tsx`) reads/writes `venue` in the URL via `validateSearch`.
- Profile (`src/routes/trainers.$trainerId.tsx`) already has its own `venue` search param, but nothing hands the feed's `venue` to it — clicking a trainer card via `OrgCard` drops the selection.
- Profile → booking: `BookSessionSheet` accepts `prefill.venue`, but the profile only passes it through explicit "Book" clicks; opening from the top-level Book button ignores the currently-selected venue chip.
- `TrainerActions` (feed row action) opens `BookSessionSheet` with no prefill, so the feed's venue selection is lost when booking directly from the list.
- `OrgCard` is shared with teams and currently has no way to forward search params.

## Changes
1. **Forward venue from feed → profile**
   - `src/components/OrgCard.tsx`: accept optional `search` prop and pass it to the `<Link>`. Keep default behavior for teams.
   - `src/routes/_tabs.trainers.tsx`: when rendering trainer `OrgCard`s, pass `search={venue ? { venue } : undefined}`. Only forward when the venue exists on that trainer's `venueAddresses` (avoid pre-selecting a venue the trainer doesn't offer).

2. **Forward venue from feed → booking (list action)**
   - `src/components/TrainerActions.tsx`: accept an optional `defaultVenue?: string | null` prop and pass it as `prefill={{ venue: defaultVenue }}` to `BookSessionSheet` (only if that trainer offers it).
   - `_tabs.trainers.tsx`: pass `defaultVenue={venue || null}` to each `<TrainerActions>`.

3. **Forward venue from profile → booking**
   - `src/routes/trainers.$trainerId.tsx`: when opening the sheet from the main "Book" CTA (currently sets `bookPrefill` to null), seed it with `{ venue: selectedVenue || null }` if the trainer offers it. The existing "book from calendar / next-available" flows already merge venue and stay intact.

4. **Preserve venue on profile back-link**
   - `src/routes/trainers.$trainerId.tsx`: the "Back to trainers" `<Link to="/trainers">` currently drops search. Change it to `search={selectedVenue ? { venue: selectedVenue } : undefined}` so returning to the feed keeps the same venue filter.

## Non-goals
- No schema, DB, or booking-logic changes.
- No changes to team navigation, only trainer surfaces.
- Radius / other filters are out of scope for this pass.

## Verification
- Typecheck.
- Manually: select a venue chip on the trainers feed → tap a trainer card → profile shows that venue selected → tap Book → sheet is prefilled with that venue → back arrow returns to the feed with the venue chip still active.
