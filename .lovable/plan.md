## Problem

`/games/host-mrfdyr16-9lhs` (a game that no longer exists in the database) is stuck in an infinite loop, flipping between "Loading…" and "Game not found" and firing hundreds of identical `hosted_games?id=eq.…` requests per second.

## Root cause

`useHostedGames()` returns `JSON.parse(snap)` — a **new array reference on every render**. In `src/routes/games.$gameId.index.tsx` the lookup effect declares its deps as `[gameId, hosted]`, so it re-runs every render:

1. Render → `hosted` is a new reference → effect fires
2. Effect calls `setLookupComplete(false)` + `setRemoteGame(null)` → re-render as "Loading…"
3. `fetchHostedGame` resolves (null) → `setLookupComplete(true)` → re-render as "Game not found"
4. New render → new `hosted` reference → back to step 1

## Fix

Narrow the effect's dependency array so the lookup runs only when `gameId` actually changes:

- In `src/routes/games.$gameId.index.tsx`, change the lookup `useEffect` deps from `[gameId, hosted]` to `[gameId]`. Inside the effect we already re-check `hosted.some(...)` / `GAMES.some(...)` up front, so we don't need to re-fire when the hosted list emits. Add an eslint-disable-next-line for exhaustive-deps (matching the pattern used elsewhere in this file).

That single change stops the render loop, stops the request storm, and leaves the "Game not found" screen visible (correct terminal state for a deleted game).

## Out of scope

- Not changing `useHostedGames()` itself (broader refactor; the local fix is sufficient and low-risk).
- No UI/design changes.
- No backend changes; the game genuinely doesn't exist in `hosted_games`.

## Verification

- Reload `/games/host-mrfdyr16-9lhs`: page settles on "Game not found" with a single (or zero) hosted_games fetch, no repeating network requests.
- Navigate to an existing game id: still loads normally.
