## Symptom

On `/games/g7` (a sample game the viewer has joined locally), tapping "You're in · Tap to leave" → "Leave game" leaves the CTA unchanged; localStorage still lists `g7` in `openrun.joinedGameIds.v1` and the roster/counter don't update.

## Suspected root cause

The `AlertDialog` action calls `void handleJoin()` immediately after `setConfirmAction(null)`. The `handleJoin` closure reads `joined`, `isConfirmed`, `myReq`, `mySubs`, and `settings` from the render at the time the button was clicked — not from a fresh render — so the leave branch appears to run, but then the `try` block calls `refreshStatus()` in `finally` which re-fetches sample-game state that never existed and, more importantly, `leavingRef.current` is toggled back to false before the realtime channel emits.

The likelier concrete cause (needs one confirmation via a temporary `console.log`): the leave branch IS being taken, `leaveGame("g7")` runs, but the try-block `supabase.from("game_participants").delete()...` returns a `{ error }` that we ignore, THEN `refreshStatus()` in `finally` re-hydrates and something re-adds `g7` — OR the leave branch is not entered at all because one of the earlier guards (block check, paid redirect) short-circuits.

## Diagnostic step (build-mode)

Add one-shot `console.log` at these four points in `src/routes/games.$gameId.index.tsx` and reproduce the click:
1. Top of `executeJoinAction` — log `{ isConfirmed, joined, requiresApproval, isPaid, isPending, gameId: game.id }`.
2. Right before each early-return guard (invite expired, blocked, approved-but-unpaid) — log which guard fired.
3. Inside the `if (shouldTriggerLeaveBranch(...))` block — log "entered leave branch".
4. In the `catch` — log the error object.

Run leave → read console logs → identify which branch fires or which error re-adds the id.

## Fix (contingent on diagnosis)

Most likely one of:

- **Leave branch not entered**: correct the guard (e.g. a stale `settings` from a previous game caused `paymentCleared` to be false).
- **`joinGame` rollback in catch**: replace the broad `catch` with a narrower one that only rolls back on the specific delete failure, not on downstream notification/refresh failures.
- **`refreshStatus`/realtime re-adds the id**: gate `hydrateFromDb` / realtime merge in `src/lib/games-store.ts` so it skips ids the user has just removed locally (small "recently-left" tombstone Set with a short TTL, cleared once server confirms).

Remove all diagnostic `console.log`s before finishing.

## Verification

- Reproduce with Playwright on `/games/g7`: tap leave → CTA flips to the free-join style, roster shows 7/10, `localStorage.getItem('openrun.joinedGameIds.v1')` no longer contains `"g7"`, and reload keeps it out.
- Repeat on a hosted DB game the viewer joined: leave still tears down `game_participants` + `join_requests` + `payment_submissions` as before (existing behavior preserved).

## Out of scope

- No UI/design changes; no schema changes; no changes to the leave-branch predicate itself unless step 1 shows it's the culprit.
