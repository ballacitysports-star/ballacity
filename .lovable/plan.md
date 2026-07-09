## Why hosted games disappear

Hosted games live only in browser `localStorage` (`openrun.hostedGames.v1`). Nothing in the app removes them, but the preview iframe / partitioned storage can wipe that key silently. When it does, every screen that reads `useHostedGames()` (Feed, Discover, Profile, Players → Invite) goes empty — which matches what you're seeing.

Fix: give hosted games a real home in the database. Keep localStorage only as an offline cache that heals itself from the DB on load.

## What I'll build

1. **New `hosted_games` table** (backend)
   - Columns mirror the local `Game` shape needed for display: `id text pk`, `host_id uuid`, `sport`, `title`, `date timestamptz`, `duration`, `location`, `neighborhood`, `lat`, `lng`, `max_players`, `skill`, `price`, `indoor`, `is_private`, `description`, `equipment text[]`, `image text`, `status`, `joins_closed`, `host_snapshot jsonb`, `created_at`, `updated_at`.
   - RLS: hosts read/write their own rows; everyone signed in can `SELECT` (games are shown publicly in feed today). GRANTs on `authenticated` + `service_role`, `SELECT` on `anon` so signed-out home/feed still shows them.
   - `updated_at` trigger using the existing `touch_updated_at()` function.

2. **Rewrite `src/lib/hosted-games-store.ts`**
   - On first use (and on auth change), fetch the signed-in user's + all public hosted games from `hosted_games` and hydrate the in-memory cache + localStorage mirror.
   - `addHostedGame` / `updateHostedGame` / `claimHostedGame` write to Supabase, then update local cache. Local write happens first for optimistic UI; DB error → toast + rollback.
   - Realtime subscription on `hosted_games` so other tabs / devices stay in sync.
   - `localStorage` becomes a warm cache only — if it gets wiped, the next fetch repopulates it. Games never vanish again.

3. **Migrate existing localStorage games** on first load per user (one-shot flag), pushing anything with no `hostUserId` into the DB stamped with the current user's id (piggybacks on existing `runLegacyHostMigration` pattern).

4. **No UI changes.** The `useHostedGames()` hook keeps the same signature, so `_tabs.feed.tsx`, `_tabs.discover.tsx`, `_tabs.profile.tsx`, `_tabs.players.tsx`, `games.$gameId.tsx`, and `_tabs.create.tsx` don't need edits beyond `addHostedGame` becoming async where it's awaited (only the create form).

## Out of scope

- No changes to sample `GAMES`, join flow, payment flow, or roster panel.
- No changes to auth or route structure.
