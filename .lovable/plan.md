## Distance slider for trainer venue filter

Add a "Within X miles" slider next to the venue filter on `/trainers` that narrows results to trainers whose venues fall inside a radius from the user's current location. Respects existing `distanceUnit` pref (`mi`/`km`).

### Behavior
- Slider range 1–100 (unit from `useUserPrefs().distanceUnit`), default 25, step 1. `0` treated as "any distance" and hidden from the UI by using `Off` as the lowest label when the user clears it.
- Filter applies to any trainer with at least one `venueGeo` entry inside the radius. Trainers without `venueGeo` are excluded ONLY when a radius is active (so the default view still shows everyone).
- Requires user location. On first slider interaction, request `navigator.geolocation.getCurrentPosition`. On deny/error, show inline "Enable location to filter by distance" hint with a retry button and log via existing `location-denial-telemetry`.
- Sort: when the slider is active and `sort=nearest`, sort by the min-distance to any venue. When inactive, keep existing `nearest` behavior unchanged.
- Reveal per-card min-distance chip ("3.2 mi") on the trainer card when a radius is set.

### URL state
Extend `trainersSearchSchema` in `src/routes/_tabs.trainers.tsx`:
- `radius: fallback(z.coerce.number().min(0).max(200), 0).default(0)` (in the user's unit; 0 = off).

Included in the active-filter counter chip and cleared by "Reset filters".

### Implementation

1. **`src/lib/geo.ts` (new)** — small util:
   - `haversineKm(a, b)` returning km.
   - `useUserLocation()` hook: exposes `{ coords, status, request }` where `status ∈ 'idle'|'prompting'|'granted'|'denied'|'unsupported'`. Caches the last successful fix in `sessionStorage` for 10 minutes to avoid re-prompting on route re-mounts.

2. **`src/routes/_tabs.trainers.tsx`**
   - Add `radius` to schema and derive `radiusUnitVal` from search.
   - Convert to km using `distanceUnit`.
   - In the filter memo, when `radiusKm > 0 && coords`, compute `minKm = min(haversine(coords, v))` across `o.venueGeo`; drop trainer if `minKm > radiusKm` or `venueGeo` empty.
   - Stash `minKm` on the filtered items so cards can display it and sort can use it.
   - Add slider UI inside the existing filter drawer, directly under the venue chips section. Include the unit label and a "Use my location" button when `status !== 'granted'`.

3. **`src/components/TrainerCard.tsx`** (or wherever list rows render — check `_tabs.trainers.tsx` inline renderer first): accept optional `distanceLabel?: string` and render a small chip when provided.

### Non-goals
- No server-side filtering (client-side against already-loaded orgs is sufficient at current scale).
- No map-view radius overlay (list/filter only for this pass).
- No changes to the players/feed distance behavior.
