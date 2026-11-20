# Release record: guardian links end at 18 (#452), 2026-11-20

Production project `cpqihhcqeivbgxqbzatv`. Owner approvals in the session:

- 2026-11-20, "Guardian link end after 18": the rule (a guardian link ends when the child turns 18);
- 2026-11-20, "Approve all": the four decisions listed under "Decisions", applying the migration to the sandbox, and
  merging #452.

This record holds hashes, check results and counts only, no user data. **Not applied to production and not published.**
Applying the migration to production and publishing need the owner's separate approval.

## What shipped (merged, not live)

| PR   | What                                                                                       | Production step                      |
| ---- | ------------------------------------------------------------------------------------------ | ------------------------------------ |
| #452 | A guardian link stops binding when the child is a known adult; daily sweep records the end | `20261125200000`, then publish: held |

- Merged as `6dfd17e5` after a green CI run on its head `84cfc272` (attempt 4). Scope and design:
  `docs/guardian-link-age-18.md`. Migration: `supabase/migrations/20261125200000_guardian_links_end_at_18.sql`
  (md5 `4ec266a0`). SQL test 965 (209 assertions). Guarded rollback:
  `docs/rollbacks/20261125200000_guardian_links_end_at_18.down.sql`.
- The rule: a link is in force when its status is `active` and the child is not a known adult (stored birthday, `age()`
  of 18 or more, from 00:00 UTC on the birthday). An unknown birthday and a managed account keep the link.
- The app falls back to the old reading when the function is missing, so either deploy order is safe.

## Decisions (owner, "Approve all")

1. An adult with an old active guardian link can make a manual (Venmo, Cash App) claim. This changes the 2026-11-18
   decision "block up front"; the pay-page hold stays for managed accounts.
2. Managed accounts at 18 are not ended: they stay linked and the managing guardian is told once. No handover is built.
3. Consent records are kept, not revoked, at 18.
4. `profiles.age_cohort` is not aged here: a separate decision.

## Sandbox (`qkukefvzwlyusvspablz`)

Applied about 21:25 UTC by the ledger route (one transaction: insert the ledger row with the file's text, raise unless
its md5 equals the file's, run the stored text with `EXECUTE`).

| Step | Result                                                                                                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre  | ledger 62, latest `20261124200000`; version and new functions absent; 0 active links                                                                                                                       |
| Post | ledger 63, latest `20261125200000`; ledger text md5 `4ec266a0`; 9 new functions, restore trigger present; `anon` may not run the server function, `authenticated` may run only `my_guardian_link_in_force` |

The sandbox has 4 profiles, all adults, and no guardian links or managed accounts, so the migration changes nothing for
the E2E accounts.

## Checks

- Local: `tsc` clean; vitest 4816 passed, 22 skipped; lint ratchet, format and policy gate clean; full SQL suite 3235
  passed, 0 failed; E2E on the local stack 139 passed. Negative controls each fail as expected (migration absent,
  threshold 19, rule always true, unknown birthday as adult, managed ended, switches keyed on the stored cohort,
  restore trigger inert, old notice logic). Apply and rollback rehearsed on throwaway replays.
- CI on `84cfc272`: unit, lint, typecheck and build, SQL suite green. Playwright and E2E smoke ran four times against the
  sandbox: attempt 1 (before the sandbox apply) green; attempts 2 and 3 (after) each failed one or two realtime or
  notification specs (`join-cross-device-discover-spots`, `invite-request-tampered`) that pass locally; attempt 4 green
  (smoke 30/30). The migration does not touch the realtime or notification path, and the other session confirmed it ran
  nothing on the sandbox in those windows. Treat those two specs as flaky on the shared sandbox.
- Adversarial review: 2 medium and 1 low finding, all fixed before the PR.

## Production (read-only, 2026-11-20)

Counts only, run before the PR was opened:

| Count                                                  | Value |
| ------------------------------------------------------ | ----- |
| Active links                                           | 2     |
| Would end now                                          | 0     |
| Known adult but managed (would stay)                   | 0     |
| Unknown birthday (would stay)                          | 0     |
| Under 18 (would stay)                                  | 2     |
| Turning 18 within 30 days                              | 0     |
| Open requests whose guardian approval would be cleared | 0     |
| Consent records on links that would end                | 0     |

Applying today would change no data. Production's catalog is unchanged: ledger 411, last applied
`20261124200000_manual_claim_guardian_ready`.

## Left open

- **Production apply and publish:** held for the owner. Order: migration first (ledger route), then the app.
- The managed-account handover at 18 (options in `docs/guardian-link-age-18.md`).
- Whether and when to age `profiles.age_cohort`.
- The game page still shows "ask your parent" copy to an adult with a leftover link until the migration is applied.
