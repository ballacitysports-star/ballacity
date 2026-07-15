## Problem

When the host rejects a player's payment from the roster panel, `reviewPaymentAction` only updates `payment_submissions.status` to `rejected`. The player's `game_participants` row (and approved `join_requests` row) are left intact, so the player still appears on the confirmed roster and still counts toward the `joined` total.

## Fix

Extend the reject path so a rejection also removes the player from the game.

### Server (`src/lib/payments.functions.ts`)

In `reviewPaymentAction`, when `next === "rejected"` and the update succeeds (`changed: true`):

1. Delete the player's row from `game_participants` for this `game_id` (trigger `sync_hosted_game_joined_count` will recompute `hosted_games.joined`).
2. If an `approved` `join_requests` row exists for `(game_id, player_id)`, flip it back to `rejected` with `reviewer_notes = "Payment rejected"` so the player has to re-request + re-pay (matches existing "resubmit after rejection" flow already handled by `enforce_join_request_resubmit_rules`).
3. Do nothing extra when the transition is a no-op (`changed: false`) so repeated clicks stay idempotent.

Return the same `ReviewPaymentResult` shape — no client type changes needed.

### Client (`src/routes/games.$gameId.index.tsx`)

After a successful reject in `setPaymentStatusAction`:

- Call the existing `refetchRoster()` / roster invalidation already used elsewhere so the removed player disappears immediately (the realtime subscription on `game_participants` should also fire, but an explicit refetch avoids a visible lag).
- Keep the existing "Payment rejected" notification to the player.

No UI/copy changes; the reject button and history panel behave the same, the player just also drops off the roster.

### Out of scope

- No schema migration (uses existing tables/triggers).
- No changes to the verify / mark-paid / mark-unpaid paths.
- No changes to the player-initiated leave flow.
