## Bug

On paid games with `requires_approval`, once the host approves the join request the ad-hoc "Approval status banner" in `src/routes/games.$gameId.index.tsx` (lines 936–978) renders:

> ✅ You're approved — see you there!
> The host approved your request. You're on the roster.

This is wrong for paid games — being approved to *request* a spot is not the same as the host confirming payment. `PlayerFlowPill` + `PaymentRequiredBanner` already reflect the correct `payment_pending` state right above it, so the stale "approved" copy directly contradicts them and misleads the player into thinking they're locked in.

## Fix

Scope: presentation only, `src/routes/games.$gameId.index.tsx`.

1. In the "Approval status banner" block, skip the `approved` branch when the game is paid AND the viewer's latest submission is not `verified` (i.e. `isPaid && latestSub?.status !== "verified"`). The `PaymentRequiredBanner` + `PlayerFlowPill` above already communicate the true state ("Payment due" / "Awaiting review" / "Payment declined").
2. Keep the `approved` branch for free games (still valid: "You're on the roster").
3. Keep the `pending` and `rejected` branches unchanged for all games.
4. Tighten the approved copy's second line so it never claims roster confirmation on a paid game path — e.g. render nothing on the approved branch for paid games, and leave the free-game copy as-is.

No changes to `game-flow-status.ts`, `PlayerFlowPill`, `PaymentRequiredBanner`, or business logic. No DB or store changes.

## Verification

- Paid + `requires_approval` game, host approves but no payment submitted: only `PaymentRequiredBanner` ("Payment required — Pay $X now") and `PlayerFlowPill` ("Payment due") render. The "You're approved — on the roster" banner is gone.
- Paid game, submission `pending`: pill shows "Awaiting review"; approved banner still suppressed.
- Paid game, submission `verified`: pill shows "Paid"; approved banner may render (or stays suppressed — either is fine since pill already says Paid).
- Free + `requires_approval` game, host approves: existing "You're approved — see you there!" banner still renders.
- `pending` and `rejected` join-request states unchanged in all cases.
