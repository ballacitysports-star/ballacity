Remove the "Needs players" notice when a game's roster is already full.

## What will change

- **Game card badge** (`src/components/GameCard.tsx`): the red "Needs players" pill at the top-left of a card will only render when `game.urgent` is true AND there are still spots left (`spotsLeft > 0`). A full game will no longer show the urgent notice.
- **Feed "Needs players now" section** (`src/routes/_tabs.feed.tsx`): the dedicated urgent section will filter out games whose roster is full, so full games do not appear under "Needs players now" even if `game.urgent` is true in the database.

## Technical details

- In `GameCard.tsx`, use the existing `spotsLeft` variable (already computed as `game.maxPlayers - joinedCount`, clamped by `Math.min`). The current badge condition is `{game.urgent && (...)}`; it will become `{game.urgent && spotsLeft > 0 && (...)}`.
- In `_tabs.feed.tsx`, the `urgent` list currently is `filtered.filter((g) => g.urgent)`. We will change this to exclude games whose effective joined count has reached `maxPlayers`. The component already imports hooks for live participant counts (e.g., `useLiveParticipantCount`), but the simplest fix is to compute a local helper `isFull(game)` based on the live count or the snapshot, consistent with `GameCard.tsx`. The feed already renders each game through `renderGame`, so we will use the same `spotsLeft > 0` rule for inclusion in the urgent section.
- No database or API changes are needed; this is purely a presentation/visibility fix based on the existing `urgent` flag and roster data.
- Verify the change by checking that a full game with `urgent: true` no longer shows the red badge or appears in the urgent feed section, while a non-full urgent game still shows both.
