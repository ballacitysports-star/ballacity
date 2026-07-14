## Goal
For paid games, a player should only appear on the roster (`game_participants`) after the host **verifies** their payment. Today, the client calls `joinGame()` on payment submission (pending), which inserts into `game_participants` immediately.

## Changes

### 1. `src/routes/games.$gameId.pay.tsx`
- Remove the `joinGame(game.id)` call inside `PaymentInstructionsAndProof`'s `onSubmitted` handler. Submission stays "pending" and the player is NOT added to the roster yet. Toast copy stays as "waiting for host verification".

### 2. `src/routes/games.$gameId.index.tsx`
- Keep the existing auto-join effect that runs after `refreshStatus()`:
  `if (req?.status === "approved" && !joined && (!feeOwed || paidOk)) joinGame(game.id);`
  This already gates on `paidOk = subs[0]?.status === "verified"`, so it will now be the sole path that adds paid players to the roster.
- Ensure `refreshStatus()` is triggered when a submission flips to verified. Add a realtime subscription (or reuse existing polling) on `payment_submissions` filtered by `game_id=eq.<id>` and `player_id=eq.<me>` for `UPDATE` events → call `refreshStatus()`. This makes the roster update the moment the host clicks verify.

### 3. Host verification path (`src/routes/payments.tsx` or wherever `reviewSubmission` is called)
- After the host marks a submission `verified`, the affected player's client will pick it up via the realtime subscription above and auto-join. No server-side insert needed (RLS on `game_participants` requires `auth.uid() = user_id`, so the player's own client must perform the insert).
- Optionally: send a notification to the player ("Payment verified — you're in!") so they open the game and trigger the effect even without realtime.

### 4. Free games / unpaid path
- Unchanged. `joinGame` still runs immediately from the Join button for free games and from the approval-only path when no fee is owed.

## Out of scope
- No schema/RLS changes. No changes to `joinGame` itself. No changes to the host review UI beyond the optional notification.

## Verification
- Paid game, submit proof → roster count unchanged, "pending verification" state shown.
- Host verifies → player's open game page auto-joins them (realtime); reopening the page also joins them (refreshStatus on mount).
- Host rejects → player stays off roster.
- Free game join → still immediate.
