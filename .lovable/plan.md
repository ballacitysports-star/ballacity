## Problem

Map pin placement mixes two incompatible coordinate systems. `GamesMap` treats every pin's `lat`/`lng` as a 0-100 pseudo value and renders it as a small offset around the current map center. But `TeamsMapView` passes real latitude/longitude from a trainer's/gym's `venueGeo` into that same field, and `PlayersMapView` always uses hash-based pseudo coordinates. Result:

- Trainers/gyms with a real verified venue address are rendered right on top of the viewer, not at their venue.
- Players show up at random spots around the viewer instead of near their city.
- Games behave correctly today only because sample data uses pseudo coords.

## Fix

Introduce an explicit "real coordinates" mode on map pins and use it everywhere we have a real address geocoded.

### 1. `MapPinItem` (in `src/components/GamesMap.tsx`)

Add an optional flag:

```
export type MapPinItem = {
  id: string;
  emoji: string;
  lat: number;
  lng: number;
  urgent?: boolean;
  /** When true, lat/lng are real WGS84 degrees. When false/absent, lat/lng
   *  are 0-100 pseudo values scattered around the map center. */
  real?: boolean;
};
```

### 2. `GamesMap` pin positioning

In `toLatLng` / `repositionPins` / the marker creation effect, branch on `pin.real`:

- `real === true` → use `{ lat: pin.lat, lng: pin.lng }` directly, no offset from center.
- otherwise → keep existing `toLatLng(px, py, center)` behavior for pseudo coords.

Also skip `repositionPins` moving a real-coord marker when the user's center changes — real pins should stay put.

### 3. `TeamsMapView`

When we choose `primary ?? geoList[0]`, mark the pin as real; only fall back to `pseudoLatLngFromId` when no venue geo exists:

```
const chosen = primary ?? geoList[0];
return chosen
  ? { id, emoji, lat: chosen.lat, lng: chosen.lng, real: true }
  : { id, emoji, ...pseudoLatLngFromId(o.id) };
```

### 4. `PlayersMapView`

Players don't currently carry lat/lng. Two-step:

- If a player's availability row has geocodable location data (e.g. `city`), geocode it once via the existing `geocodeAddress` server function and cache the result in a `useMemo`/`useQuery` keyed on `city`. Mark those pins `real: true`.
- Fallback to `pseudoLatLngFromId(user_id)` only when no city is available.

Batching: use a single `useQueries`/parallel `Promise.all` in `PlayersMapView` so we don't fire one server call per render per player. Cache by lowercased city string.

### 5. Auto-centering

`PlayMapView` currently only sets `defaultLocation={profile?.city}` so `GamesMap` geocodes the *viewer's* city as the map center. Keep that. Real-coord pins already ignore the center, so they render at their true location; pseudo pins continue to cluster near the viewer as before.

### 6. Sanity checks

- Verify a trainer with `venueGeo` in New York renders at NYC when the viewer's profile city is San Francisco.
- Verify a player with only `city = "Austin, TX"` renders near Austin, not offset around the viewer.
- Verify games (still pseudo) look unchanged.

## Files touched

- `src/components/GamesMap.tsx` — add `real` flag, branch coordinate math, keep real markers stationary on recenter.
- `src/components/TeamsMapView.tsx` — set `real: true` when venue geo exists.
- `src/components/PlayersMapView.tsx` — geocode player city, set `real: true` when resolved, fallback to pseudo.
- `src/components/PlayMapView.tsx` — no logic change; just passes through the extended `MapPinItem`.

## Out of scope

- Backfilling real coordinates onto games (sample data). Real game rows already store real coords; when we route those through the map we'll pass `real: true` the same way.
- Changing the pseudo-coord fallback distribution.
