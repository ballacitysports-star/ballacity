# Location preference in profile + 12,500 mi cap

## What's wrong today

Onboarding asks for a city and a search radius, but the radius is only kept in the
device's local settings and the feed filter — Edit profile shows just the city, and a
player's profile page shows no location preference at all. Every radius control also caps
out low (60/100 on the onboarding slider, 500 on availability posts, 100 on filter chips).

## What to build

1. **Store the radius with the profile.** Add a saved search-radius field to the profile
   record so it travels with the account and can be shown on a public profile.
2. **Edit profile — "Location preference" section.** Under the basics, a city field
   (Google autocomplete, same as elsewhere) plus a search-radius control showing the value
   in the viewer's unit (mi/km). Prefilled from what was chosen during onboarding; saves
   through the existing autosave, with the same Saving/Saved badge.
3. **Public profile.** On a player's profile, show a read-only line under their name:
   `City · up to 25 mi` (hidden when neither is set).
4. **Onboarding stays in sync.** The onboarding radius step writes the same profile field,
   so what you pick there is what Edit profile shows, and editing it in the profile updates
   the feed's distance filter too.
5. **12,500 mile cap everywhere.** Every radius/distance control shares one maximum of
   12,500 mi (~20,117 km):
   - onboarding search-radius slider
   - Edit profile radius
   - availability post radius (Players tab sheet and Available players sheet)
   - feed / players / available-players distance filters — preset chips gain a top
     "12,500 mi (anywhere)" option, and typed or stored values are clamped to the cap.
   Values above the cap already saved are clamped on read, so nothing breaks.

## Technical notes

- Migration: `ALTER TABLE public.profiles ADD COLUMN search_radius_mi integer` (nullable,
  clamped 1–12500 by a check constraint). No new grants needed beyond the existing
  column-level SELECT grants — the new column is added to those for `anon`/`authenticated`
  so public profiles can read it. `birthday` stays excluded.
- `src/lib/profile-payload.ts`: include `search_radius_mi` in `buildProfileRow` and in the
  non-birthday upsert path.
- `src/lib/distance.ts`: export `MAX_DISTANCE_MI = 12500`, a `clampDistanceMi()` helper, and
  extend `distancePresets` with the cap step; `src/lib/user-prefs-store.ts` clamps
  `maxDistanceMi` in `normalizeFeedPrefs`.
- `src/lib/user-prefs-store.ts` profile select list adds the new column so
  `useMyProfileState` prefills it.
- New shared `src/components/profile/ProfileLocationFields.tsx` used by both
  `src/routes/profile.edit.tsx` and `src/routes/onboarding.welcome.tsx`.
- Read-only display added to `src/routes/players.$userId.tsx` header.
- Radius `<Input max={500}>` in `_tabs.players.tsx` and `available-players.tsx` switches to
  the shared cap converted to the active unit.
