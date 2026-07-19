## Goal
The selected "Name" input in `src/components/OrgForm.tsx` (line 77) is a plain text field. Turn it into a Google Places-powered gym/business search — the same pattern used in `CreateTrainerWizard` — so picking a suggestion auto-fills Name, Address, City, place ID, and geo coordinates in one step.

(City and Address fields already use `LocationAutocomplete` and are working; only Name is missing autocomplete.)

## Changes

1. **`src/components/OrgForm.tsx`**
   - Replace the plain Name `<input>` with a Google Places-backed combobox using `autocompletePlaces` + `getPlaceDetails` server functions (already used by `LocationAutocomplete`).
   - Free typing still works (user can create a brand-new org name that isn't a listed business).
   - On suggestion pick:
     - `name` ← business primary name
     - `address` ← formatted address (from place details)
     - `placeId` ← Google place id
     - `geo` ← `{ lat, lng }`
     - `city` ← derived from place details (only if currently empty, to avoid overwriting)
   - Bias results to the user's current location (reuse the geolocation-bias pattern from `LocationAutocomplete`).
   - Debounced 250ms queries, session-token rotation on pick (Places billing convention).

2. No backend changes — `autocompletePlaces` / `getPlaceDetails` server functions already exist and route through the Google Maps connector gateway.

## Result
Typing a gym name in the create/edit org flow (`/orgs/create`, `/orgs/$orgId/edit`) surfaces Google business suggestions; picking one fills the identity + location sections at once, while still allowing manual entry.
