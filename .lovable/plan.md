## Goal

Make join, approval, and payment actions feel instant. Flip local state the moment the user taps, then let existing realtime handlers reconcile with server truth (and roll back on error).

All changes are in `src/routes/games.$gameId.index.tsx` plus tiny helpers in `src/lib/game-roster.ts`. No backend, RLS, or query-shape changes.

## Pattern

For each action:
1. Snapshot current local state.
2. Apply optimistic mutation to state (and show toast).
3. Await server call.
4. On success: leave state as-is — realtime `postgres_changes` handler (already wired) will overwrite with authoritative row shortly. Drop the trailing `refreshStatus()`/`refreshHostRequests()` so we don't clobber the optimistic value before realtime arrives.
5. On failure: restore snapshot, show error toast.

Add a small helper `applyOptimistic<T>(setter, next, serverCall)` co-located in the route file to keep call sites tidy.

## Player-side actions

Handler around lines 570–700 (`handlePrimary`):

- **Send join request** (line 669–688): already sets `setMyReq(created)` after the call. Move the optimistic set to *before* `createJoinRequest` using a synthetic pending row `{ id: 'optimistic', status: 'pending', game_id, player_id: user.id, host_id, created_at: now, … }`. Replace with returned row on success. Roll back to previous `myReq` on error. Remove the trailing `await refreshStatus()`.
- **Cancel pending request** (line 628–637): snapshot `myReq` + `mySubs`, set `myReq` to null and filter pending sub out of `mySubs` immediately, then call `deleteMyPendingSubmission` / `cancelMyJoinRequest`. Roll back on error. Drop `refreshStatus()`.
- **Leave / withdraw approved** (line 597–626): snapshot `myReq`, `mySubs`, and `joined`. Optimistically set `myReq` to null (for approved case), remove pending sub, and call `leaveGame` (already local). Await server deletes; roll back on error. Drop `refreshStatus()`.

Payment submission on the pay page is out of scope for this task per prior turns; only status reflection here matters. On this page, when `payment_submissions` realtime event arrives we already refetch — nothing else needed.

## Host-side actions

`HostRequestRow.act` (~line 2808) and `HostPendingChip.act` (~line 2925):

- Snapshot `hostRequests` from parent via a new prop `applyOptimisticStatus(reqId, status)` OR lift to a shared callback. Simplest: add optional prop `onOptimistic?: (reqId, status) => void` and `onRollback?: () => void`. Parent passes handlers that mutate `hostRequests` state.
- On approve/reject tap: call `onOptimistic(req.id, status)` → parent updates that row's `status` in place immediately (approved chip disappears from Pending list, moves to reviewed section).
- Await `reviewJoinRequest`. On error → `onRollback()` restores prior array.
- Keep the notification call. Remove the `onChange()` (which triggers `refreshHostRequests`) — realtime `join_requests:host:*` handler already updates the list.

## Roster optimistic add on approve (viewer = approved player)

When realtime approval flips the CTA to "Pay", the roster count is authoritative via `useLiveParticipants` and doesn't need an optimistic bump on the player side (they aren't in `game_participants` yet — that happens after payment/join).

For the "Leave" case, add an optimistic remove: extend `useLiveParticipants` (in `src/lib/game-roster.ts`) with a `removeLocal(userId)` helper alongside `refetch`. Call it from the leave handler; the realtime DELETE event then reconciles (idempotent — filter is a no-op if already gone).

## Rollback safety

- Guard every rollback with a `didError` flag so late realtime events don't get overwritten.
- Optimistic rows use a sentinel `id: 'optimistic:<uuid>'`; realtime INSERT handler already keys by real id so both can coexist briefly, then optimistic is replaced when the real row arrives (in the `setMyReq` case we replace directly on server-call resolution, so no dedupe needed).

## Files touched

- `src/routes/games.$gameId.index.tsx` — refactor `handlePrimary` branches, wire `onOptimistic`/`onRollback` into `HostRequestRow` and `HostPendingChip`, remove the now-redundant post-action `refreshStatus`/`refreshHostRequests` calls.
- `src/lib/game-roster.ts` — export `removeLocal(userId)` from `useLiveParticipants`.

## Verification

- Tap "Request to join" with network throttled to Slow 3G → CTA flips to "Request pending" within one frame; server response arrives later and row id is swapped in silently.
- Host taps Approve → row leaves Pending list instantly; realtime event arrives ~1s later and doesn't cause a flicker.
- Force an error (offline) → optimistic state rolls back and error toast shows.
- Existing e2e specs (`pay-approval-realtime-only`, `invite-request-*`, `pay-approval-gate-flips`) still pass; behavior change is timing-only.

## Non-goals

- No changes to `src/routes/games.$gameId.pay.tsx`.
- No new realtime channels, migrations, or RPCs.
- No changes to notification delivery.
