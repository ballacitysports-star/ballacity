# Bias Places autocomplete to user location

The server function `autocompletePlaces` already accepts `lat`/`lng` and applies a 50 km `locationBias` + `origin` (for distance-sorted results). Callers currently don't pass coordinates, so results aren't near the user. Wire in the existing `useUserLocation` hook everywhere autocomplete runs, and request coordinates on demand.

## Changes

1. **`src/components/LocationAutocomplete.tsx`**
   - Read `useUserLocation()` from `@/lib/geo`.
   - On first focus/typing, if `status === "idle"`, call `request()` once (silent — no toast; browser prompt is enough).
   - Pass `lat`/`lng` from `coords` into every `autocomplete({ data: { input, sessionToken, lat, lng } })` call.
   - Include coords in the react-query `queryKey` so results refetch once the user grants permission.

2. **`src/components/create/CreateTrainerWizard.tsx`** (gym typeahead)
   - Same treatment: import `useUserLocation`, trigger `request()` on first keystroke, pass `lat`/`lng` into the `placesAutocomplete` call, and include them in the query key.

3. **No server changes** — `autocompletePlaces` already supports the bias.

## Behavior notes

- If the user denies or dismisses the geolocation prompt, autocomplete falls back to unbiased (current behavior). No blocking UI.
- Coords are cached in `sessionStorage` by `useUserLocation`, so the prompt appears at most once per session across the app.
- `origin` is set alongside `locationBias`, so Google returns suggestions sorted by distance from the user within ~50 km.
