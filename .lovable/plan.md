## Problem

After a viewer taps "Leave" on a game they've already paid for, the "Your status · Payment verified — you're on the roster" strip briefly disappears and then reappears without a refresh.

Root cause: the leave handler does the right thing optimistically (`setMySubs([])`, then deletes each submission + the join request in a `Promise.all`), but the realtime channels wired up in `useGameRealtimeChannels` fire during the delete sequence:

- `join_requests` DELETE → `onMyJoinRequestChange` → `refreshStatus()`
- `payment_submissions` DELETE → `onMyPaymentChange` → `refreshStatus()`

`refreshStatus()` re-reads `listMySubmissionsForGame` from the DB. If a `join_requests` DELETE lands before every `payment_submissions` DELETE has committed, the refetch returns the still-verified submission, overwrites the optimistic `setMySubs([])`, and the "Payment verified — you're on the roster" strip re-renders.

## Fix

Serialize refetches out of the leave flow so nothing rehydrates `mySubs` / `myReq` until every server-side clear has committed.

1. In `src/routes/games.$gameId.index.tsx`, add a `leavingRef = useRef(false)` and guard `refreshStatus()` (early-return while `leavingRef.current` is true). Do the same for the realtime handler paths that call `refreshStatus` (`onMyJoinRequestChange`, `onMyPaymentChange`).
2. In the leave branch of `executeJoinAction`:
   - Set `leavingRef.current = true` before any delete.
   - Await the payment-submission deletes FIRST, then the join-request cancel/withdraw, then the `leaveGame` DB write (turn the current fire-and-forget `leaveGame` into an awaited variant — either `await`-friendly helper or inline the delete).
   - In a `finally`, clear `leavingRef.current = false` and call `refreshStatus()` + `refetchRoster()` once to reconcile.
3. On error rollback, still restore `myReq` / `mySubs` and re-run `refreshStatus()` after clearing the guard.

No schema changes — the RLS delete policy added earlier is already in place and working.

## Verification

- Manual: on a game requiring approval + payment, join → pay → get verified → Leave. The status strip should disappear and stay gone, and the sticky CTA should immediately flip back to "Request to join" / "Pay to join".
- Existing e2e (`join-realtime-cross-views.spec.ts`, `pay-*` specs) should still pass.
