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
  answers 500, the job still shows `succeeded`. The pg_net counts are the only sign of that, and they cannot be tied to
  a job: pg_net records no job id. pg_net also keeps responses for 6 hours by default (`pg_net.ttl`), so "last 24 hours"
  usually covers less; the card shows the oldest response it counted. To see which endpoint fails, read the worker's
  own logs.
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

## Rollback

`docs/rollbacks/20261201100000_scheduled_jobs_health.down.sql` drops the function and nothing else (pg_cron, its jobs
and history are untouched). It refuses unless the function is exactly the definition the migration created (md5 of
`pg_get_functiondef`) with the same grants, and nothing else names it, and it needs
`SET app.confirm_scheduled_jobs_health_rollback = 'yes'`. After it, the card says the report is not available. Delete
the ledger row for `20261201100000` by hand afterwards.
