# Fix real distance between users and events

## What's wrong (verified)

- Games store a fixed `distance_mi` value in the database, and cards render that stored number directly (`<Distance mi={game.distanceMi} />` in the feed card, list row, and request card). It is never computed against the viewer.
- The only real hosted game in the database has `distance_mi = 0` and `lat = 50, lng = 50` — placeholder coordinates in the middle of the ocean, not the Kentucky address on the event.
- Cause: the create-game venue field renders the address autocomplete without capturing the selected place's coordinates, so the save path falls back to its `lat ?? 50, lng ?? 50` defaults. With no real coordinates, no correct distance is possible.

## What we'll change

1. **Capture real coordinates when a host picks a venue**
   - Wire the venue autocomplete's place-selection callback in game creation so the chosen place's latitude/longitude are stored with the game.
   - If a host types a free-text address without picking a suggestion, geocode it on save using the existing geocoding helper.
   - Only write coordinates we actually resolved; never fall back to placeholder values. Store null instead so the UI can say "distance unavailable".

2. **Compute distance at display time, per viewer**
   - Stop trusting the stored `distance_mi` for display. Compute distance with the existing great-circle helper from the viewer's location to the event's coordinates, in the viewer's unit (mi/km).
   - Apply this everywhere games show a distance: feed cards, list rows, request cards, map pins, and the game details page.
   - Distance filtering and "nearest" sorting use the same computed value, so the number shown and the radius filter always agree.

3. **Clear states when distance can't be computed**
   - Viewer location not granted: show a small "Enable location" affordance instead of a fake number.
   - Event has no coordinates: show the venue text only, no distance.

4. **Fix the existing data**
   - Backfill coordinates for existing games that have placeholder or missing values by geocoding their saved address, and clear the stale `distance_mi` values so nothing renders a hardcoded number.

5. **Regression tests**
   - Unit tests for the distance computation and formatting: known city pairs produce expected mileage, unit conversion is correct, and missing viewer or event coordinates yield no distance rather than 0.

## Technical notes

- Coordinate capture: pass `onPick` from `LocationAutocomplete` (it already returns `{ lat, lng, formattedAddress }`) into the create-game state; fall back to `src/lib/geocode.functions.ts` on submit.
- Remove the `lat ?? 50` / `lng ?? 50` and `distance_mi ?? 0` defaults in `src/lib/hosted-games-store.ts`; make `lat`/`lng` nullable in the mapped `Game` type.
- Add a shared `useGameDistanceMi(game)` style helper built on `haversineKm` + `MI_PER_KM` from `src/lib/geo.ts`, consumed by `GameCard`, `GameListRow`, `RequestGameCard`, `PlayMapView`, and `games.$gameId.index.tsx`.
- Feed already computes real distance for team posts the correct way; games will follow that same pattern.
- Backfill runs as a migration/one-off geocode pass over `hosted_games` rows where `lat`/`lng` are null or equal the placeholder pair.
