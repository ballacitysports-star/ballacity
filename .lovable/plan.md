## Goal

Lock in the "leave after verified payment" flow with automated tests so future changes can't regress:
- CTA on the game detail page collapses from "Confirmed · Tap to leave" back to "Request to join" / "Pay to join"
- The "Payment verified — you're on the roster" status strip disappears and stays gone
- The viewer is removed from the roster ("YOU" chip gone, count decremented)
- Host's pending-approval list no longer shows the former player
- Tapping "Request to join" after leaving actually creates a new request instead of re-firing the leave branch

## Tests to add

### 1. Unit: leave-branch condition (fast, no DB)

`src/routes/games.$gameId.leave-branch.test.ts` — pure logic test around the predicate used at the leave branch entry. Extract the tiny helper `shouldTriggerLeaveBranch({ isConfirmed, joined, requiresApproval, isPaid })` from `games.$gameId.index.tsx` into `src/lib/leave-branch.ts` and unit-test it with a matrix:
- confirmed → true
- stale joined + requiresApproval → false (regression guard for the bug just fixed)
- stale joined + paid → false
- joined on free/no-approval → true
- nothing set → false

Keeps the regression cheap to catch even if the route file changes.

### 2. E2E: leave-with-verified-payment (Playwright)

`e2e/leave-verified-payment-consistency.spec.ts` — end-to-end against localhost:8080 using the injected Supabase session.

Setup (SQL fixture inserted via a tiny server function or direct supabase-js calls in the spec `test.beforeAll`):
- Create a hosted game owned by a second seeded host account (reuse `docs/e2e-test-accounts.md` fixtures)
- Create `game_payment_settings` with `requires_approval=true` and `entry_fee>0`
- Insert an approved `join_requests` row for the signed-in viewer
- Insert a `verified` `payment_submissions` row for the viewer
- Insert the viewer into `game_participants`

Assertions on the viewer device (single context):
1. Navigate to `/games/<id>`. Assert the "Your status · Payment verified — you're on the roster" strip is visible, the sticky CTA reads "Confirmed · Tap to leave", the roster shows a "YOU" chip, and the roster header count includes the viewer.
2. Tap the CTA, confirm the leave dialog. Assert (within 10s):
   - strip disappears and does NOT reappear after a further 3s wait (guards the realtime-rehydrate regression)
   - CTA flips to "Request to join · N spots left"
   - "YOU" chip gone from roster; header count decremented
3. Tap "Request to join". Assert a toast that is NOT "You left the game", and that the CTA transitions to "Request pending · Tap to cancel" and a pending `join_requests` row exists for the viewer (poll via supabase-js).

Then open a second BrowserContext signed in as the host account:
4. Navigate to the host's pending list surface (game detail as host, or `/notifications` / host approval panel — whichever surface renders `hostRequests`). Assert that the former player is NOT listed after leave, and IS listed once step 3 creates the new pending request.

Cleanup in `test.afterAll` deletes the fixture rows so re-runs are idempotent.

Auto-skips when `LOVABLE_BROWSER_SUPABASE_*` env vars are missing (same guard used by existing specs like `join-realtime-cross-views.spec.ts`).

### 3. Integration: DB-level clear

`src/lib/leave-verified-payment.integration.test.ts` — vitest against the live Supabase publishable client, guarded by the same env-var check as other `*.integration.test.ts` files in this repo. Exercises just the server side of the leave flow:
- seed approved request + verified submission + participant row for the viewer
- call `deleteMyPendingSubmission` (for the verified row), `withdrawMyApprovedJoinRequest`, and the `game_participants` delete
- assert all three rows are gone
- assert a subsequent `getMyJoinRequest` returns `null` and `listMySubmissionsForGame` returns `[]`

Locks in the RLS policies that were added earlier (`Players withdraw own submissions`, `Players withdraw own join requests`) so a future policy edit that re-narrows either DELETE would fail this test loudly.

## Out of scope

- No UI changes.
- No new production code beyond extracting the tiny `shouldTriggerLeaveBranch` helper (needed for unit test) and wiring it back into the route file.
