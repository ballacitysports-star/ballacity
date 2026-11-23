# Release record: three owner decisions (#459, #460, #461), 2026-11-23

Owner approvals in the session:

- 2026-11-21, "do all 3 steps as your best recommendation": build the three open owner decisions at the recommended
  option (managed-account handover at 18, aging the stored age group at 18, payment terms before approval);
- 2026-11-22, "All 3": apply the three migrations to the E2E sandbox;
- 2026-11-23, "merge all and publish in order": merge #459, #460 and #461 in that order, then publish main.

This record holds hashes, check results and counts only, no user data. **The three migrations are NOT applied to
production.** Applying them there needs the owner's separate approval.

## What shipped

| PR   | What                                                                                        | Migration        | Merge commit | Production step |
| ---- | ------------------------------------------------------------------------------------------- | ---------------- | ------------ | --------------- |
| #459 | Fee, deadline and accepted app names shown before approval; host methods tightened          | `20261128120000` | `9a963327`   | held            |
| #460 | Managed-account handover at 18: guardian starts, the adult completes from an emailed link   | `20261128100000` | `274902c8`   | held            |
| #461 | Stored age group ages to adult at 18 by a separate daily sweep, holding what it would widen | `20261128110000` | `7ef37431`   | held            |

Designs: `docs/paid-path-gates.md` section 6 (f), `docs/managed-account-handover.md`, `docs/age-cohort-at-18.md`.
Each migration has a SQL test (993, 991, 992), a guarded rollback in `docs/rollbacks`, and negative controls (17, 34 and
25 mutants, all failing the test). The app works without the migrations: the handover entry is hidden, the payment
terms read falls back to today's view, and the age cohort change has no app code.

## Sandbox (`qkukefvzwlyusvspablz`)

Applied 2026-11-22 by the ledger route, in the order 20261128120000, 20261128100000, 20261128110000.

| Step | Result                                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Pre  | ledger 66, latest `20261127110000`; none of the three present                                                                             |
| Post | ledger 69; ledger text md5s `f55965ef`, `1ffeb356`, `5bfe22f4` equal the files; objects equal a full replay of main plus the three (3498) |

The sandbox also holds `public._schema_import_requests` (a table, 3 columns, a primary key), which is not from any
migration and predates these applies; it is the only difference from the replay. pg_cron is not installed on the
sandbox, so the daily sweeps are not scheduled there and were not run.

## Checks

- Local, per branch merged with main: `tsc` clean; vitest all passed; lint ratchet, format and policy gates clean; full
  SQL suite passed with 0 failed (3847, 3846 and 3706 at the time). The anonymous-callable audit needed
  `private_sec.can_read_engagement` listed (same reason as `can_comment_on_minor_content`; commit `6a5539d9`).
- CI on each PR head: unit, lint, typecheck and build, SQL replay and tests, Playwright and E2E smoke all green.
- CI on `main` after #459 (`9a963327`), #460 (`274902c8`) and #461 (`7ef37431`, run 1384): green.
- Adversarial review before each PR: high and medium findings fixed (handover: credentials a guardian could have planted,
  half-done states; age cohort: comments and reactions readable after the flip, age and roster row, queue starvation).

## Read-only production counts (2026-11-22)

- Age cohort: 0 people would be aged (0 from teen_13_15, 0 from teen_16_17); 1 teen still under 18; 0 turning 18 within
  30 days.
- Handover: 2 managed accounts, 0 of them known adults, 0 turning 18 within a year.
- Payment terms: 0 open games with payment settings.

## Publish

Main `7ef37431` published via Lovable project `9bd576a8-703f-4180-84d6-2cd32f2a851b`, deployment
`d30f85b5-0ce7-42c0-91c8-14357b5625ba`, requested 2026-11-23 about 03:15 UTC. The deploy call returned `pending`; the
live site could not be reached from the session container, so the live build is **not confirmed by this record**.

## Open owner decisions

- Handover: reword the #452 "contact support" notice (needs a later migration); a second factor beyond the mailbox;
  whether handing an account to an adult carries a consent or notice requirement (legal, issues #306 to #313 untouched).
- Age cohort: how long the age and roster-row hold lasts; whether new comments and reactions open from the flip; the 13
  and 16 transitions and under-13 (legal).
- Production: applying `20261128100000`, `20261128110000` and `20261128120000` (separate approval; the Phase 5 session
  and this one agreed not to run DDL on production at once, and `public.profiles` DDL needs a lock timeout and a retry).
