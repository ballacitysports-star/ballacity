# P0-1 runbook: reconcile production with `main` and activate branch protection

Prepared 2026-11-06 from the Phase 0 audit (backlog item P0-1). **Nothing in this file has been run against production.**
Every step marked _approval_ needs the owner's explicit approval at the time it is taken, and is recorded (who, when,
output). Database steps are either read-only checks or one reviewed file applied whole, unchanged, through Lovable's
migration tool. Each was rehearsed on a local replay of `main` (section 5).

| Step | What                                                                                  | Touches                         | Approval |
| ---- | ------------------------------------------------------------------------------------- | ------------------------------- | -------- |
| A    | Pre-check (read-only)                                                                 | nothing                         | no       |
| B    | Apply the seven merged, unapplied migrations, in order, through Lovable               | production database (7 files)   | yes      |
| C    | Verify (read-only)                                                                    | nothing                         | no       |
| D    | Ledger rows for the hand-applied history, by group                                    | `supabase_migrations` ledger    | yes, per group |
| E    | Catalog fingerprint: production equals a replay of `main`                             | nothing (reads)                 | no       |
| F    | Activate the `main` ruleset (GitHub settings)                                         | repository settings             | yes      |
| G    | Decide how Lovable works under the ruleset                                            | process                         | yes      |

## 1. What is being reconciled, and why in this order

Production (`cpqihhcqeivbgxqbzatv`) and `main` differ in three ways (`docs/migration-history-reconciliation.md`):

1. **Seven files on `main` are not applied.** Five are drift captures that write down what production already has by
   hand (`20261103100000` to `20261103104000`); applying them changes nothing on production and gives them a ledger
   record. Two are real fixes: `20261103130000_profile_insert_guard` (a client-created profile row cannot pick its own
   age cohort) and `20261103140000_payment_settings_host_guard` (the full payment-settings fix; its write half is already
   live as hotfix `20261102100000`, applied 2026-11-05).
2. **71 hand-applied files have no ledger row.** The evidence per file is in `docs/migration-evidence/ledger-evidence.csv`
   with a proposed disposition each. Rows record history; they apply nothing.
3. **The ruleset on `main` is documented, not active** (`docs/branch-protection.md`). Lovable commits to `main` and
   applies SQL outside the pull request flow.

Order: A before B because B must not run if the hole in `20261103140000` has been used (a settings row or a payment
claim naming a payee other than the game's host would make the new trigger refuse legitimate rows, and would be evidence
to review first). The five captures go before the two fixes so that a failure in a fix leaves the captures recorded.
D after C because two of the drift holds in D are lifted only by the captures being recorded. E after D so that the
fingerprint and the ledgers are compared in one state. F and G are independent of the database and can be done first if
the owner prefers; nothing in A to E depends on them.

## 2. Before any step

- **The approved commit.** Check out `main` at the commit the owner approved. The seven texts must be byte-identical to
  the hashes in the table below (`sha256sum supabase/migrations/<file>`).
- **Backup point.** Note the latest backup and its time in UTC in the Lovable or Supabase dashboard. The rollbacks in
  section 4 do not need it; restoring a backup would discard every change since, so it is a separate decision.
- **Quiet window.** No other merges to `main` and no Lovable agent edits during steps A to E. Lovable's bot commits to
  `main` attributed to the owner, so look at the `main` head before each step.
- **Release record.** Keep the approvals, each check's output (catalog data and ledger hashes only, never user data),
  and each applied file's hash and time.

| Order | File                                                         | Lines | sha256 (file)       | sha256 (without final newline) | Effect on production                                   |
| ----- | ------------------------------------------------------------ | ----- | ------------------- | ------------------------------ | ------------------------------------------------------ |
| 1     | `20261103100000_single_review_helpfuls_trigger.sql`          | 28    | `c7040ea0…e7e8fbf70` | `7f1d3e83…ad79f164f`           | none (the duplicate trigger is already absent)         |
| 2     | `20261103101000_capture_enforce_gym_review.sql`              | 78    | `553ced76…cbc7b1768b` | `d799c8ed…0aae0e1b3`          | none (identical text; md5 `1c776a86…`)                 |
| 3     | `20261103102000_capture_review_ring_suspects.sql`            | 43    | `cadae5a3…d870918b1` | `8cb45554…bff70ed6f5`          | none (identical text; md5 `f41ec9f3…`)                 |
| 4     | `20261103103000_revoke_enforce_skill_vote_execute.sql`       | 13    | `2d125855…9f6d82be82` | `ac6d6168…cbd5048a`           | none (grants already service_role only)                |
| 5     | `20261103104000_revoke_enforce_review_integrity_execute.sql` | 13    | `3b76ac3b…79740d72c` | `f226a844…c10c5fbac4f`         | none (grants already service_role only)                |
| 6     | `20261103130000_profile_insert_guard.sql`                    | 57    | `2194cbdc…aedf8b8f` | `e441cfb8…57cc5131`             | adds `guard_profile_insert()` and its trigger          |
| 7     | `20261103140000_payment_settings_host_guard.sql`             | 628   | `5c74b31e…006eb678` | `3e087726…ccee6caed`            | replaces 8 functions and 1 read policy, adds 3 functions and 1 trigger; no row changed |

Full hashes are in `docs/release/p0-1-precheck.sql` and `p0-1-verify.sql`.

## 3. Steps

### A. Pre-check (read-only)

Through Lovable's database tool, run the single `SELECT` between `BEGIN READ ONLY;` and `ROLLBACK;` in
`docs/release/p0-1-precheck.sql`. It returns **32 rows**; every `ok` must be true. It confirms the server is Postgres 17,
that the five captures already describe production (so applying them is a no-op), that the two fixes are absent while the
hotfix they build on is present, that the read policy the full fix replaces is exactly production's (so the rollback
restores this state), that no settings row and no payment claim names a payee other than the game's host, and that none
of the seven is in either ledger.

If either count is not 0, **stop**. The hole was used. Review those rows before anything else; the full fix's trigger
would otherwise refuse them.

### B. Apply through Lovable _(approval)_

For each file, in the order of the table, send Lovable the file's exact text and ask it to apply it with its migration
tool, **unchanged**. Lovable has applied comment-stripped bodies before; the verify step recognises a file only by the
hash of the exact text (with or without its final newline). Do not let it tidy the SQL.

- Lovable runs each file in one transaction and records `sha256(text)` in `drizzle.__drizzle_migrations`. It writes no
  `supabase_migrations` row and then commits a drizzle copy to the repository. Those copies replay twice locally only
  because they are idempotent; after this step, remove the drizzle copies or keep the supabase originals, per
  `supabase/tests/README.md`, in a follow-up PR (backlog P0-4).
- Files 1 to 5 change nothing; if Lovable reports "no changes", that is the expected outcome, and the ledger row is the
  point.
- File 7 ends with no stop guard of its own; the pre-check's two counts are that guard. Apply it only if A passed.
- If a file fails part way, Lovable's transaction rolls it back. Record the error, do not re-apply the same text until the
  cause is known, and re-run the pre-check.

**Alternative, direct `postgres` connection.** `psql -X -v ON_ERROR_STOP=1 --single-transaction -f <file>` for each file,
then the supabase ledger row for it (section D, group D), then C.

### C. Verify (read-only)

Run the statement in `docs/release/p0-1-verify.sql` the same way. **52 rows**, every `ok` true. It checks the md5 of every
function the seven files define, their EXECUTE grants, the four `game_payment_settings` policies, the three triggers, that
the duplicate trigger is absent, the two counts, and that each of the seven is recorded in a ledger (supabase version or
drizzle hash in either newline form). `enforce_review_integrity` is checked by grants only: its body differs in production
by design until #245 captures it.

### D. Ledger rows for the hand-applied history _(approval per group)_

`docs/release/p0-1-ledger-rows.sql` holds one `INSERT` per file in its own transaction, idempotent, `statements` empty, as
the reconciliation document's template prescribes. Groups:

| Group | Files | State in the script | What the owner approves                                                                                   |
| ----- | ----- | ------------------- | --------------------------------------------------------------------------------------------------------- |
| A     | 52    | active              | protective and optional rows for files with a version of their own; the evidence is the CSV, row by row  |
| B     | 6     | commented out       | rows whose evidence is a data or bucket postcondition; read the postconditions column first              |
| C     | 5     | commented out       | holds: two drift holds lift after step C (`review_ring_detection`, `skill_ratings`); two wait for #245; the `sport_hubs` setting is an operator choice to confirm |
| D     | 7     | commented out       | optional supabase rows for the seven P0-1 files (Lovable writes drizzle rows in step B)                   |
| E     | 8     | commented out       | the four duplicate-version pairs (#289): one row per version named after the first file, or none          |

Run only the approved groups, through Lovable's database tool or psql. Before and after, record
`SELECT count(*) FROM supabase_migrations.schema_migrations;` (288 before, per the reconciliation document).

### E. Fingerprint: production equals a replay of `main` (read-only)

Run `docs/migration-evidence/catalog-fingerprint-cte.sql` with the per-kind digest query from its README against
production and against a local `node scripts/db-test.mjs --replay-only --keep`. After A to C, the only expected
differences are the drift register's rows 1 to 3 (`reviews.recommend/answers/tags`, `review_question_keys/tag_keys`,
`enforce_review_integrity` and `player_trait_counts` bodies), which #245 captures. Anything else is new drift: record it,
do not "fix" it by hand.

### F. Activate the ruleset _(approval; GitHub settings, not the repository)_

Follow `docs/branch-protection.md` section 0 exactly. Preconditions re-checked on 2026-11-06 through the GitHub API:

- `main` head `eb124b1` (merge of #295, 2026-11-05 22:20 UTC): workflow `Unit & Lint` (jobs `Unit tests`, `Lint`,
  `Typecheck & build`) concluded success (run 42120716997); workflow `Database tests` (job `Replay migrations and run SQL
  tests`) concluded success (run 42120716996). Both within the seven-day window GitHub needs to offer a check as required.
- `E2E` on the same head concluded failure (run 42120717140). It stays **not required**, as the document says.

Ruleset: require a pull request; 0 approvals while there is one account, with conversation resolution and dismiss-stale
on; required checks `Unit tests`, `Lint`, `Typecheck & build`, `Replay migrations and run SQL tests`, branches up to date;
block force pushes and deletions; **empty bypass list**. Verify with a documentation-only PR (all four checks report, none
stays "Expected") and a rejected direct push.

### G. Lovable under the ruleset _(decision)_

Once F is active, Lovable's direct commits to `main` are rejected. The owner chooses one of:

1. Lovable works on a non-default branch and opens a pull request (test with a trivial edit outside a release window).
2. Lovable's GitHub sync is paused during release windows and its edits are made in PRs by people.
3. A time-boxed bypass held only by the owner, every bypassed commit reviewed afterwards.

Lovable applying a migration to the database is not governed by the ruleset. Treat every "Applied <migration>" commit as
a production change with its own approval, which is what sections A to C do.

## 4. Rollback

- Files 1 to 5: no rollback is meaningful; they record production's existing state. Re-creating the duplicate trigger
  or widening the grants would re-introduce the drift.
- File 6: `docs/rollbacks/20261103130000_profile_insert_guard.down.sql` (guarded by
  `app.confirm_reopen_profile_insert=yes`).
- File 7: `docs/rollbacks/20261103140000_payment_settings_host_guard.down.sql` (guarded by
  `app.confirm_reopen_payment_settings=yes`). It re-opens the hole the hotfix closed only partly, so it is for a
  regression that blocks hosts, not for comfort. The hotfix `20261102100000` stays in place after this rollback.
- Ledger rows (step D): `DELETE FROM supabase_migrations.schema_migrations WHERE version = '<v>'` for the rows inserted,
  each in its own transaction, with the same approval as the insert.
- Ruleset: set it to Evaluate or disable it in GitHub settings.

## 5. What was rehearsed (local, 2026-11-06, Postgres 16.15)

Postgres 17 was not available locally; the hashes are of the repository's own texts. The E2E sandbox (Postgres 17.11) then
served as the Postgres 17 rehearsal: after the same files were applied there, `p0-1-verify.sql` passed all 52 checks. Policy
and trigger hashes are computed with the `public.` schema prefix removed, so they do not depend on the session's
`search_path` (Lovable's tool and the Management API run the bare `SELECT`; psql with the file sets `search_path = ''`).

| Model                                                       | Built from                                                                   | Pre-check            | Verify               |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------- | -------------------- |
| `prodlike` (production state)                               | replay of `main` without the seven files, plus files 1 to 5 (no-ops)         | 31/32 ok (server major only) | 26 not ok (negative control) |
| `prodlike2` (after step B)                                  | `prodlike` plus files 6 and 7, ledger rows seeded in both forms              | 10 not ok (negative control) | 51/52 ok (server major only) |
| full replay of `main`                                       | `node scripts/db-test.mjs` (401 files, 999 SQL assertions)                   | fingerprints of every object the seven files touch equal `prodlike2`'s | |
| ledger script                                               | applied twice to a copy of `prodlike2`                                       | 52 rows inserted, then 0 (idempotent) | |
| **E2E sandbox `qkukefvzwlyusvspablz` (Postgres 17.11, live)** | the same nine files (plus the two hotfixes it also lacked) applied through the Management API as one transaction, 2026-11-06 | pre-state matched (captures present, fixes absent, counts 0) | **52/52 ok**, including `server major` |

The capture files' headers state the production md5s read on 2026-11-03 (`enforce_gym_review` `1c776a86…`,
`review_ring_suspects` `f41ec9f3…`); the pre-check expects exactly those, so a production that drifted again since fails
the pre-check rather than the apply.

## 6. What this runbook does not authorize

- No production DDL and no ledger write without the approval recorded at the step.
- No replay of any historical file, no restoration of a backup, no edit to a file's text.
- No change to the E2E or Playwright requirements; `Playwright` stays optional until the sandbox is verified
  (`docs/release/sandbox-verification.md`).
- No merge, publish or app deployment: merging this runbook changes nothing in production.
