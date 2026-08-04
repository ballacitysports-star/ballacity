# Make the Players screen remember my setup

Goal: whatever the Players screen looks like right now — list/map view, grid/list density, and every filter (search text, sports, per-sport skill tiers, distance, age range, include-unknown-age, when) — becomes the state you get back every time you open Players, in this session and in future ones.

## What changes for you

- Open Players from the tab bar (or fresh, with no link parameters) and the last state you used is restored automatically.
- Turning a setting back to its default is remembered too. Today, switching density back to "list" or clearing a sport is forgotten, so the older saved value comes back on the next visit.
- No visible flip from the default layout to your saved layout on load: the screen restores before the list renders.
- Sharing or opening a filtered link still wins over your saved state, so shared URLs keep working.
- Same behaviour applies on Teams and Trainers, which use the same saving logic.

## Technical notes

`src/hooks/use-persisted-search.ts` is the single place that saves route search params to local storage. Three fixes:

1. Store the full snapshot of every schema key instead of stripping values equal to defaults, so an explicit "back to default" choice persists. Keep a small version marker in the stored payload so old entries are read once and upgraded.
2. Base the "did the user arrive with an explicit filter link?" check on the raw query string keys present in `window.location.search`, not on comparing values to `defaults`. Any explicit param means no restore; an empty or fully canonicalised URL means restore.
3. Do the restore synchronously during the first client render (before paint) rather than in a post-render effect, and gate the results list on a `hydrated` flag so no data fetch runs against the pre-restore state.

In `src/routes/_tabs.players.tsx`:

- Pass the complete default set to `usePersistedSearch` (adding `skill`, `ageMin`, `ageMax`) so nothing is silently excluded.
- Keep the existing one-time migration from the legacy `openrun.playersFilters.v1` / `openrun:players-view` / `openrun:players-density` keys, and run it before the new restore so it can't be overwritten.
- Keep the existing skill sanitisation effect so a restored tier that no longer matches the selected sports is still scrubbed.

`_tabs.teams.tsx` and `_tabs.trainers.tsx` need only their defaults objects checked for completeness; they inherit the hook fixes.
