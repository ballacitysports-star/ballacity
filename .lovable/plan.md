## Goal

Every address, gym/venue, and city field in the app uses the same Google Places autocomplete component instead of a plain text box.

## Already done (no change needed)

`LocationAutocomplete` is already used in: game create (`_tabs.create.tsx`), game detail, gym/org form (`OrgForm.tsx` — city + street address), team edit, create-org wizard, create-trainer wizard, and profile basics (city).

## Fields to convert

1. **Available Players filter — "Location"** (`src/routes/available-players.tsx`, ~line 504): city text input → `LocationAutocomplete` with `mode="city"`, keeping the existing clear button and filter state wiring.
2. **Available Players — post availability form "City"** (~line 1008): same swap, `mode="city"`.
3. **Create post sheet — "Location"** (`src/components/CreatePostSheet.tsx`, ~line 145): `placeholder="Venue or address"` → `LocationAutocomplete` in `mode="place"` so it suggests gyms/courts/venues.
4. **Trainer org quick-create — "City (optional)"** (`src/components/TrainerOrgSection.tsx`, ~line 247): swap to `LocationAutocomplete`, `mode="city"`, `showCurrentButton={false}` to keep the compact inline row.

## Notes

- No changes to what gets saved: each field keeps storing the same free-text string, so existing rows and filters keep working. Typing manually still works — suggestions are optional.
- The "Use current location" button is on by default; it will be hidden in the compact trainer row and shown in the fuller forms.
- Behavior is unchanged if Google suggestions fail: the component already falls back to plain typing with a small hint message.

### Technical detail

`LocationAutocomplete` takes `value`/`onChange` (string) plus optional `onPick(value, placeId, geo)`. The four call sites only need the string pair, so no schema, server function, or database change is required. Its backing server functions (`autocompletePlaces`, `getPlaceDetails`) are auth-gated and already deployed.
