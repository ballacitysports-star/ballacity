# Scheduled jobs health

The **Scheduled jobs** card on the SuperAdmin Overview tab shows the database's pg_cron jobs and how their last runs went,
so a failing sweep is seen without anyone querying the database. It reads one function,
`public.superadmin_scheduled_jobs(_runs)` (migration `20261201100000_scheduled_jobs_health.sql`), which checks the
superadmin role itself and changes nothing.

## What it shows

One row per job, in name order:

- the job name and its cron schedule (UTC);
- the time and status of the latest run (`succeeded`, `failed`, `running`, ...);
- how many runs failed in the last 7 days, and the last successful run when the latest one did not succeed;
- flags, and a warning style on the row when any is set:
  - **Last run failed**;
  - **No run in 25 h**: every job runs at least daily, so a job that has not started in 25 hours is stuck or unscheduled;
  - **Never ran**: no run is recorded (in the newest 100,000 run records);
  - **Paused**: the job is set inactive;
- on request, the last 5 runs with start time and duration, and for a failed run, on request, its message.

Below the list: counts of pg_net responses in the last 24 hours by status class (2xx, 3xx, 4xx, 5xx, no response).

When the database has no pg_cron (the E2E sandbox and the CI replay database have none), the card says
"Scheduled jobs are not available on this database". It says the same, with a different reason, when pg_cron's tables
cannot be read, or when the migration is not applied yet.

## What it never shows

- A job's **command**. Jobs that call worker endpoints go through `private_sec.worker_post`, and a command can carry an
  endpoint URL, so the function never selects it.
- The job's database user, database name, node name or port, and the run's command.
- A succeeded run's message (the function returns a message for failed runs only, and the app drops any other).
- A failed run's message as written. pg_cron saves libpq's whole error text, and its `DETAIL` (`Failing row contains
  (...)`, `Key (col)=(value) already exists`), `HINT`, `QUERY` and `CONTEXT` (`SQL statement "..."`) lines carry row
  values. So before the message leaves the database, only the primary error is kept: everything from the first line that
  starts with an upper-case label and a colon, or from `DETAIL:`, `HINT:`, `QUERY:`, `CONTEXT:` or `LINE n:` anywhere, is
  dropped. Then whitespace is collapsed; URLs, UUIDs, email addresses, everything after a `(column)=(` key detail,
  double-quoted literals (a quoted name right after column, relation, table, constraint, index, schema, function, type,
  sequence, view, trigger, extension, policy, operator, domain or role is kept), single-quoted literals, tokens of 32 or
  more characters and numbers of 6 or more digits (phone numbers and dates included) are replaced by `[url]`, `[id]`,
  `[email]`, `([value])`, `"[value]"`, `'[value]'`, `[token]` and `[number]`; and it is cut to 200 characters. Free text
  that a job's own `RAISE` writes into its primary message (a name without quotes, say) is not recognised, so a job's
  function should not put personal data in its error messages.
- pg_net request URLs, headers or bodies: counts only.
- Anything from an app table.

`supabase/tests/995_scheduled_jobs_health.test.sql` checks each of these against stand-in tables shaped like pg_cron's
and pg_net's.

## Known limits

- **A worker job's "succeeded" means the call was sent.** `flush-held-notifications`, `send-game-reminders` and the
  other jobs that call `private_sec.worker_post` queue an HTTP request through pg_net and finish. If the endpoint then
  answers 500, the job still shows `succeeded`. On this card the pg_net counts are the only sign of that, and they
  cannot be tied to a job: pg_net records no job id. pg_net also keeps responses for 6 hours by default
  (`pg_net.ttl`), so "last 24 hours" usually covers less; the card shows the oldest response it counted. To see which
  endpoint fails, open the **error view** (below).

## Worker failures in the error view

Each worker endpoint files its own 5xx answers in `app_error_events`, so they show in the superadmin error view (the
Errors tab; "Server only" keeps them) next to pages and server functions that failed. That covers
`/api/public/reminders/run`, `/api/public/notifications/flush`, `/api/public/payments/release-holds` and
`/api/public/reels/process` (`src/lib/worker-failure-report.server.ts`, which wraps each route's handler).

- **What is filed.** One row for each answer of 500 or above, whether the sweep failed and the route answered 500 or the
  handler threw (it then answers `{ "error": "worker_failed" }` with status 500, and the request middleware does not
  file it again). The message is `<job>: <error>`: `<job>` is `send-game-reminders`, `flush-held-notifications`,
  `release-expired-payment-holds` or `process-highlight-reels`, and `<error>` is the `error` field of the answer (for
  reels, the code it answers, such as `queue_read_failed`), what the handler threw, or `http_<status>` when the answer
  has no error field. The route is the endpoint's path. The kind is `ssr`, the kind the server already uses for a
  request that failed. No pg_cron job calls `/api/public/payments/release-holds` (the `release-expired-payment-holds`
  job runs the same sweep in SQL); a row under that route comes from an external scheduler.
- **What is not filed.** Answers below 500: a run that worked, and a 401 for a missing or wrong worker secret. An abort,
  as everywhere else. Per-item failures that the endpoint counts in a 200 answer (a push that failed, a reel that
  failed) are not rows either; they stay in `notification_delivery_log` and on the reel.
- **What a row holds.** The error view's usual scrubbing applies: emails, tokens, ids, long numbers and the values
  Postgres repeats in its errors are removed, and the message is cut to 500 characters. Nothing else of the answer
  (its counts or results) and nothing of the request (body, headers, the worker secret, the query string) goes in, and
  the row counts as signed out.
- **Limits.** Reporting is best effort: it waits at most 1.5 seconds for the row to be saved, then answers anyway, and
  a failure to save changes nothing in the answer. Rows count against the same per-minute budget as the server's other
  reports (60 a minute on each server instance). A failure that keeps happening (the reels endpoint runs every minute)
  shows as one group with a count, not one line per run. A sweep that pg_net stops waiting for (after 5 seconds) can be
  cancelled before it answers, and then nothing is filed; the pg_net "no response" count still shows it.
- **Jobs the function's owner can see.** On Supabase, `cron.job` and `cron.job_run_details` have row level security
  (`username = current_user`). The function runs as its owner, the role that applies migrations, which is the role that
  scheduled every job in `supabase/migrations`. A job scheduled by hand as another role would not be listed.
- **History window.** Runs are read from the newest 100,000 rows of `cron.job_run_details` (a primary-key range, so the
  card stays cheap however much history pg_cron keeps). That is weeks of runs at the current rate; a job whose last run
  is older reads as "Never ran", which is flagged anyway.
- **Runs that never started.** pg_cron leaves `start_time` empty when it could not connect (`connection failed`) or the
  job did not start in time (`job startup timeout`); such a run is timed by its `end_time`. A run marked
  `server restarted` while still starting has neither time: it counts in "failed in 7 days" when the newest time among
  the runs recorded before it is within the 7 days, and it gives no "last run" time.
- At most 200 jobs are listed.

## Run history retention

pg_cron writes a row to `cron.job_run_details` for every run and deletes none. Production had about 260,000 rows
(348 MB), most from `process-highlight-reels`, which runs every minute; all jobs together add about 2,000 rows a day.
Migration `20261203100000_cron_run_history_retention.sql` keeps **30 days**:

- **The job.** `purge-cron-run-history` runs daily at **03:57 UTC** (a free minute: the other daily jobs run at 03:17,
  03:37, 04:17, 04:41, 04:47, 04:51 and 08:47) and calls `private_sec.purge_cron_run_details()`. It is scheduled only
  where pg_cron is installed; elsewhere the migration says so in a notice and schedules nothing.
- **What goes.** Finished runs (`succeeded` or `failed`) whose time is older than 30 days. A run's time is its
  `end_time`, or its `start_time` when it has no end time (a run that could not connect has only an end time). Runs in
  progress (`starting`, `connecting`, `sending`, `running`) and runs with neither time are never deleted.
- **The card is covered.** The card counts failures over 7 days and reads the newest 100,000 runs (about 7 weeks at
  today's rate). Whatever window is passed, the function keeps at least **14 days** (and at most 365), so the 7 days
  always have a week of margin. A paused job whose last run is older than 30 days loses its history and reads as
  "Never ran" as well as "Paused".
- **Batches.** One call deletes at most 20,000 rows (oldest first, along the primary key), so each run is one short
  transaction. It returns `deleted`, `remaining_older` (deletable rows still older than the cut-off) and `cutoff`. The
  first runs drain the existing backlog over several nights (about 200,000 rows in production, so about 10 nights); a
  person can also run `SELECT private_sec.purge_cron_run_details();` by hand, as the migration role, until
  `remaining_older` is 0.
- **Disk space.** Deleted rows free space inside the table, which autovacuum makes available for new runs; the file does
  not shrink back, so the 348 MB stays allocated but stops growing. Only `VACUUM FULL cron.job_run_details` would return
  it to the operating system, and that locks the table (pg_cron cannot record runs meanwhile); it is not part of this.
- **Who can run it.** Nobody through the API: EXECUTE is revoked from PUBLIC, `anon`, `authenticated` and
  `service_role`. The job runs it as the migration role. On Supabase, `cron.job_run_details` has row level security
  (`username = current_user`), so it deletes the runs of jobs that role scheduled, which are all the jobs in
  `supabase/migrations`; runs of a job scheduled by hand as another role stay.
- **Deleted history cannot be restored.** A failure older than 30 days can no longer be looked up in the database.

`supabase/tests/997_cron_run_history_retention.test.sql` checks these against stand-in tables shaped like pg_cron's,
including that the card still counts the last 7 days' failures after a purge. The rollback,
`docs/rollbacks/20261203100000_cron_run_history_retention.down.sql`, unschedules the job and drops both functions; it
refuses unless both functions are exactly the definitions the migration created and it is confirmed with
`SET app.confirm_cron_run_history_retention_rollback = 'yes'`. Rows already deleted stay deleted.

## Rollback

`docs/rollbacks/20261201100000_scheduled_jobs_health.down.sql` drops the function and nothing else (pg_cron, its jobs
and history are untouched). It refuses unless the function is exactly the definition the migration created (md5 of
`pg_get_functiondef`) with the same grants, and nothing else names it, and it needs
`SET app.confirm_scheduled_jobs_health_rollback = 'yes'`. After it, the card says the report is not available. Delete
the ledger row for `20261201100000` by hand afterwards.
