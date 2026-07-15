## Bug: "Tap to leave" doesn't update the roster

### What's happening

On the game detail page, when a **confirmed** player (paid-verified or approved on an approval-gated game) taps the "You're in · Tap to leave" (or "Confirmed · Tap to leave") button:

- Local join set clears optimistically, so the button label may briefly flip, but…
- `leaveGame(id)` in `src/lib/games-store.ts` early-returns and **never issues the DELETE** on `game_participants` when the id isn't in the local `joined` Set. Confirmed players got onto the roster server-side (via payment verification / approval auto-join), not through `joinGame`, so their id was never in that Set.
- `cancelMyJoinRequest` only deletes `join_requests` rows whose status is `pending`, so an **approved** request stays approved.
- `deleteMyPendingSubmission` only helps for pending submissions, so a **verified** payment row stays.

Net effect: the `game_participants` row survives → the live roster list and "Roster (X/Y)" counter don't change, and after the next `refreshStatus` the button flips right back to "Confirmed · Tap to leave" (because approval/payment still read as cleared).

### Fix (presentation + thin data layer only, no schema changes)

1. **`src/lib/games-store.ts` — `leaveGame`**
   - Always attempt the `game_participants` DELETE for the current user, regardless of whether the id is in the local `joined` Set. Keep the optimistic local-set clear as-is.
   - On DB error, restore the local set (existing rollback pattern in `joinGame`).

2. **`src/lib/payments.ts` — join-request cancel**
   - Add `withdrawMyApprovedJoinRequest(gameId)` (or extend `cancelMyJoinRequest` to also match `status = 'approved'`) that deletes the caller's own approved row. RLS already scopes deletes to `player_id = auth.uid()`, so this is safe.

3. **`src/routes/games.$gameId.index.tsx` — leave branch of `handleJoin` (~L443–468)**
   - After `leaveGame`, also cancel/withdraw an **approved** join request (not just pending) so the approval gate resets.
   - Keep the existing "delete pending submission" call; do not touch verified submission rows (payment history stays intact — only the roster seat is released).
   - Continue to call `refreshStatus()` at the end; the live roster subscription already picks up the DELETE from `game_participants`.

4. **No UI copy or E2E-testid changes.** `e2e/join-cross-device-roster.spec.ts`'s "reverse: leave from B" step already exercises the free-game path and should continue to pass; the confirmed-leave path gets fixed as a side effect.

### Out of scope

- No changes to payment records, refunds, notifications wording, RLS, or the pay screen.
- No changes to `joinGame`, waitlist, or host-side flows.