## Goal
Add a distance filter to the Feed search filters that caps games by miles/km from the user's designated location (profile `city`), using existing `distanceMi` on game records.

## Changes

### `src/lib/user-prefs-store.ts`
- Extend `FeedPrefs` with:
  - `maxDistanceMi: number | null` (null = Any distance; stored canonically in miles)
  - `distanceUnit: "mi" | "km"` (display preference)
- Add to `DEFAULT_PREFS` (`null`, `"mi"`).
- In `useFeedPrefs`, fall back to defaults when fields are missing (backward compat with saved prefs).

### `src/routes/_tabs.feed.tsx`
- Import `kmToMi`, `miToKm` from `@/lib/distance`.
- Apply filter: keep game when `prefs.maxDistanceMi == null || g.distanceMi <= prefs.maxDistanceMi`.
- Include distance filter in `activeFilterCount` when set.
- In `FilterSheet`, add a "Distance from you" section:
  - Unit toggle: `mi` / `km` (updates `distanceUnit`).
  - Preset chip row. In miles: Any, 5, 10, 25, 50, 100. In km: Any, 5, 10, 25, 50, 100 (converted to miles via `miToKm`/`kmToMi` for storage).
  - When `profile.city` is empty, show helper text "Set your city in profile to use distance" linking to `/profile/edit` and disable chips.
- Reset button also clears `maxDistanceMi` to `null` (keeps unit preference).

## Out of scope
- No geocoding; uses the `distanceMi` value already on game records (mock data and hosted games).
- No schema/DB changes.
