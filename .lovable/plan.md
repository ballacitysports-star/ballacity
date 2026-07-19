# Add location-biased Google Places to the trainer edit screen

Mirror what the create wizard has: the "Search gyms / academies…" typeahead in `src/routes/teams.$teamId.edit.tsx` (the shared edit screen used by both `/teams/$teamId/edit` and `/trainers/$trainerId/edit`) currently searches only the OpenRun DB. Add Google Places suggestions biased to the user's location, and pipe the picked place's address + coordinates into the "create new org" path so a new gym gets a verified location on save.

## Changes to `src/routes/teams.$teamId.edit.tsx`

1. Imports
   - Add `useUserLocation` from `@/lib/geo`.
   - Add `autocompletePlaces`, `getPlaceDetails` from `@/lib/places.functions`.
   - Add `MapPin` from `lucide-react`.

2. Extend `OrgChoice` (line 109):
   ```ts
   type OrgChoice = {
     mode: "existing" | "new" | null;
     orgId?: string;
     name?: string;
     address?: string;
     placeId?: string;
     geo?: { lat: number; lng: number } | null;
   };
   ```

3. Near the existing `orgResults` query (~line 190):
   - Wire `useServerFn` for `autocompletePlaces` + `getPlaceDetails`.
   - Read `useUserLocation()` for `coords`, `status`, `request`.
   - Debounce `orgSearch` into `orgSearchDebounced` (250 ms).
   - Trigger `request()` once when the user first types (status === "idle").
   - Add a `placesResults` query keyed on `[debounced, sessionToken, lat, lng]` calling `placesAutocomplete({ data: { input, sessionToken, lat, lng } })`, enabled only when `kind === "coach"` and length ≥ 2.
   - Add `pickPlaceAsNewOrg(id, primary, secondary)` that sets `OrgChoice` to `{ mode: "new", name: primary, address: primary+secondary, placeId, geo: null }`, rotates the session token, then enriches with `getPlaceDetails` to fill `address` (formatted) and `geo` (lat/lng).

4. Dropdown (~line 752): after the "No match" line, render a "From Google" section listing `placesResults.data?.suggestions` with `MapPin` icon; each button calls `pickPlaceAsNewOrg`. Show a "Searching Google…" line while `placesResults.isLoading`.

5. In `applyOrgChoiceChange` (line 317), forward the extra fields when creating a new org:
   ```ts
   await createOrg({
     data: {
       name: orgChoice.name,
       handle: orgHandle,
       trainerId: org.id,
       city: city || undefined,
       address: orgChoice.address,
       placeId: orgChoice.placeId,
       geo: orgChoice.geo ?? undefined,
     },
   });
   ```

No server or schema changes — `autocompletePlaces` already accepts `lat`/`lng` bias, and `createTrainerOrg` already accepts `address`/`placeId`/`geo`.
