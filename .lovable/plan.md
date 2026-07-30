## Goal

Distance units (miles vs kilometers) should default to whatever matches the user's region, detected from their device locale and timezone, instead of always defaulting to miles. Users can still force a unit from the feed filter toggle, and that choice sticks.

## How detection works

A new helper `src/lib/measurement-system.ts`:

- Reads `navigator.language`/`navigator.languages` and `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- Uses the standard imperial set — US (plus territories), Liberia, Myanmar, and UK-as-miles — everything else metric.
- Prefers the modern `Intl.Locale(...).getWeekInfo`/`measurementSystem` API where available, falling back to the country-code list, then to timezone (`America/New_York` → imperial, `Europe/Berlin` → metric), then to `mi` as last resort.
- SSR-safe: returns `"mi"` when `window`/`navigator` are unavailable, and detection runs on the client after hydration so no hydration mismatch occurs.

## Preference model

`src/lib/user-prefs-store.ts`:

- `distanceUnit` becomes `"auto" | "mi" | "km"`, with `"auto"` as the new default.
- Existing saved prefs are untouched: anyone who already has `"mi"` or `"km"` stored keeps that explicit value, so nothing changes under them.
- Add a resolved accessor (`useDistanceUnit()` / `resolveDistanceUnit(prefs)`) returning a concrete `"mi" | "km"` — this is what components render with.

## UI changes

- Feed filter unit toggle (`src/routes/_tabs.feed.tsx`) gains a third option: `Auto` / `mi` / `km`, with `Auto` showing the detected unit as a hint (e.g. "Auto (km)"). Picking `mi` or `km` pins it.
- Onboarding radius step (`src/routes/onboarding.welcome.tsx`) currently hardcodes "km" labels and a 1–100 km scale; it switches to the resolved unit with correct labels and presets (1–60 mi / 1–100 km) and keeps saving kilometers to the database.
- Screens that print a unit — game cards/rows, game detail, trainers, teams, players, available players, map, request cards — read the resolved unit instead of assuming `mi`/`km`.

## Data stays unchanged

No migration. The database keeps storing kilometers in `travel_radius_km` and miles in `distance_mi`; conversion stays in `src/lib/distance.ts`, which gains a `formatDistance(valueMi, unit)` helper so every screen renders the same rounding and suffix.

## Technical notes

- Detection result is memoized per session; the store exposes it via `useSyncExternalStore` so a locale change on remount is picked up.
- Tests: extend `src/lib/distance.test.ts` and add `measurement-system.test.ts` covering US/GB/DE/MM locales, timezone-only fallback, missing-navigator fallback, and that an explicit stored `mi`/`km` always wins over detection.
