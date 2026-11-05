# Production runbook: hotfixes #286 and #287

Prepared 2026-11-05, revised the same day for the owner's channel: production SQL runs **only through Lovable**.
**Nothing in this file has been run against production.** Each step marked _approval_ needs the owner's explicit
approval at the time it is taken, and is recorded (who, when, output). Every database step is either a read-only check or
one reviewed file applied whole, and each was rehearsed on replays of `main` (section 8).

| Step | What                                                                         | Touches                                         | Approval |
| ---- | ---------------------------------------------------------------------------- | ----------------------------------------------- | -------- |
| A    | #286 dependency patch: merged (`9a400a9c`); check the preview, publish        | the app build                                   | yes      |
| B    | #287 database: pre-check, apply the migration through Lovable, verify         | production database: one migration              | yes      |
| C    | #287 app: merge, publish, right after B                                       | the app build                                   | yes      |
| D    | Afterwards: read-only checks, held reviews decided                            | nothing (reads); superadmin moderation          | no       |

## 1. Order, and why

- **#286 and #287 are independent.** #286 changes only `package.json` and `bun.lock`; #287 adds one migration, changes
  one server function (`submitReview`) and adds a database test. Shipping them in separate publishes keeps each
  regression attributable and each rollback simple. A first is the smaller change.
- **#287: database first, app second.** The published (old) build keeps working on the new database; the only
  difference is that every non-gym review it saves stays hidden until it is released or a superadmin unhides it. That
  fails closed: nothing unscreened is published. Rehearsed in section 8.
  The other order is unsafe. The new build relies on the database hold: it no longer flags a review the AI screening
  sent for human review. On the old database, such a review would be published at once, and every submission would
  also report an error, because `release_review_screening` would not exist yet.
- **Merge #287 only after B passed.** Lovable's preview builds from `main`. Unless the project has a separate test
  backend, the preview uses the production database, so a merge before B runs the unsafe combination on the preview.
- Merging to `main` applies no SQL and publishes nothing: Lovable syncs `main`, migrations are applied separately,
  publishing is a separate action (`docs/release/youth-privacy-release-runbook.md`).

## 2. Before any step

- **Checks.** GitHub Actions has assigned no runners in this repository since 2026-11-05, about 14:26 UTC. The owner
  decided to go ahead on local evidence: the four required checks, run locally on each PR head exactly as the
  workflows run them (section 8). Merges stay the owner's decision.
- No other merges to `main` and no Lovable agent edits during the window. Lovable's bot commits to `main` (attributed
  to the owner), so look at the `main` head before each merge.
- Know where to look: Lovable (preview URL, publish, version history, migration approvals) and the app's error logs.
- Keep a release record: the approvals, the checks' output (catalog data and ledger hashes only, never user data),
  and each published commit and time.

## 3. Step A: #286 (app only)

1. **Merged** on 2026-11-05 with the owner's approval: merge commit `9a400a9c` on `main`. Its four required checks had
   passed on `ab974b45` before the Actions outage. Lovable syncs `main` and rebuilds the preview; production is
   unchanged until you publish.
2. **Note what is live.** Record the published build (commit) to roll back to. Run the three requests below against
   the published site and keep the output.
3. **Compare the preview with the published site.** Run the same three read-only requests against the preview. Each
   must give the same status line and `WWW-Authenticate` header as on the published site. These requests carry no
   credentials and change nothing. The answers to expect, from the `@lovable.dev/mcp-js` handlers:
   - 200 for the resource metadata;
   - 401 with a `WWW-Authenticate: Bearer` header for both `/mcp` and `/.mcp/list-tools`, which authorize before
     anything else.

   ```sh
   SITE=https://<published or preview host>
   curl -s -o /dev/null -w '%{http_code}\n' "$SITE/.well-known/oauth-protected-resource"
   curl -s -D - -o /dev/null -X POST "$SITE/mcp" -H 'content-type: application/json' \
     -H 'accept: application/json, text/event-stream' \
     --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
     | grep -i -E '^HTTP|^www-authenticate'
   curl -s -D - -o /dev/null "$SITE/.mcp/list-tools" | grep -i -E '^HTTP|^www-authenticate'
   ```

   Then sign in on the preview and open pages that load through server functions: the games list, a game, your
   profile, a team page. No error screen and no errors in the browser console. Do not submit forms: the preview may
   write to the production database.
4. **Publish** _approval_. Record the commit and time. Repeat step 3 against the published site, and watch the error
   logs for 30 minutes.

**Rollback A.** Publish the previous build: revert the #286 merge commit on `main` (the PR's Revert button opens a
revert PR), merge it, and publish. No database state is involved, so publishing the old build completes the rollback. It
re-opens the advisories #286 patches (seroval, zod, the MCP SDK), so use it only for a regression that blocks users.

## 4. Step B: #287 database, through Lovable _approval_

### B0. How Lovable applies and records a migration

Lovable's migration tool runs the SQL it is given and stores the SHA-256 of that exact text in
`drizzle.__drizzle_migrations`. It writes no `supabase_migrations` row (`docs/supabase-cli.md`; checked against
production on 2026-10-20). So the text must reach production **unchanged**:

- The verification below recognizes the hotfix by that hash. So does the release preflight (#294, commit `c6a8ae50`):
  - `843e356b69c732ba0f335447e920b5f954029bada2d6c7c85d0a97f0fe13a6c1`, the file;
  - `ef17f8dd6b530f1a04a5dc700299e9759d50da930abdbe9609afcd1e5f971089`, the file without its final newline.
- Any other text fails both, by design. Lovable has applied comment-stripped function bodies before
  (`docs/release/pg17-production-catalog-check.md`, on the release branch), so do not let it "tidy" the SQL.

The read-only checks below run through Lovable's database tool (the connector Claude uses), which executes whatever SQL
it is sent. Only the `SELECT` statement between `BEGIN READ ONLY;` and `ROLLBACK;` of each check file is sent, and
nothing else. Each is one statement that reads catalogs and ledger hashes only.

### B1. Backup point

If your Lovable project shows backups, note the latest one and its time in UTC. The rollback in section 7 does not
need a backup. Restoring one would discard every change made since, so it is a separate decision, never part of this
runbook.

### B2. The reviewed text

The text to apply is `supabase/migrations/20261031120000_close_live_write_holes.sql` exactly as it is at the approved
#287 head: 244 lines, sha256 `843e356b…a6c1`. It starts with `-- Hotfix: close four write paths that are live in
production` and ends with `FOR EACH ROW EXECUTE FUNCTION public.guard_report_moderation_update();`.

### B3. Pre-check (read-only)

Claude runs the statement in `docs/release/hotfix-287-precheck.sql` through the connector, with your go-ahead. It
returns 26 rows, and every `ok` must be true. It confirms:

- the server is Postgres 17;
- none of the hotfix's objects exist yet, including an early draft of `release_review_screening`;
- neither ledger records it yet (no ledger row, no drizzle row with either hash);
- the two review policies the hotfix replaces are exactly `main`'s, so the rollback restores this state;
- the triggers on `team_members`, `payment_submissions`, `reviews` and `user_reports` are `main`'s; the new triggers
  rely on their name order. `payment_submissions` may lack `aa_payment_destination_trg`: it comes with release
  migration `20261103140000` (#250), merged but not yet applied in production. The new `a00_` trigger sorts first
  either way;
- the prerequisites exist: `private_sec`, `auth.uid()`, the API roles and the `admin_audit_log` columns.

If any row is false, stop. The rows hold catalog data only, so they can be shared.

### B4. Apply through Lovable

Pick a quiet time. Applying takes seconds; queries on the four tables can wait briefly for its locks. Two ways:

**Option 1 (recommended): Claude sends it, you approve.**
1. With your go-ahead to apply, Claude sends the file's exact bytes to Lovable's agent through the connector, with the
   message below. Copying by hand can lose or change characters; this cannot.
2. Lovable normally pauses for approval before changing the database. Claude then compares the SQL it proposes with the
   file, by sha256, and shows you the result.
3. Approve only if they are identical. Claude passes your decision on.

If your Lovable settings apply migrations without asking, the go-ahead in step 1 is the approval to apply.

**Option 2: you paste it yourself.** Open the file at the approved commit, copy it whole, and send it in Lovable's chat
with the message below. On the approval card, check that it shows the whole file, from its first line to its last
(B2), before approving.

The message:

> Apply the following SQL to the database as one migration, exactly as written. Do not edit, reformat, reorder,
> shorten or split it, and keep every comment. Make no code changes and create no files. Reply only "applied" or the
> exact error.
>
> ` ```sql ` … the whole file … ` ``` `

Afterwards, look at `main`: if Lovable committed anything for this, tell Claude before any other merge. That could be a
types file, or a copy of the migration under `drizzle/migrations` or `supabase/migrations`. A copy would be replayed in
the middle of the release chain.

### B5. Verify (read-only)

Claude runs the statement in `docs/release/hotfix-287-verify.sql` through the connector. It returns 21 rows, and every
`ok` must be true. It checks:

- each of the eight functions' definitions by hash, compared with a Postgres 17 replay;
- both new policies;
- that the four triggers are enabled and call the right functions;
- that `release_review_screening` is executable by `service_role` and not by `anon` or `authenticated`;
- that the hold table cannot be read through the API roles;
- that the reviewed text is recorded. The row's name says where: "(drizzle ledger, Lovable)".

If a row is false, do not merge #287:

- **A definition differs:** Lovable changed the text. Production runs 17.6 and the hashes come from 17.11. The release
  branch's PG17 catalog check found no difference between them for 17 functions, so a difference needs a look at the
  deployed definition, not a guess.
- **The record row reads "no ledger row and no drizzle row with the file hash":** the text that ran was not the file.

From the end of B4 until C2, the published build keeps every new non-gym review hidden. Have step C ready before you
start B4.

### Alternative: a direct `postgres` connection

If you ever have one (Supabase connection string, `postgres` role, session-mode port 5432), the same steps run with psql
from a clean checkout of the approved head:

```sh
export PGHOST=db.<project-ref>.supabase.co PGPORT=5432 PGUSER=postgres PGDATABASE=postgres PGSSLMODE=require
sha256sum supabase/migrations/20261031120000_close_live_write_holes.sql   # 843e356b…a6c1
psql -X -v ON_ERROR_STOP=1 -f docs/release/hotfix-287-precheck.sql         # 26 rows, all ok
psql -X -f docs/release/hotfix-287-apply.psql                              # ends with COMMIT
psql -X -v ON_ERROR_STOP=1 -f docs/release/hotfix-287-verify.sql           # 21 rows, all ok
```

`hotfix-287-apply.psql` refuses any other text (sha256), applies the file and the release-template ledger row in one
transaction with a 5-second lock timeout, and reloads the API schema cache. It refuses, with exit code 3 and nothing
applied, if the ledger already has the version. On a first apply it prints five expected "does not exist, skipping"
notices.

## 5. Step C: #287 app

1. **Merge #287** _approval_ (merge commit), only after B5 passed. Lovable syncs `main` and rebuilds the preview.
2. **Publish** _approval_. Record the commit and time.
3. **Count held reviews** (read-only, counts only): Claude runs the statement in
   `docs/release/hotfix-287-held-reviews.sql` through the connector. `held_for_screening` at this point is the reviews
   written during the B4 to C2 gap, plus any the AI sent for human review. Note the number.

## 6. Step D: afterwards

1. **Decide the held reviews.** A superadmin opens Superadmin, Moderation, Reviews, "hidden only", reads each held
   review and unhides the ones that are fine. Authors of reviews written during the gap were told their review was
   posted, so do this the same day.
2. **Watch the release path.** Re-run the held-reviews count a few hours later, and again the next day. It should grow
   only with reviews the AI sends for human review. If it grows with every new review, the server is not releasing
   them, and authors see "Your review was saved but could not be published yet.":
   - check the published build is #287's;
   - check the server has its service-role key;
   - check the server log for the `release_review_screening` error. If the API does not know the function yet, ask
     Lovable to reload the API schema cache (`NOTIFY pgrst, 'reload schema';`).

   This fails closed (reviews stay hidden), so fix it forward. Do not roll back for it.
3. **Re-run the verification the next day** (B5, all `ok`). That catches a later tool or agent overwriting a
   definition.
4. When the privacy release is prepared, its preflight recognizes this hotfix by its drizzle hash (#294) and reports
   that in a warning.

## 7. Rollback

Prefer a forward fix: a new reviewed migration that keeps the protection. A rollback re-opens a live hole, so it needs
the owner's approval at the time, and only the part that misbehaves is undone. The four parts are independent.

| Symptom                                                                   | Part | First response                                                                                                                                                          |
| ------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A roster change fails with `MEMBER_IDENTITY_FIXED`                        | 1    | Only moving a row to another person or team is refused. The app edits role, number and position, and those still work. Send the screen and error: likely a forward fix. |
| A payment action fails with a `refund_*` error                            | 2    | The app never writes `refund_*` from the browser. The refund engine and the service role are unaffected. Send the error.                                                |
| New reviews stay hidden (D2)                                              | 3    | Fix forward (D2). If the #287 build itself must go, publish the previous build. It is safe on the new database: reviews stay hidden until a superadmin unhides them.     |
| A moderator's report change fails with `REPORT_FIELDS_FIXED`              | 4    | The app's moderation tools use the server path and are unaffected; only a direct API edit of a report is. Send the error.                                                |

**Through Lovable.** Each part is one file in `docs/rollbacks/20261031120000_lovable/` that holds a single statement,
so it applies whole or not at all however Lovable runs it:

| Part | File                                  |
| ---- | ------------------------------------- |
| 1    | `part1_roster_identity_lock.sql`      |
| 2    | `part2_refund_field_lock.sql`         |
| 3    | `part3_review_screening_hold.sql`     |
| 4    | `part4_report_guard.sql`              |

- Send the file for that part to Lovable's agent unchanged, the same way as B4: the same message, Option 1 or 2.
- To undo several parts, send their files one after another.
- Each file ends by checking that its objects are gone.

Then:

- **Part 3: publish the previous app build first.** The #287 build relies on the hold; without it, reviews the AI
  sends for human review would be published. The previous build works on either database state. Reviews held at that
  moment stay hidden: a notice gives their number, and superadmins decide them in Moderation.
- Afterwards, run the verification (B5). The rolled-back part's rows read `missing`, or show `main`'s policy hashes for
  part 3; the other parts' rows stay `ok`.
- The drizzle rows stay. The release preflight then refuses the target until a reviewed forward fix restores a
  recognized state. The rollback's own drizzle row is unknown to it, which is intended.
- App rollback for #287 alone (publish the previous build) never requires a database rollback.

**With psql**, if a direct connection exists: `docs/rollbacks/20261031120000_close_live_write_holes.down.sql`, with
`PGOPTIONS="-c app.confirm_reopen_live_write_holes=yes"` and `-v parts=all` or a comma list such as `-v parts=3`, run
with `--single-transaction`. It refuses without the confirmation or a valid `parts`.

## 8. What was rehearsed and checked (local, 2026-11-05)

Fresh replays of `main` on PostgreSQL 17.11 and 16.15, each with production-shaped ledgers:

- `supabase_migrations.schema_migrations`: `version` primary key, `statements text[]`, `name`;
- `drizzle.__drizzle_migrations`: `id`, `hash`, `created_at`.

Lovable's tool was emulated by running the file in one transaction and recording the sha256 of its text in
`drizzle.__drizzle_migrations`. The rehearsal scripts are session tools, not in the repository:
`/tmp/claude-0/-home-user-ballacity/6077ac3f-6266-5ad6-b242-855a0f5d2664/scratchpad/tools/hf287_lovable_rehearse.sh`
and `/tmp/claude-0/-home-user-ballacity/6077ac3f-6266-5ad6-b242-855a0f5d2664/scratchpad/tools/hf287_rehearse.sh`.

| Check (Lovable path)                                                          | PG17                                                                                                      | PG16                                          |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Pre-check on `main`, run as the bare `SELECT` (as through the connector)       | 26/26 ok                                                                                                  | 25/26 (server major: by design, production is 17) |
| Apply as Lovable does (drizzle hash `843e356b…`), then verify (bare `SELECT`)  | 21/21 ok; the record row reads "(drizzle ledger, Lovable)"                                                | 20/21 (server major); same record row          |
| Verify when the drizzle hash is of the text without its final newline          | 21/21 ok                                                                                                  | 20/21 (server major)                           |
| Held-reviews count (bare `SELECT`)                                            | runs; 0, 0, 0 on a replay                                                                                 | same                                          |
| Pre-check after the apply                                                     | its 20 "not yet" and "as on main" rows fail, as they must                                                 | the same 20, plus the server major             |
| Each Lovable rollback file alone, run without a transaction wrapper           | only that part removed; the file applied again gives `main` + #287 exactly                                | same                                          |
| All four Lovable rollback files                                               | catalog identical to `main`                                                                               | same                                          |
| A comment-stripped text applied instead                                       | caught: 3 function hashes differ; the record row reads "no ledger row and no drizzle row with the file hash" | same                                          |

The direct-connection path, from the first version of this runbook, gave these results:

| Check                                                                       | PG17                                       | PG16                                                    |
| --------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| Pre-check on `main`                                                         | 26/26 ok                                   | 25/26 (server major is 16: by design, production is 17) |
| Apply with a one-byte-altered migration file                                | refused, exit 3, nothing applied           | same                                                    |
| Apply, then verify                                                          | `COMMIT`; 21/21 ok                         | `COMMIT`; 20/21 (server major)                          |
| Apply again                                                                 | refused (duplicate ledger key), unchanged  | same                                                    |
| Rollback without confirmation; without `parts`; `5`; `all,3`; `1;DROP`      | each refused, exit 3, unchanged            | same                                                    |
| Rollback of each part alone; the file re-run after each                     | only that part removed; then `main` + #287 | same                                                    |
| Rollbacks `1`, then `2`, then `3,4`; rollback `all`                         | catalog identical to `main`                | same                                                    |

"Catalog identical" compares every function (definition hash, owner, ACL), relation (kind, RLS, ACL), column (type),
policy (roles, expressions), trigger (function, events, enabled state) and schema, row by row.

The published build against the hotfixed database was tested with a temporary test on PG17, 8 of 8 passing. It
covered:

- the old `submitReview` insert-and-return works;
- reviews written then are held, so nothing is public;
- the old service-role flag update works;
- `hotfix-287-held-reviews.sql`'s count is right;
- a superadmin unhide makes a held review visible.

The app's other writes to these tables were checked in the code:

- roster edits change only role, number and position;
- no browser path writes `refund_*`;
- report changes go through the service role;
- only gym reviews, which are not held, are written from the browser.

**Required checks, run locally**, the way `.github/workflows/unit-lint.yml` and `db-tests.yml` run them, on each head
that GitHub Actions could not check:

| Head                       | Typecheck & build                 | Unit tests      | Lint (hooks, format) | SQL (PG17)  | Preflight (offline, self-tests) |
| -------------------------- | --------------------------------- | --------------- | -------------------- | ----------- | ------------------------------- |
| #287 `44525e1a`            | clean; built, no production ref   | 2920 passed     | pass                 | 951/0       | (not on this branch)            |
| #292 `d41b2fb6`            | clean; built, no production ref   | 3461 passed     | pass                 | 3454/0      | pass; 60/60                     |
| #293 `80e45b02`            | clean; built, no production ref   | 3575 passed     | pass                 | 3364/0      | pass; pass                      |
| #294 `3c076f63`            | clean; built, no production ref   | 3461 passed     | pass                 | 3467/0      | pass; pass                      |
| snapshot `a7b60601`        | clean; built, no production ref   | 3619 passed     | hooks pass           | 3467/0      | pass; pass                      |

#294's next commit (`c6a8ae50`) changes only the release preflight, its tests and the manifest's `pinned_history`. Its
self-tests pass 70/70 on PG16 and PG17, and its offline check passes. This #287 update merges `main` (with #286) and
adds documents only.

Test 440 (`supabase/tests/440_live_write_holes.test.sql`) has 55 assertions. The complete review stack (#294) passes
3467 assertions on PG16 and PG17.

## 9. Files

| File                                                                 | Use                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------- |
| `supabase/migrations/20261031120000_close_live_write_holes.sql`       | the migration (sha256 `843e356b…a6c1`)                  |
| `docs/release/hotfix-287-precheck.sql`                               | B3, read-only                                           |
| `docs/release/hotfix-287-verify.sql`                                 | B5 and D3, read-only                                    |
| `docs/release/hotfix-287-held-reviews.sql`                           | C3 and D2, read-only counts                             |
| `docs/rollbacks/20261031120000_lovable/part*.sql`                    | section 7, one part each, through Lovable               |
| `docs/release/hotfix-287-apply.psql`                                 | B4 with a direct connection only                        |
| `docs/rollbacks/20261031120000_close_live_write_holes.down.sql`      | section 7 with a direct connection only                 |
