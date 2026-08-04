# Remove the "Request to join" button from player cards

The quick "Request to join" action on player availability cards goes away. Nothing about the game page request flow or host approve/decline changes.

## What changes

1. **Players tab card** (`src/routes/_tabs.players.tsx`) — remove the block that renders the button under each availability card (the `{!isMine && ...}` wrapper around it) and drop the now-unused import. "View full profile", Message, Contact/Send invite stay.

2. **Availability detail dialog** (`src/components/players/AvailabilityDetailDialog.tsx`) — remove the full-width button at the top of the non-owner footer and its import. The Message / Contact pair below it stays.

3. **Delete the component** (`src/components/players/RequestToJoinButton.tsx`) — after both usages are gone the file has no remaining callers, including its `useUpcomingGamesByHost` helper.

## Technical notes

- Presentation-only: no store, payment, or migration changes.
- Verify with a typecheck that no leftover references to `RequestToJoinButton` or `useUpcomingGamesByHost` remain.
