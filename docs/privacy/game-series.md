# WP 3.1: games that repeat

Status: **on branch `claude/lucid-franklin-bxb02r` (committed after WP 3.0), tested on scratch databases and applied to the
sandbox. Not merged, not published, not applied to production.** Migration `supabase/migrations/20261122100000_game_series.sql`
(md5 9f54875e); test `supabase/tests/930_game_series.test.sql` (50 assertions); rollback
`docs/rollbacks/20261122100000_game_series.down.sql`. It needs WP 3.0's migration (`20261121100000`) first.

## What was wrong

A weekly run had to be re-created by hand. "Multiple days" let a host pick several dates up front, and the app inserted one game
per date, but nothing kept a run going. `hosted_games.rrule` existed and was never used. The repeat picker in
`src/components/datetime/RecurrenceFields.tsx` was never mounted.

## What it does

- **Starting a series:** on the create page, a one-day game can be set to "Every week" or "Every 2 weeks", with an optional last
  date. Once the game is published, `game_series_start` makes it a series. The server creates the next dates up to 4 weeks
  ahead.
- **Keeping it going:** a daily job (pg_cron, `extend-game-series`, 04:17 UTC) adds the dates still missing.
  - Each new date copies the latest date in the series, so an edit to the latest date carries forward.
  - It keeps the same local time across daylight-saving changes, and it copies the payment settings.
  - It never copies players, requests, payments or a cancellation.
  - A date is never created twice.
- **The host is checked again** every time dates are created: not suspended, and either an adult (no team) or still owner,
  manager or coach of the team. Age and guardian locks are checked again by the insert triggers. If the host no longer qualifies,
  the series ends.
- **Ending:** a series also ends at its last date, or when no live date is left.
- **What people see:** the game page's date strip reads "Repeats every week · N dates". The host also gets "Stop repeating".
- **Stopping:** stopping ends the series and removes the "repeats" label from its dates. Dates already created stay. The host
  cancels any of them the usual way, which handles players, refunds and notices.
- **Unchanged:** "Multiple days" works as before. Cancelled dates are no longer offered in the date strip.

**Defaults chosen in this package, open to change:**

- weekly and every-2-weeks only;
- a 4-week window, at most 8 dates per run;
- new dates copy the latest date;
- stopping keeps the dates already created.

## Checked

- **Test 930:** 50/50, covering:
  - who may start or stop a series;
  - the dates created, all at the same local time and length;
  - payment settings copied and players not copied;
  - no duplicate dates;
  - edits carrying forward;
  - the refusals: not the host, past, cancelled, already in a series, a bad repeat option or last date;
  - every 2 weeks, and a last date;
  - the daylight-saving change on 14 March 2027;
  - a manager removed, a suspended host, and a 17-year-old under their own team;
  - stopping, and running out of live dates;
  - the daily run.
- **Full suites:** SQL 2908 passed, 0 failed. Unit 4364 passed, 0 failed (after one fix: the stop button now uses
  `bg-destructive-strong`). Typecheck and build pass, and the changed-file format, lint, policy and hooks checks are clean.
- **Rollback:** it refuses without its confirmation, then returns the catalog to the WP 3.0 state (0ba704e5).
- **Sandbox:**
  - The wrong-md5 control was refused, then the migration was applied (ledger 59). The sandbox equals the branch replay
    (89880df3), apart from the unrelated `_schema_import_requests` table.
  - The sandbox has no pg_cron, so the daily job is scheduled only where pg_cron exists, as in production.
  - At iPhone size, as e2e-host (an adult with no team), a weekly game was published: "Game published · repeats every week (3
    more dates added)".
  - The game page listed 4 Thursdays at 2:30 PM under "Repeats every week · 4 dates".
  - "Stop repeating" then confirming ended the series ("stopped_by_host"). All 4 dates stayed, with their payment settings, and
    none was still labelled as repeating.
  - The test data was removed. No request reached production.
