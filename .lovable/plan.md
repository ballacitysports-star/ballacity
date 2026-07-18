## Problem

The Map view uses the same `PlayMapView` component on Feed, Players, and Teams. It always plots sample `GAMES` + hosted games and shows a game card at the bottom — so switching to Map on `/players` or `/teams` shows games, not the people/teams the page is about.

## Goal

Map view on each tab should plot and preview the entities from that tab, using the same filters that the list view already applies.

- Feed → games (unchanged)
- Players → available players (from `filtered` in `_tabs.players.tsx`)
- Teams → teams / coaches (from `list` in `_tabs.teams.tsx`)

## Approach

1. Generalize `PlayMapView` into a small, generic map surface that accepts:
   - `pins: MapPinItem[]`
   - `activeId` / `onSelect`
   - a `renderCard(activeItem)` render prop for the bottom card
   - the "in view / nearby" label noun ("games" | "players" | "teams")
   - `defaultLocation` (kept)
   Keep the existing games behavior by extracting the current bottom card into a `GameActiveCard` and passing it from Feed.

2. Add `PlayersMapView` and `TeamsMapView` thin wrappers (or inline usages) that:
   - Build pins from the already-filtered list on each page.
   - Since players/orgs have no `lat`/`lng` (only `city`), derive stable pseudo-coords from `id` (same trick as `pseudoDistance` in Teams) so pins stay put across renders. Later this can be swapped for real geocoded coords without touching the map component.
   - Provide bottom-card renderers linking to the player profile (`/players/$userId`) or team page (`/teams/$teamId`).

3. Wire each tab's `viewMode === "map"` branch to its own map view instead of `PlayMapView`:
   - `_tabs.feed.tsx` → `<GamesMapView games={visible} />` (same behavior as today)
   - `_tabs.players.tsx` → `<PlayersMapView players={filtered ?? []} />`
   - `_tabs.teams.tsx` → `<TeamsMapView orgs={list.map(x=>x.o)} kind={kind} />`

4. Empty-state copy per tab ("No players in this area", "No teams in this area").

## Out of scope

- Real geocoding for players/teams (pseudo-coords for now; deterministic and stable).
- Changing filters, sort, or list UI.
- Any backend changes.

## Files touched

- `src/components/PlayMapView.tsx` — refactor into generic map + extract `GameActiveCard`; export a `GamesMapView` wrapper preserving current Feed behavior.
- `src/components/PlayersMapView.tsx` — new; pins + player bottom card.
- `src/components/TeamsMapView.tsx` — new; pins + team/coach bottom card.
- `src/routes/_tabs.feed.tsx` — swap `PlayMapView` → `GamesMapView` (pass current visible games).
- `src/routes/_tabs.players.tsx` — swap `PlayMapView` → `PlayersMapView`.
- `src/routes/_tabs.teams.tsx` — swap `PlayMapView` → `TeamsMapView`.
