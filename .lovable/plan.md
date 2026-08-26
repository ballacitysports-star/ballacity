# Default sports follow your profile

Your favorite sports (set in your profile) become the starting point for sport pickers and filters across the app, while any choice you make afterwards is respected.

## Behavior

- Browse screens (Home feed, Players, Teams, Trainers): the first time you open each screen with no sport choice of your own, it starts filtered to your profile sports. Once you tap chips or pick "All sports", that choice wins from then on — including "All sports".
- Creation forms: Create Game preselects your first profile sport instead of Basketball; a new availability post preselects your profile sports (editing an existing post keeps its own sports).
- If your profile has no sports set, everything behaves exactly as today (All sports / current defaults).

## What changes technically

- New shared helper `src/lib/default-sports.ts` with a `useDefaultSports()` hook wrapping `useMyProfileState`, returning the profile's sport names (empty when unset) plus a `loaded` flag so nothing seeds before the profile row arrives.
- `src/lib/user-prefs-store.ts`: add a one-time `sportsSeeded` flag to `FeedPrefs` (normalized/defaulted like the rest) so seeding happens once and clearing to "All sports" is not re-seeded.
- Feed (`src/routes/_tabs.feed.tsx`): when `sportsSeeded` is false, no `sport` search param is present, and profile sports exist, set `preferredSports` from the profile and mark seeded. Existing URL-param and saved-view behavior untouched.
- Players / Teams / Trainers (`_tabs.players.tsx`, `_tabs.teams.tsx`, `_tabs.trainers.tsx`): these already persist filters in search params / saved search. Seed the sport filter from the profile only when there is no stored/URL sport value and no prior seed marker for that screen (stored alongside the existing persisted-search state), so an explicit "All sports" sticks.
- Create Game (`src/routes/_tabs.create.tsx`): replace the hardcoded `useState<Sport>("Basketball")` initial with the first profile sport once loaded (only while the user hasn't touched the picker).
- Availability post form (in `src/routes/_tabs.players.tsx`, the `initial?.sports ?? []` state): default to profile sports for new posts.
- No database or schema changes.
