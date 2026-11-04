# PAY-1 — payment-path fixes (payments remain disabled)

Status: **implemented on a branch, not merged, not deployed, not production-verified.**
This change does not enable or activate payments. `game_payments_allowed` and the payment
feature flags are untouched.

Migration: `supabase/migrations/20261107110000_payment_path_fixes.sql`
Test: `supabase/tests/490_payment_path_fixes.test.sql`
Depends on: SEC-1 (`20261107100000_stack_hardening_from_review.sql`) and, through it, R7 and PRIV-2B.
It has a dependency guard that fails if `private_sec.game_payee` or R7's `can_notify` is missing.

## Fixes

| # | Finding | Fix |
|---|---------|-----|
| 1 | A guardian payment manager (the payee of a minor-hosted game) received no payment notifications, because `can_notify` had no payer/payee relation. | New `private_sec.payment_relation(a, b)`: a payment submission in the last 120 days, or a pending/approved join request in the last 90 days, where the other party is the game's **current** payee. `can_notify` allows it in both the minor and adult branches. It does not create any other messaging permission. |
| 2 | Refund-owed notices on a minor-hosted paid game went to the host, not the payee who holds the money. | `settle_paid_spot` and `settle_on_game_cancelled` notify `COALESCE(private_sec.game_payee(game), host)`. |
| 3 | A minor host could not save settings for a free game (no payee is needed, so it is NULL), which forced every free minor-hosted game into request-to-join. | The settings insert/update policies also allow the real host when the game has no payee **and** `entry_fee = 0`. Paid settings still need the payee. |
| 4a | `payment_submissions`: the stored `host_id` could keep reading and verifying submissions after the payee changed or a guardian link was revoked. | SELECT needs `can_manage_game_payment_settings(game)` or the game's host; UPDATE (verify) needs `can_manage_game_payment_settings(game)`. |
| 4b | `get_game_host_payment_methods` answered for private games to anyone holding the ids. | Answers only for a publicly visible listing, or for the host, payee, a requester, a participant, or their verified guardian. |

## SEC-2 interplay

`can_notify` is one of the helpers wrapped by SEC-2 (#273). The migration re-runs
`private_sec.wrap_oracle_helpers()` when it exists, so either order of SEC-2 and PAY-1 ends wrapped.

## Verification

- `bun run test:db` on the SEC-1 head plus this migration: full suite green (1892 passed, 0 failed at the time of writing, including test 490).
- Test 490: 16 assertions; with the migration removed (SEC-1 base), 8 of them fail (negative control).
- No production statement was run; no migration was applied anywhere outside a scratch database.
