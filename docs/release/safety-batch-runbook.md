# Safety batch runbook: four held migrations to production

Prepared 2026-11-06. **Nothing in this file has been run against production.** Every step marked _approval_ needs
the owner's explicit approval at the time it is taken. Each approval and each check's output (catalog data and counts
only, never user data) goes in the release record.

Run this **after** the P0-1 runbook (`docs/release/p0-1-reconciliation-runbook.md`) steps B to D. The pre-check below
refuses to pass until P0-1's fixes are on production.

| Order | PR   | Migration                                         | What it does                                                                                                                      | App first? |
| ----- | ---- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1     | #300 | `20261106150000_close_authenticated_oracles`      | Closes two authenticated oracles. Roles can no longer be written through the API.                                                 | yes        |
| 2     | #314 | `20261106160000_refuse_under13_self_registration` | Refuses a self-set birthday under 13 in the database too. Existing rows are untouched.                                            | yes        |
| 3     | #330 | `20261106210000_youth_post_venue_privacy`         | A team's tryout or clinic venue is private until the team is known to be adult-only.                                              | yes        |
| 4     | #332 | `20261106200000_telemetry_age_gating`             | Minors' telemetry keeps no account id, user agent or free text. Signed-out rows keep no user agent. Existing rows are backfilled. | no         |

"App first" means the PR's app code must be deployed before its migration:

- #330's migration withdraws client `select *` on `team_posts`, which the old app relies on.
- #300 and #314 change what `profile_ages` and `set_my_birthday` return or accept, and each ships the matching app change.

Follow each PR's own stated deploy order if it is more specific. In practice:

1. merge the PR;
2. let Lovable deploy the app;
3. confirm the deployed build includes it;
4. then apply the migration.

#334 (an E2E spec fix stacked on #330) merges with #330 and has no migration.

## Steps

### A. Pre-check (read-only)

Run `docs/release/safety-batch-precheck.sql` through Lovable's database tool (paste the whole file). It runs one
`SELECT` inside `BEGIN READ ONLY … ROLLBACK`.

- **What passes looks like:** it returns 52 rows, and every row whose `expected` is not `(info)` must have `ok = true`.
- **What it confirms:**
  - P0-1 is in place.
  - Each object the batch replaces is exactly what `main` has, so each rollback restores today's state.
  - Each object it adds is absent.
  - Its prerequisites exist.
  - None of the four versions is recorded yet.
- **The `(info)` rows** are counts of what the batch will act on, kept for the record. For example, how many telemetry rows the
  backfill will clear, and how many tryout or clinic posts have a stored venue.

If any gating row fails, **stop** and find out why before applying anything.

### B. Apply, one PR at a time, in the order above _(approval each)_

For each PR:

1. merge it;
2. wait for the app deploy;
3. apply its migration file whole and unchanged through Lovable's migration tool;
4. confirm that the app still loads and signs in.

Stop at the first surprise.

### C. Verify (read-only)

Run `docs/release/safety-batch-verify.sql` the same way. It returns 38 rows, and every `ok` must be true. It checks:

- the md5 and grants of every function the batch touches;
- the three new triggers;
- that the role-write policy and privileges are gone;
- that the five venue columns are closed to clients while the other columns stay readable;
- that the telemetry backfill left nothing behind;
- the four ledger rows.

## Rollback

Each migration has a guarded rollback in `docs/rollbacks/` (the same file name with `.down.sql`). Each refuses to run
without its confirmation setting, and each was checked to refuse without it and to restore the previous state with it.

Roll back in reverse order. Roll back the app after the migration, the reverse of "app first".

The telemetry backfill (#332) cannot be undone: cleared values are not restored. That is the point of it.

## What was rehearsed (local, 2026-11-06, Postgres 16)

- **Pre-check on a replay of `main` at `a23932ac`:** every gating row passed, except the server major (16 locally, 17 on
  production).
- **The same replay with the four files applied in this order:** every file applied cleanly. 21 pre-check rows then
  failed: every replaced object, every added object, and the ledger, which is the negative control.
- **Verify:** all 38 rows passed on the applied replay; 30 failed on a fresh replay of `main`.
- **E2E sandbox:** each migration is already applied to the E2E sandbox (`qkukefvzwlyusvspablz`) and recorded in its
  ledger. Its own SQL test in `supabase/tests` passes.

## What this runbook does not authorize

- applying anything to production without the owner's approval for that step;
- the other held PRs (#315, #317, #343, #344, #345): they are features, not safety fixes, and each needs its own decision.
