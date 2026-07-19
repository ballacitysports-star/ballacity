## Goal

Make the "Search gyms / academies…" input on Step 2 of the trainer wizard (`CreateTrainerWizard.tsx` line 602) behave like a hybrid typeahead — showing both existing orgs from the database AND Google Places suggestions for real-world gyms — so users don't have to click "Create new org" and then re-type the name in a separate address field.

## Current behavior

- The input only queries `listTrainerOrgs` (DB search).
- If no match, the only path forward is a "Create new org "<text>"" button that switches to a new-org panel where the user re-enters the address in a separate `LocationAutocomplete`.
- Google Places is wired for the address field but not for the name search, so users searching for a real gym by name see "No match" and have to start over.

## Proposed changes

Update `src/components/create/CreateTrainerWizard.tsx` only (no schema or server changes needed — `autocompletePlaces` and `getPlaceDetails` already exist and work).

1. Alongside the existing `orgResults` DB query, add a second query using `useServerFn(autocompletePlaces)` keyed on `orgSearch`, debounced (~250 ms) and enabled when `orgSearch.trim().length >= 2`. Bias by the user's location if `useUserLocation` is already handy (optional; skip if it complicates the file).
2. Render the dropdown in two labeled sections when both have results:
   - **Your platform** — existing orgs (current cards, unchanged).
   - **From Google** — up to 5 place suggestions with primary + secondary text and a MapPin icon.
3. Clicking a Google suggestion:
   - Calls `getPlaceDetails` with the session token to resolve `formattedAddress`, `lat`, `lng`.
   - Sets `draft.orgChoice = { mode: "new", name: <primary>, address: <formattedAddress>, placeId, geo: { lat, lng } }` and jumps directly into the existing new-org confirmation panel (which already shows the map preview and lets the user edit name/handle/city/bio before publishing).
4. Keep the manual "Create new org "<text>"" fallback for users typing a name Google doesn't return.
5. Rotate the Places session token after a pick (mirroring `LocationAutocomplete`) to keep billing correct.

## Out of scope

- No changes to `LocationAutocomplete`, `places.functions.ts`, or the DB.
- No changes to the org address field on line 565 (already working — verified live).
- No changes to the venue picker on Step 4 or the city field on Step 1.

## Verification

- Type "Central Park" in the gym search → see existing-org matches (if any) plus Google suggestions.
- Pick a Google suggestion → new-org panel opens with name, address, and map pre-filled.
- Continue through publish → org row in `trainer_orgs` has `address`, `place_id`, `geo` populated.
