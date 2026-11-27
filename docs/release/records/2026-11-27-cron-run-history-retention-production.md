# Release record: pg_cron run history kept for 30 days (#481), 2026-11-27

Owner approval in the session: 2026-11-27, "Approve all", given in answer to an explicit question naming the merge of #480
and #481 and the apply of `20261203100000` to the sandbox, then production, with its consequences: the first deletion at
the next 03:57 UTC, deleted run history cannot be restored, and the backlog drains over about 10 nights.

This record holds hashes and counts only, no user data.

## What shipped

| PR   | What                                                                                           | Merge commit | Production |
| ---- | ---------------------------------------------------------------------------------------------- | ------------ | ---------- |
| #480 | Release record for #475 and #476 (docs only)                                                   | `3b79fdc5`   | no DB part |
| #481 | `purge-cron-run-history`: daily at 03:57 UTC, deletes finished pg_cron runs older than 30 days | `828d15f9`   | applied    |

`20261203100000_cron_run_history_retention` adds two functions and schedules one job:

- `private_sec.purge_cron_run_details(_keep_days integer DEFAULT 30, _batch integer DEFAULT 20000)`: SECURITY DEFINER,
  empty `search_path`, `lock_timeout` 5 s. It deletes only finished runs (`succeeded` or `failed`) whose
  `coalesce(end_time, start_time)` is older than the cut-off, at most one batch per call, oldest `runid` first. The
  window is held to 14–365 days and the batch to 1–100,000.
- `private_sec.schedule_cron_run_history_purge()`: schedules `purge-cron-run-history` at `57 3 * * *`; a notice and
  nothing else where pg_cron is missing.
- EXECUTE on both is revoked from PUBLIC, `anon`, `authenticated` and `service_role`.

SQL test 997 (47 assertions, 21 mutants all failing it), guarded rollback
`docs/rollbacks/20261203100000_cron_run_history_retention.down.sql`. Design and limits: "Run history retention" in
`docs/scheduled-jobs-health.md`.

No app change, so no publish.

## Local rehearsal

On a replay of main `37669fb1` with a stand-in ledger at 427 rows, the ledger-route script (one transaction, 5 s lock
timeout, ledger row with the file's text, raise unless its md5 equals the file's, run the stored text):

- the same script with a wrong md5 was refused, and nothing changed;
- the real script applied: ledger 428, fingerprint 3530 `94ab49f1` → 3532 `fd79e8e9`;
- function md5s `e067f387979e2d09d34d7820224c0098` (purge) and `beb7e03e3874ed8337297d7875b8440a` (scheduler), equal to
  the rollback guard;
- a second run was refused (the ledger row already exists).

## Sandbox (`qkukefvzwlyusvspablz`)

Applied 2026-11-27 about 00:35 UTC, after the other session confirmed nothing of its own was in flight. The sandbox has
no pg_cron, so only the two functions were added and nothing was scheduled or deleted.

| Step            | Ledger | Latest version   | Objects (fp440) | Notes                                      |
| --------------- | ------ | ---------------- | --------------- | ------------------------------------------ |
| Pre             | 78     | `20261202100000` | 3536 `f8038d84` | no idle transactions                       |
| Wrong-md5 check | 78     | `20261202100000` | —               | refused: `ledger text md5 is not 000…`     |
| Post            | 79     | `20261203100000` | 3538 `904ec42f` | only the two `private_sec` functions added |

The sandbox's fp440 counts are 6 higher than a replay's because they include the sandbox-only
`public._schema_import_requests` table and its columns and constraints; the other session's fingerprint query leaves
those out, so its sandbox numbers (3532 before its own apply) are not comparable with these.

On the sandbox's Postgres 17.11 the function md5s equal the rollback guard, the ledger text md5 is
`09cce4c9397da8f3c3fdde1fd18962ed` (the file's), EXECUTE is held by the owner only, and the purge answers
`{"available": false, "reason": "not_installed"}`.

## Main's E2E before production

Main's E2E for `828d15f9` (run 1429) failed one test on its first attempt: `join-cross-device-roster`, waiting 20 s for
the "Join game" button on a page whose roster read said the account was not joined. The sandbox's g1 was in a clean
state afterwards (open, a day out, 0 of 10 joined). The other session read the sandbox logs: PostgREST could not get a
connection from its pool (`PGRST003`, 504s for that page's reads, one request queued 66 s), after a lock wait on
`realtime.subscription` and two statement timeouts. The same signature caused run 1421's and #479's first failures, so
it is sandbox capacity, not this change (which adds two functions nothing in the app calls). The one re-run was green
(282 passed, smoke 30/30). The other session is raising the sandbox's capacity with its owner.

## Production (`cpqihhcqeivbgxqbzatv`)

Applied 2026-11-27 about 01:26 UTC by the same script, after main's E2E was green and the other session confirmed
nothing of its own was in flight.

| Step            | Ledger | Latest version   | Objects (fp440) | Equal to a replay of           |
| --------------- | ------ | ---------------- | --------------- | ------------------------------ |
| Pre             | 427    | `20261202100000` | 3530 `94ab49f1` | main before `20261203100000`   |
| Wrong-md5 check | 427    | `20261202100000` | —               | refused, nothing changed       |
| Post            | 428    | `20261203100000` | 3532 `fd79e8e9` | main `828d15f9` (local replay) |

- Ledger text md5 `09cce4c9397da8f3c3fdde1fd18962ed`, equal to the file.
- Function md5s on production's Postgres 17.6: `e067f387…` and `beb7e03e…`, equal to the rollback guard (its header asked
  for this check after applying).
- `anon`, `authenticated` and `service_role` cannot execute either function; `postgres` can.
- One new job, `purge-cron-run-history` (job id 14), `57 3 * * *`, command `SELECT private_sec.purge_cron_run_details()`,
  owner `postgres`, active. 13 jobs in all.
- No session idle in a transaction and no lock waits after the apply.
- Before the first run: 264,739 rows in `cron.job_run_details`; 201,943 finished runs older than 30 days.

## First run

Checked read-only on production at 04:06 UTC.

- `purge-cron-run-history` (job id 14) ran once, at 03:57:00 UTC: status `succeeded`, return message `1 row`, 7.8 s.
- It deleted exactly one batch, 20,000 rows:
  - 264,739 rows at 01:26 plus 261 runs since makes 265,000;
  - 245,000 are left;
  - the lowest `runid` left is 20,001.
- Finished runs older than 30 days: 182,189 are left against that run's cut-off (201,943 at 00:32).
- No run is unfinished, and no run failed in the last 7 days.
- Autovacuum ran on the table at 03:57:33 and left no dead rows, so the freed space is ready for new runs. As expected,
  the table did not shrink (351 MB).
- The other 12 jobs' last runs all `succeeded`, including those after 03:57: `process-highlight-reels` and the three
  five-minute workers at 04:05–04:06.
- No session idle in a transaction and no lock waits.

**Backlog estimate, corrected:** about 2,300 new runs a day reach the 30-day mark, so the backlog falls by about 17,700 a
night, not 20,000. The 182,189 left take about 10 more nights, until about 2026-12-07. Then each night deletes only
that day's runs. The PR's "about 10 nights" was for the whole backlog and was slightly low: it is about 11 in all.

## Rollback

`docs/rollbacks/20261203100000_cron_run_history_retention.down.sql` unschedules the job and drops both functions. It
refuses unless `app.confirm_cron_run_history_retention_rollback = 'yes'` is set and both functions, their grants and the
job are exactly as this migration created them. Rows already deleted stay deleted. After a rollback, the ledger row for
`20261203100000` must be deleted by hand.

## Checks

- #481, local: `tsc` clean; vitest 5319 passed; lint, format and policy gates clean; full SQL suite 4978 passed, 0
  failed.
- CI on #481 (run 1427) and on #480 (run 1426) green; main after both merges green on run 1429's re-run.
