## Goal

Bring Google Places autocomplete to two org/gym touchpoints:

1. **Org/gym profile address** — new full street-address field on org create + edit (currently only "City" is autocompleted).
2. **Trainer wizard "Organization / Gym" typeahead** — when a user searches for an org that isn't in our DB, also show Google Places results so they can create a new org pre-filled with a verified address.

## Changes

### 1. Schema (migration)

Add address columns to `public.trainer_orgs`:
- `address text` — formatted street address
- `place_id text` — Google Place ID (for dedupe / re-verification)
- `geo jsonb` — `{ lat, lng }` for map preview

No RLS/grant changes needed (existing policies on `trainer_orgs` cover new columns).

### 2. Org/gym wizard — add address field

Files: `src/components/CreateOrgWizard.tsx`, `src/routes/teams.$teamId.edit.tsx` (org kind = `coach-org` / gym branch)

- Add an "Address" step field using `<LocationAutocomplete mode="place" />` beneath City.
- Persist `address`, `placeId`, `geo` in draft + submit payload.
- Show `<VenueMapPreview>` under the field when a place is picked (reuse existing component).
- Save through existing `addOrg` / org update path so both create and edit persist.

### 3. Org profile display

File: `src/routes/orgs.$orgId.tsx`
- Render address + small map preview when present.

### 4. Trainer wizard — hybrid org typeahead

File: `src/components/create/CreateTrainerWizard.tsx` (Organization / Gym section)

Current: searches only `listTrainerOrgs` (our DB). "Create new org" uses just the typed name.

New behavior:
- Keep DB results at the top ("Existing orgs").
- Below, when DB has 0–few matches, call `autocompletePlaces` (existing server fn in `src/lib/places.functions.ts`) filtered to establishments to show Google suggestions labeled "From Google".
- Selecting a Google suggestion sets `orgChoice = { mode: "new", name, placeId, address, geo }` (fetch details via `getPlaceDetails` for address + geo).
- On publish, `createTrainerOrg` receives the address/placeId/geo, creating the new org with a verified location in one step.

### 5. Trainer-orgs server fn

File: `src/lib/trainer-orgs.functions.ts`
- Extend `createTrainerOrg` input validator + insert to accept optional `address`, `placeId`, `geo`.

## Non-goals

- No changes to venue/session-venue flows (already Google-autocompleted).
- No changes to team wizard address (teams don't need a street address).

## Technical notes

- Reuse `LocationAutocomplete`, `autocompletePlaces`, `getPlaceDetails`, `VenueMapPreview` — no new libraries.
- Zod schema in `createTrainerOrg` guards optional address fields.
- Migration is additive; existing orgs remain valid with null address.
