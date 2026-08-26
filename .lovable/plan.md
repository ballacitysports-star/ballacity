# Make your profile sports the real default everywhere

## What happens today

Your profile's favorite sports already seed the sport filter on Home, Players, Teams and Trainers — but only **once per browser, ever**. A marker is written to local storage the first time each screen loads, so:

- if a screen loaded before your profile finished loading (or before you picked favorite sports), it was marked "seeded" and never defaults again
- if you later change your favorite sports, no screen picks the change up
- clearing the filter to "All sports" and coming back later gives you "All sports", not your sports

Create Game and new availability posts do preselect from the profile, but only within a single mount and only the *first* sport for Create Game.

## The change

Treat profile sports as the standing default instead of a one-time seed:

- A screen uses your profile sports whenever you haven't made your own sport choice on that screen. It stops guessing only once you actually change the sport filter yourself — and that choice (including "All sports") then sticks for good.
- If you edit your favorite sports in your profile, screens you haven't personally overridden follow the new list.
- Applies to: Home feed, Players, Teams, Trainers (search/filters).

For creating and hosting:

- Create Game preselects your first profile sport, and re-applies if the profile loads late, until you pick a sport in the form.
- New player availability posts start with all of your profile sports selected (editing an existing post keeps its own sports).

Nothing changes about what's saved — only what's preselected. Every screen keeps the full sport list available, and switching sports always works.

## Technical notes

- `src/lib/default-sports.ts`: replace the "seeded once" local-storage marker with a per-key "user overrode this screen" marker. New hook shape: `useProfileSportDefault(key, { ready, current, apply })` that applies profile sports whenever no override is recorded and the current selection differs from the profile list, plus a `markSportChoice(key)` helper the screens call from their sport-filter handlers. Keep `useDefaultSports` as-is.
- `src/routes/_tabs.feed.tsx`, `_tabs.players.tsx`, `_tabs.teams.tsx`, `_tabs.trainers.tsx`: swap `useSeedSportsOnce` for the new hook and call `markSportChoice` inside the existing sport toggle/set handlers (not on unrelated filter writes).
- `src/routes/_tabs.create.tsx`: keep `sportTouchedRef`, drop the one-shot `sportSeededRef` so a late profile load still applies.
- Availability dialog in `_tabs.players.tsx`: keep the edit-vs-new split, drop the one-shot ref so late profile loads seed new posts.
- Old `openrun:sport-seeded.*` keys are ignored; no migration needed.
