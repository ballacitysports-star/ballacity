# Release record: manual payments and leftover guardian links (#440), 2026-11-20

Production project `cpqihhcqeivbgxqbzatv`. The owner's approvals in the session:

- 2026-11-18, "Continue as recommend": for `docs/paid-path-gates.md` section 6 (d), block up front and leave the guardian
  rule unchanged;
- 2026-11-19, "Continue as recommended": apply the migration to the sandbox, then to production before publishing;
  merge once CI is green;
- 2026-11-20, "Allot sbq.sh": allow the sandbox-only script that the session's permission check had blocked twice.

This record holds hashes, check results and counts only, no user data. The other session's batches 13 to 20 shipped
alongside this and are recorded by that session.

## What shipped

An adult (18+, stored birthday) whose guardian link from before 18 is still active was offered Venmo, Cash App and the
proof form on the pay page. The database's manual-claim trigger (`enforce_guardian_before_payment`) then refused their
proof. The guardian rule is unchanged. The pay page and the game page's Payments tab now ask the trigger's own rule
first, through a new read-only function, and hold the manual methods back. PayPal, which the server accepts for that
adult, stays offered.

| PR   | What                                                                   | Production step                |
| ---- | ---------------------------------------------------------------------- | ------------------------------ |
| #440 | Pay page and Payments tab: no manual payment the guardian rule refuses | `20261124200000`, then publish |

- #440 merged as `23760091` after a green CI run on its head `8af4fccc`: unit, lint, typecheck and build, SQL suite,
  Playwright and E2E smoke, against the sandbox with the function applied.
- The migration was renumbered twice as `main` moved (`20261120100000` / test 910, `20261123100000` / test 940, now
  `20261124200000` / test 955). No function body changed.

## 1. Sandbox (`qkukefvzwlyusvspablz`)

Applied about 13:58 UTC by the ledger route (below).

| Step | Result                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------- |
| Pre  | ledger 61, latest `20261124100000_host_groups`; version and function absent                                 |
| Post | ledger 62; ledger text md5 `8e591709`; function md5 `109ac8d2`; `authenticated` may execute, `anon` may not |

The E2E run that had started before the apply was cancelled and re-run, so it ran entirely against the new state.

## 2. `20261124200000_manual_claim_guardian_ready`

Same route as earlier batches, in one transaction:

1. Insert the ledger row holding the file's text exactly as on `main`.
2. Refuse unless that text's md5 equals the file's.
3. Run the stored text with `EXECUTE`.

Fingerprints use batch 8's C-collation method over `docs/migration-evidence/catalog-fingerprint-cte.sql`.

| Step             | Result                                                                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File             | md5 `8e591709` (same on `main` `23760091` and in the apply statement)                                                                                                        |
| Local rehearsal  | Replay of `main` `23760091` without the file: `9cebac33` (3435). With it: `bdb6d77d` (3436). The apply script on a replay without the file landed on function md5 `109ac8d2` |
| Negative control | A copy requiring a wrong md5 raised and rolled back: ledger row absent, function absent                                                                                      |
| Production pre   | `9cebac33`, 3435 objects, ledger 410 (equals the replay without the file); no row for the version                                                                            |
| Production post  | `bdb6d77d`, 3436 objects (equals a full replay of `main` `23760091`), ledger 411, ledger text md5 `8e591709`                                                                 |
| Function         | `game_manual_claim_guardian_ready(text)` md5 `109ac8d2`; `authenticated` may execute, `anon` may not                                                                         |
| Errors           | 0 `app_error_events` in the 30 minutes before the post-check                                                                                                                 |

Rollback: `docs/rollbacks/20261124200000_manual_claim_guardian_ready.down.sql`. It needs a confirmation setting and
refuses if the function's definition has changed. Roll the app back first: without the function, the pay page holds
back the manual methods for everyone (PayPal stays).

## 3. Publish

| Step                        | Detail                                                |
| --------------------------- | ----------------------------------------------------- |
| Lovable `latest_commit_sha` | `main` `23760091`, the #440 merge                     |
| Order                       | after the production apply, as the migration requires |
| Deployment                  | `7b3dbce9`, about 14:50 UTC                           |

The publish also carried the other session's #448 (wording, tap targets; no migration) if it was not yet live.

## Production at the end

- Catalog: equals a replay of `main` `23760091`, fingerprint `bdb6d77d`, 3436 objects.
- Ledger: 411 rows.

## Left open

- Guardian links do not end at 18, and an adult cannot end their own (only the guardian, and never for a managed
  account). Ending them would relax a guardian rule: an owner question.
- The game page still shows "ask your parent" copy to these adults on paid open games (`guardianOnlyJoin`).
- `get_game_host_payment_methods` still returns the handles to this viewer through the API; the app no longer shows
  them.
- In progress, stacked on #440: a fresh player on a paid open game sees "Host hasn't set up payment yet" (section
  6 (c)); a full game is a warning on the pay page and a refusal in the database.
