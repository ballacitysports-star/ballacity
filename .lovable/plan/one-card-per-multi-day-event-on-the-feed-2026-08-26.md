# One card per multi-day event on the feed

## Problem
Publishing a game in "Multiple days" mode inserts one `hosted_games` row per selected day (`src/routes/_tabs.create.tsx`, the `for (const plan of plans)` loop). Each row renders as a separate card, so one event floods the feed with duplicate-looking cards.

## Approach
Keep the per-day rows (joins, availability, and per-day times all depend on them), but link them as one **event series** and render a single grouped card.

## Changes

1. **Migration: link sessions with `series_id`**
   - Add nullable `series_id uuid` column to `public.hosted_games` with an index. No new table, no new policies — inherits existing RLS.

2. **Stamp a shared series id on publish** (`src/lib/hosted-games-store.ts`, `src/routes/_tabs.create.tsx`)
   - `CreateGameInput` gets optional `seriesId`.
   - `createHostedGame` maps it to the insert row.
   - When publishing multiple plans, generate one `crypto.randomUUID()` and pass it to every insert. Single-day events stay `null`.

3. **Group in the feed** (`src/routes/_tabs.feed.tsx`)
   - After fetching hosted games, collapse rows sharing a `series_id` into one feed item (representative = earliest upcoming session, else most recent).
   - Card shows a "Multi-day · N sessions" badge; tapping it opens the earliest session's game page, which lists the other sessions (dates/times) with links — read from the same series id.

4. **Game detail page** (`src/routes/games.$gameId.index.tsx`)
   - If the game has a `series_id`, query sibling sessions and render a "More dates" strip so users can see/switch between days.

5. **Archive/finished logic**
   - Grouping uses upcoming sessions first, so a series drops out of the Upcoming tab only when all sessions finish; finished sibling sessions still appear in Archive individually or grouped (grouped there too, representative = latest finished session).

6. **Tests**
   - Unit test the grouping helper (`src/lib/game-schedule.ts` or a new `src/lib/game-series.ts`): one card per series, correct representative ordering, mixed upcoming/finished behavior.
   - Existing create/schedule tests keep passing.

## Not changing
- Single-day event behavior (no series id, unchanged rendering).
- Per-session join/request flows and notifications.
