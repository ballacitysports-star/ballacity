## Problem

On a paid game that requires host approval, tapping the CTA ("Request to join") sends the join request server-side but the button doesn't visibly flip to "Request pending · Tap to cancel" until a manual reload. The button state falls out of sync because:

- `handleJoin` fires `refreshStatus()` without awaiting it, and interleaves a `createNotification()` call in between that can delay/interfere with the local state update.
- There is no optimistic update — `myReq` stays `null` until the next round-trip returns.
- The button is not disabled while the request is inflight, so users tap again and see a "duplicate/idempotency" toast that further masks the pending state.

## Fix

Edit `src/routes/games.$gameId.tsx` only.

1. **Optimistic pending state.** In the approval-gate branch of `handleJoin` (around lines 336–362), immediately after `createJoinRequest(...)` resolves, call `setMyReq(created)` with the returned row so `isRequestPending` becomes true on the next render.
2. **Await the refresh.** Change the trailing `refreshStatus()` to `await refreshStatus()` so any server-side normalization (status, timestamps) lands before the handler returns.
3. **Move `createNotification` off the critical path.** Fire it as `void createNotification(...).catch(() => {})` after the optimistic state update so a push/notification failure can never leave the CTA stuck.
4. **Guard against double-taps.** Add a local `const [requesting, setRequesting] = useState(false)` and set it around the approval-gate branch. Include `requesting` in the CTA `disabled` prop so the button greys out during the in-flight request.
5. **Same treatment for the confirmed-and-approved pay branch (lines 282–288)** for consistency: disable the button while navigating so the user gets a clear visual acknowledgement.

## Verification

- Sign in as a non-host on a paid + requires-approval game.
- Tap "Request to join": CTA should immediately show "Request pending · Tap to cancel" without a reload.
- Tap it again: it should cancel the request and revert to "Request to join".
- Confirm no regression on: free game join, paid-no-approval pay flow, host approving (CTA flips to "Pay host · $X").

No DB, RLS, or server-function changes required.
