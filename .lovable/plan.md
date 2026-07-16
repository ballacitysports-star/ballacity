## Bug: /feed and any list rendering sample games crashes the render tree

After the "unify status" work, `GameCard` calls `useMyFlowStatus(game.id)` for every card in the feed. That hook runs a Supabase query and opens a realtime channel per game id. On `/feed`, most cards render **sample games** whose IDs (`"game-1"`, `"game-2"`, …) are plain strings, not UUIDs. Two things happen inside `useMyFlowStatus` for each sample card:

1. `fetchFlowInputs()` calls `supabase.from("game_participants").eq("game_id", "game-1").maybeSingle()`. Postgres rejects with *invalid input syntax for type uuid*. That branch has **no `.catch()`** (unlike the other three parallel fetches), so `Promise.all` rejects and the whole `reload()` throws — surfaced as an unhandled rejection in the effect.
2. `supabase.channel("flow-status:game-1:<uid>").on("postgres_changes", …)` is opened for every card. Ten+ sample cards × three `.on()` subscriptions each pushes the client past its realtime channel budget and the internal `on()` throws (`on@supabase-js.js:8189`, propagated to `game-flow-status.ts:139` in the source map).

The thrown error escapes the effect and bubbles into the root `ErrorComponent`, producing the "This page didn't load" screen the user sees right after login (post-login redirect lands on `/feed` / `/profile` list surfaces).

Users signed out don't hit the bug because `GameCard` already skips the hook with `useMyFlowStatus(user ? game.id : undefined)`.

## Fix (presentation-safe, no schema changes)

### A. Add a UUID guard to `useMyFlowStatus`

`src/lib/game-flow-status.ts`:

- Treat any `gameId` that isn't a valid UUID as "no live status" — set `status = "none"`, don't fetch, don't open a realtime channel. Add a small `isUuid(id)` regex helper.
- In the `useEffect` that owns the fetch + subscription: bail early when `!isUuid(gameId)` the same way it already bails when `!userId`.
- Harden `fetchFlowInputs`: wrap the `game_participants` `.maybeSingle()` in its own `try/catch` (like the other three) so a single failed sub-query can never reject the whole `Promise.all` again, regardless of ID shape.

### B. Gate `useMyFlowStatus` at the `GameCard` call site

`src/components/GameCard.tsx`:

- Only pass `game.id` when both `user` is signed in **and** `isUuid(game.id)`; otherwise pass `undefined`. This stops the hook from doing any work (fetch or channel open) for sample games, keeps the "Joined" static badge path intact for those cards, and avoids the per-card realtime cost on feed pages that render dozens of cards.
- Export the `isUuid` helper from `game-flow-status.ts` and import it here — one source of truth.

### C. Same guard in the pay page's `PayApprovalIndicator` and the game-detail banners

`src/routes/games.$gameId.pay.tsx` and `src/routes/games.$gameId.index.tsx` currently call `useMyFlowStatus(gameId)` unconditionally. Sample-game deep links (`/games/game-1`) hit the same UUID error. The hook's internal guard from step A already returns `status: "none"`, but the outer JSX should also treat `status === "none"` on a sample game as "no live status" and fall back to the existing static banners/pills so nothing tries to render an empty pill.

### D. No changes to

`PlayerFlowPill`, `PaymentRequiredBanner`, `PaymentStatusTimeline`, business logic, RLS, or realtime schema.

## Verification

- `/feed` (signed in): loads normally. Real hosted games still show live pills; sample cards keep the static "Joined" badge (or nothing).
- `/games/game-1` (sample game): renders game detail, no runtime error, no "This page didn't load".
- `/games/<real uuid>`: pill + banners still update in realtime as before.
- After login, redirected to `/profile` and `/feed` — both load without the error screen.
- No new console errors mentioning `game-flow-status.ts` or `supabase-js.js on@`.
