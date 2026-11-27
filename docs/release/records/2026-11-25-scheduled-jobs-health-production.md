# Release record: scheduled jobs health (#475) and flaky E2E fixes (#476), 2026-11-25/26

Owner approvals in the session:

- 2026-11-25, "merge 475 and 476": merge both PRs;
- 2026-11-25, "publish and apply" (to an explicit question naming the publish of main and the apply of `20261201100000` to
  the sandbox, then production): apply the migration, then publish.

This record holds hashes and counts only, no user data.

## What shipped

| PR   | What                                                                                                   | Merge commit | Production |
| ---- | ------------------------------------------------------------------------------------------------------ | ------------ | ---------- |
| #475 | Scheduled jobs card for superadmins: pg_cron jobs, last runs, flags, redacted failure messages         | `265ed88c`   | applied    |
| #476 | Flaky E2E: an alert opens without waiting for its read mark; a stale read no longer undoes a live join | `c6c9cf6e`   | no DB part |

`20261201100000_scheduled_jobs_health` adds one function, `public.superadmin_scheduled_jobs(integer)`: SECURITY DEFINER,
superadmin only (checked inside, `SUPERADMIN_ONLY` otherwise), executable by `authenticated` only, reads only pg_cron's
and pg_net's own tables, writes nothing, and never returns a job's command, user or database. SQL test 995 (54
assertions, 37 mutants all failing it), guarded rollback `docs/rollbacks/20261201100000_scheduled_jobs_health.down.sql`.
Design and limits: `docs/scheduled-jobs-health.md`.

## Local rehearsal

On a replay of main `c6c9cf6e` with the function dropped, the ledger-route script (one transaction, 5 s lock timeout,
ledger row with the file's text, raise unless its md5 equals the file's, run the stored text): applied; function md5
`373c82595845f90c62020f70c9f9427c` equal to the rollback guard; `anon` no, `authenticated` yes; a second run was refused
(the ledger row already exists).

## Sandbox (`qkukefvzwlyusvspablz`)

Applied 2026-11-25 about 17:40 UTC by the same script, after the other session's "go" (its #477 re-run was on the
sandbox; this change only adds a function).

| Step | Ledger | Latest version   | Objects (fp440) | Notes                                                                      |
| ---- | ------ | ---------------- | --------------- | -------------------------------------------------------------------------- |
| Pre  | 77     | `20261202100000` | 3535 `254a90ea` | the other session's `20261202100000` was already there; no pg_cron         |
| Post | 78     | `20261202100000` | 3536 `f8038d84` | the only object added is `public.superadmin_scheduled_jobs(_runs integer)` |

Ledger text md5 `d1bd3f04` equals the file; function md5 `373c8259` equals the rollback guard on the sandbox's Postgres
too.

## Production (`cpqihhcqeivbgxqbzatv`)

Applied 2026-11-25 about 17:45 UTC by the same script, after the other session confirmed nothing of its own was in flight
on production. No lock wait, no session idle in a transaction before or after.

| Step | Ledger | Latest version   | Objects (fp440) | Equal to a replay of           |
| ---- | ------ | ---------------- | --------------- | ------------------------------ |
| Pre  | 425    | `20261130110000` | 3512 `72a25370` | main before `20261201100000`   |
| Post | 426    | `20261201100000` | 3513 `80b7a637` | main `c6c9cf6e` (local replay) |

Ledger text md5 `d1bd3f0495b597b9d48767329ba52eb5` equals the file; function md5
`373c82595845f90c62020f70c9f9427c` equals the rollback guard; `anon` and `service_role` cannot execute it,
`authenticated` can; a call without a superadmin is refused with `SUPERADMIN_ONLY`. Production has pg_cron, 12 jobs, all
owned by the migration role, so the function sees all of them; the run-history read (newest 100,000 runs) took 0.2 s in a
read-only check on 2026-11-24.

## Publish

Main `be7dae7b` was published on 2026-11-26 at about 01:30 UTC, as Lovable deployment
`a7812bbf-2a06-41d8-ba0c-ee847b63578b`. The other session did this single publish, after its `20261202100000` was
applied to production.

- **Why it waited:** main moved on to `cb250b86` (#477) after the merges, and main's E2E for that commit (run 1421) was
  red after its one re-run. The causes were outside the new code: a fixture player left on a game's roster by an earlier
  failure, and a realtime catch-up gap that production already had. The other session's fix, #478 (`be7dae7b`), made
  main's E2E green (run 1423).
- **What it contains:** #475, #476, #477 and #478. Lovable's `latest_commit_sha` is `be7dae7b` and the project status is
  `ready`.
- **Production after the publish** (read-only check): ledger 427, latest `20261202100000`, and
  `superadmin_scheduled_jobs` md5 still `373c8259…`, so the live app's Scheduled jobs card has its function.

## Checks

- Local, per branch merged with main `4c726e17`: `tsc` clean; vitest all passed (5240 and 5233); lint, format and
  policy gates clean; full SQL suite 4737 and 4683 passed, 0 failed.
- CI on #475 (run 1413) green. CI on #476 (run 1414) green on its one re-run; the first attempt's single failure
  (`join-cross-device-roster`) passed 10/10 locally with and without the change and had failed the same way on main
  before (run 1332). Main E2E after both merges (run 1417, `c6c9cf6e`) green.
- #476's alert fix: with the read-mark save held 12 s on the local stack, the old handler failed
  `invite-pay-and-join` 3/3 with CI's error, the new one passed 3/3.

## Open

- A retention job for `cron.job_run_details` (about 260k rows, 348 MB, never purged) is being built as a separate change
  (`20261203100000`); its PR follows, and it is applied nowhere until the owner approves.
- The other session applied its `20261202100000` to production before the publish (ledger 426 → 427, fingerprint 3530
  `94ab49f1` equal to a replay of main); its own release record covers it.
