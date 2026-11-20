# Release record: pay page for a new player, and a full game (#450), 2026-11-20

Production project `cpqihhcqeivbgxqbzatv`. Owner approvals in the session:

- 2026-11-20, "Continue session as you recommend": build the fix for `docs/paid-path-gates.md` section 6 (c) and the
  full-game item;
- 2026-11-20, "Yes": merge #450 and publish it.

This record holds hashes, check results and counts only, no user data. **No database change:** #450 is app only, so
there is no migration, no ledger row and no production apply.

## What shipped

| PR   | What                                                                                                                  | Production step |
| ---- | --------------------------------------------------------------------------------------------------------------------- | --------------- |
| #450 | Pay page: a new player on a paid open game sees the host's payment options; a full game is blocked before any handles | publish         |

- **New player on a paid open game.** `/pay` read the host's `game_payment_settings` row, which RLS hides from a viewer
  who is not yet the payee, an approved requester, a payer or a participant. The page showed "Host hasn't set up payment
  yet" although the server would let that player pay. It now takes what it needs from sources the viewer may read:
  `get_game_join_policy` (whether approval is needed), the game's host (who is paid), and
  `get_game_host_payment_methods` (the methods, with its own server checks). It fails closed: a failed approval read
  shows Retry, never "no approval needed". An approval-required game still shows "Waiting on host approval" and the
  methods are not requested until the host approves. No RLS or RPC changed.
- **Full game.** A viewer who is not on the roster is blocked before any handles when the roster count is at or above
  `max_players`, the rule `private_sec.payment_claim_block` applies (`GAME_FULL`, #434). A rostered viewer and the host can
  still pay.
- **Review fixes (low):** a PayPal payer whose own payment filled the last place re-reads the roster after the capture;
  a game read by id counts before the store's first full load; an unapproved viewer on an approval game no longer
  receives the handles.

## Checks

- #450 merged as `ab013cd4` after a green CI run on its head `fb8c40ff`: unit, lint, typecheck and build, SQL suite,
  Playwright and E2E smoke (all against the sandbox).
- Local, before merging: `tsc` clean; vitest 4799 passed, 22 skipped; lint ratchet, format and policy gate clean;
  E2E on the local stack, all `pay-*` and `invite-pay-and-join*` specs (22 files): 52 passed, 0 failed.
- The new `e2e/pay-fresh-viewer-methods.spec.ts` runs against real RLS on the local stack (the player's settings read
  returns `[]`, yet they see the host's handle) and fails on the old pay page. It writes rows, so it is skipped against
  hosted projects, CI's sandbox included; CI runs the mocked full-game tests in `pay-entry-blocked.spec.ts`.
- An adversarial review approved it with 3 lows, all fixed.

## Publish

| Step                        | Detail                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Lovable `latest_commit_sha` | `main` `ab013cd4`, the #450 merge, after about 5 minutes of sync                                                |
| Deployment                  | `2dfb8742`, about 15:46 UTC                                                                                     |
| Production catalog          | unchanged: ledger 411, last applied `20261124200000_manual_claim_guardian_ready` (read-only check at 15:46 UTC) |

## Production at the end

- Catalog: unchanged by this release (batch record `2026-11-20-guardian-manual-claim.md`: fingerprint `bdb6d77d`,
  3436 objects, ledger 411).

## Left open

- A new player still does not see the host's general payment instructions, the payment deadline or the entry fee before
  approval or payment; they see the game's price, as on the game page, and PayPal charges the entry fee on the server.
  Showing them earlier needs a public RPC (a migration): an owner decision.
- On an open game, a new viewer who is then blocked by the age range or a full roster still receives the host's handles
  in the `get_game_host_payment_methods` response; the page never shows them.
- Guardian links do not end at 18 and an adult cannot end their own: an owner question.
- The game page still shows "ask your parent" copy to an adult with a leftover guardian link (`guardianOnlyJoin`).
