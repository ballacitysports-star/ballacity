# SEC-8: payment authorization oracles

Status: **implemented locally on `claude/sec8-payment-oracles`, stacked on `claude/sec7-remaining-defects` (PR #280, 7f563e1e). Not merged, not applied to production.** No pull request is open. Nothing here enables payments: every change narrows who can write or read payment data.

Migration: `supabase/migrations/20261108140000_payment_oracles.sql` (applied after SEC-7). It has a dependency guard on PAY-1, SEC-2 and SEC-7 objects. SEC-5 (`20261108110000`, `fill_join_request_host`) is **not** in this base, so the guard does not require it. The new join-request trigger `a000_join_request_self_only` sorts before SEC-5's `a00_fill_join_request_host_trg`, so the two compose in either merge order. No helper wrapped by SEC-2 is redefined, so `wrap_oracle_helpers()` is not re-run. The migration is forward-only.

Verification: `node scripts/db-test.mjs` 2429 passed, 0 failed (7f563e1e: 2368). There are 59 new assertions in 540, and tests 100, 335, 340 and 490 were updated for the intended behaviour changes below. `npx vitest run` 3244 passed. `npx tsc --noEmit -p .` is clean. `bun run format:check:changed` is clean.

Negative control: test 540 was run against a database replayed from 7f563e1e.

- Run as written, it fails 7 assertions, then stops when it first calls the new `private_sec.payment_requires_approval`.
- With the 10 lines that call new functions removed, it fails 32 of 50, covering every section (1 to 6 and 8).
- The two new unit test files fail 11 of 15 tests against 7f563e1e's `src`.

## Shared rule

These new functions hold one definition of "may this player pay for this game now". The triggers and the PayPal server functions both use it:

- `private_sec.payment_requires_approval(game)`
- `private_sec.payment_approval_missing(game, player)`
- `private_sec.payment_guardian_missing(game, player)`
- `public.payment_precondition_error(game, player)`, callable by the service role only. It returns `GAME_NOT_FOUND`, `PAYMENTS_NOT_AVAILABLE`, `PAYMENT_DESTINATION_INVALID`, `HOST_APPROVAL_REQUIRED`, `GUARDIAN_APPROVAL_REQUIRED` or NULL.

The `payment_submissions` BEFORE INSERT order is now:

1. `a00_payment_self_only`
2. `a01_payment_approval_trg` (replaces `enforce_approval_before_payment_trg`)
3. `aa_payment_destination_trg`
4. Cohort, credentials and guardian-first checks, as before.

## 1. A payment insert revealed the payee (Medium)

**Fix.** `enforce_payment_destination` ignores the client's `host_id` on insert and sets it to `private_sec.game_payee(game_id)`. A game with no payee gets one generic `PAYMENT_DESTINATION_INVALID: payment cannot be sent for this game.` An update that changes `host_id` or `game_id` must still match the payee. The approval check now fires before the destination is resolved, and it resolves the payee itself.

**Behaviour change.** An insert naming the wrong payee is no longer refused: it is stored with the real payee. Tests 335 and 340 now assert that rewrite instead of the old refusal.

**Tests (540 §1).** A stranger with no approved request guesses three payees: an unrelated adult, the minor host and the real guardian. All three get the identical "Host approval required" error. An approved player who names an unrelated account is stored with the guardian as payee.

## 2. A self-made, unapproved payment unlocked the payee's handles (Medium)

**Fix.**

- Approval fails closed. A missing settings row means approval is required. A game whose host is not a confirmed adult always requires approval, even if a settings row says otherwise. Only the payee's newest settings row counts. This matches the join gate and `addPaidPlayerToRoster`.
- `get_host_payment_methods` now counts only these as involvement: being the host, an approved request to a game this person is the payee of, a **verified** payment to them, or a place on such a game's roster. A claim the caller wrote is no longer enough.
- The client no longer calls `get_host_payment_methods`. `listPaymentMethodsForHost` now requires a `gameId` and always uses the game-scoped `get_game_host_payment_methods`. The old RPC stays for older clients, with the narrower rule.
- `payer_to_payee` (PAY-1) counts only a verified payment, or a payment made after the payer's request to that game was approved. This relation is what opens `can_notify`.

**Behaviour change.** A paid game with no payment settings now needs an approved request before a payment proof can be sent. Test 100's fixture now sets `requires_approval = false` explicitly. Test 490's payer now has an approved request before paying.

**Tests (540 §2):**

- A minor-hosted game with no settings row, or with a forced "no approval" row, refuses a stranger's insert. So does an adult game with no settings row.
- With the stranger's legacy pending and rejected claims in place, the stranger gets 0 handles from both RPCs, and `can_notify` and `payer_to_payee` are false.
- A private adult game with no approval requirement: the stranger's own pending claim, then a rejected one, gives 0 handles and no `can_notify`. Once the host verifies the payment, the stranger gets 1 handle and `can_notify` is true (positive control).

## 3. A payment for another player revealed their cohort and guardian link (Medium)

**Fix.** A new first trigger, `a00_payment_self_only`, is added. A signed-in or anonymous API request whose `player_id` is not `auth.uid()` gets `PAYMENT_PLAYER_INVALID: you can only submit a payment for yourself.` before any cohort or guardian check runs. The service role (no `auth.uid()`) is unaffected.

**Tests (540 §3).** A stranger submits payments for three victims: a 15-year-old, a guardian-linked 16-year-old and an adult. All three get the identical error. Anonymous visitors have no table privilege at all.

## 4. A join request for someone else revealed their exact age (Medium–High)

**Fix.**

- `a000_join_request_self_only` is the first BEFORE INSERT trigger on `join_requests`. It gives the same message as `validate_join_request`: `Cannot create a join request for another player.`
- I checked `game_participants`. Row security already allows only `user_id = auth.uid()`, but the age, guardian, block and join-gate triggers ran before row security and leaked the same way.
- `a000_participant_self_only` (SECURITY INVOKER) refuses a direct anon or authenticated write for another user with `Cannot add another player to a game.`
- Legitimate server paths are unaffected, because they run as another role: definer functions acting for a host or guardian, and the service role rostering a paid player.

**Tests (540 §4):**

- A stranger targets a 15-year-old on a 15-only and a 16-only game. Both the join request and the roster row get identical errors.
- The game's host gets the same refusals.
- A guardian cannot write the child's roster row directly.
- The service role can still roster a player.
- The player's own request still goes through the age rule.

## 5. PayPal skipped approval and guardian checks and ignored a failed insert (Medium, latent)

**Fix (DB).**

- `enforce_guardian_before_payment` now also applies to the service role. Only a direct database session (migrations, maintenance) is exempt.
- The approval trigger applies to every API writer, the service role included.
- `paypal_orders.status` gains `refunded` and `unrecorded`.

**Fix (`src/lib/paypal.functions.ts`).**

- `createGamePayPalOrder` calls `payment_precondition_error` for the player before creating an order. It fails closed if the check errors.
- `captureGamePayPalOrder` refuses orders that are not `created` or `approved`. It re-runs the precondition check for `order.player_id` before `captureOrder`. If the check fails, the order is marked `failed` and the player is told they were not charged.
- After capture, the `payment_submissions` insert error is checked. If the insert failed, the capture is refunded with the new `refundCapture` in `paypal.server.ts`, and the order is marked `refunded`, or `unrecorded` if the refund also failed. The function throws instead of reporting success.

**Tests.**

- 540 §5 covers the database side:
  - The service role cannot record a payment for a guardian-linked teen, or for an unapproved player.
  - It can record one for an adult on a no-approval game.
  - Each precondition code.
  - The precondition function is not callable by signed-in users or anonymous visitors.
- `src/lib/paypal.functions.test.ts` has 10 mocked tests:
  - Create refuses on missing host or guardian approval, and on a check error.
  - Capture does not capture when a precondition no longer holds, or when the order already failed.
  - A failed insert triggers a refund and an error.
  - A failed refund marks the order `unrecorded` and raises an error.
  - The happy path.
  - The config uses the user's client.

## 6. `get_game_host_paypal` exposed merchant ids (Medium)

**Fix.**

- The function now returns the merchant id of `private_sec.game_payee(game)`, never `hosted_games.host_id`.
- It returns it only when the payee is a confirmed adult and the caller passes the same gate as `get_game_host_payment_methods` (`private_sec.game_payee_visible_to`): an adult-hosted public listing, or the host, the payee, an approved requester, a participant, their verified guardian, or staff.
- Execute is revoked from anon. Its entry was removed from the anon allow-list in `00_schema_invariants`.
- `getPayPalCheckoutConfig` now requires sign-in and calls the function as the user.

**Behaviour change.** A signed-out visitor no longer sees the PayPal button configuration. The pay flow already requires sign-in to create an order.

**Tests (540 §6):**

- Anonymous visitors cannot execute the function and get nothing.
- A stranger gets 0 for a minor-hosted game.
- An unrelated account gets 0 for a private adult game.
- A public adult listing still returns its host's merchant id.
- A participant of the private game gets it.
- An approved player of the minor-hosted game gets only the guardian's merchant id, never the minor's legacy one.

## 7. `reviewPaymentAction` treated any host as the payment manager (Low)

**Fix.** The manager is decided only by `game_payee_id(gameId) === userId`. A minor host, or any game with no payee, is refused.

**Tests.** `src/lib/payments.functions.test.ts`: the game's host is refused when the payee is someone else; everyone is refused when there is no payee; the payee is allowed; an adult host who is the payee is allowed.

## 8. The "mark paid" branch could never succeed (Info)

**Choice: removed.** A host has no INSERT policy, and SEC-8's self-only trigger makes the refusal explicit. Adding a definer RPC would have created a new way to write verified payments, which is outside this fix's remit, since nothing here may enable payments.

- `reviewPaymentAction` now throws `No payment submission to update.` when there is no submission.
- The "Mark as paid" button and its handler are removed from the roster row in `src/routes/games.$gameId.index.tsx`.

**Tests.** Unit test: with no submission, the action throws and inserts nothing. 540 §3: a host inserting a verified payment for a participant gets `PAYMENT_PLAYER_INVALID`.

## Open items

- SEC-5 is not in this base, so the guard cannot require its objects. Re-run the full suite after SEC-5 and SEC-8 are integrated together.
- A host who took cash has no way to record it. If that is wanted, it needs a reviewed definer RPC (payee only, linked player, approval and guardian rules applied).
- Older `payment_submissions` rows that name a non-payee `host_id` are not rewritten. Reads already filter by the current payee (PAY-1).
- After a post-capture amount or payee mismatch, the existing code marks the order `failed` without a refund. That behaviour is unchanged here.

## R5 independent review (39ae9545) correction

| #   | Finding                                                                                                                                                                                                                                                   | Severity | Correction                                                                                                                                                                                                                                                                                                    | Test                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | A player could UPDATE their own pending claim to another game and a guessed `host_id`; the destination trigger answered differently for the real payee (the guardian of a minor host) than for any other account, so the update was a payee yes/no oracle | High     | New first-firing SECURITY INVOKER trigger `a00_payment_keys_locked`: an API update that changes `game_id`, `host_id` or `player_id` is refused with one `PAYMENT_FIELD_FORBIDDEN` message before any data-dependent check. Definer and service-role code is unaffected; no client path changes these columns. | 540: identical errors for the real payee, an unrelated adult and a payee-only change; own pending edits still work. 2 fail without the trigger |

Also reported, not changed here (pre-existing, product decision): a user the minor host blocked gets `BLOCKED_BY_HOST` on a join request for that host's games, so the blocked user can list them. Options: run the block check last with the generic refusal, or accept and silently decline. Tracked as a follow-up.
