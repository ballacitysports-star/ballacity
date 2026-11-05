# Production runbook: hotfixes #286 and #287

Prepared 2026-11-05. **Nothing in this file has been run against production.** Each step marked _approval_ needs the
owner's explicit approval at the time it is taken, and is recorded (who, when, output). Every database command here is
either read-only or one reviewed file run in one transaction, and every one of them was rehearsed on replays of `main`
(section 8).

| Step | What                                                                                | Touches                                              | Approval |
| ---- | ----------------------------------------------------------------------------------- | ---------------------------------------------------- | -------- |
| A    | #286 dependency patch: merge, check the preview, publish                            | the app build                                        | yes      |
| B    | #287 database: pre-check, apply the migration with its ledger row, verify           | production database: one migration, one ledger row   | yes      |
| C    | #287 app: merge, publish, right after B                                             | the app build                                        | yes      |
| D    | Afterwards: read-only checks, held reviews decided                                  | nothing (reads); superadmin moderation               | no       |

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
- Merging to `main` applies no SQL and publishes nothing: Lovable syncs `main`, migrations are applied by hand,
  publishing is a separate action (`docs/release/youth-privacy-release-runbook.md`).

## 2. Before any step

- Required checks green on the PR's head commit. GitHub Actions stopped assigning runners in this repository on
  2026-11-05 at about 14:26 UTC, so this needs the Actions billing or limit fixed first.
- No other merges to `main` and no Lovable agent edits during the window. Lovable's bot commits to `main` (attributed
  to the owner), so look at the `main` head before each merge.
- Know where to look: Lovable (preview URL, publish, version history) and the app's error logs.
- Keep a release record: the approvals, the commands' output (the SQL checks return catalog data only, never user
  data), the ledger row, and each published commit and time.

## 3. Step A: #286 (app only) _approval_

1. **Check the PR.** Head `ab974b45`, required checks green, no conflict. If `main` moved and `package.json` or
   `bun.lock` conflict, have the branch updated and re-checked; do not hand-merge a lockfile.
2. **Note what is live.** Record the published build (commit) to roll back to. Run the three requests below against
   the published site and keep the output.
3. **Merge #286** (merge commit). Lovable syncs `main` and rebuilds the preview. Production is unchanged.
4. **Compare the preview with the published site.** Run the same three read-only requests against the preview. Each
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
5. **Publish** _approval_. Record the commit and time. Repeat step 4 against the published site, and watch the error
   logs for 30 minutes.

**Rollback A.** Publish the previous build: revert the #286 merge commit on `main` (the PR's Revert button opens a
revert PR), merge it, and publish. No database state is involved, so publishing the old build completes the rollback. It
re-opens the advisories #286 patches (seroval, zod, the MCP SDK), so use it only for a regression that blocks users.

## 4. Step B: #287 database _approval_

### B0. Connection

The apply needs the `postgres` role over a direct connection, or the session-mode pooler on port 5432. Do not use the
transaction-mode pooler (port 6543): the rollback needs a session setting. Keep the password out of chat, issues, PRs,
shell history and command lines:

```sh
export PGHOST=db.<project-ref>.supabase.co PGPORT=5432 PGUSER=postgres PGDATABASE=postgres PGSSLMODE=require
# psql asks for the password, or reads it from ~/.pgpass (chmod 600). Any current psql (10 or newer) works.
```

**If there is no direct `postgres` connection, stop here.** This can happen when the project runs on Lovable Cloud and
does not expose one. Do not ask Lovable's agent to apply the file instead. Lovable's tool records a migration in
`drizzle.__drizzle_migrations`, not in the ledger row that the release preflight pins (PR #294). It has also applied
comment-stripped function bodies before (`docs/release/pg17-production-catalog-check.md` on the release branch), which
the verification below would report as a different definition. A Lovable variant needs its own reviewed and rehearsed
procedure. Ask for one.

Changing the database password is a production credential change: decide it separately, not as part of this runbook.

### B1. Backup point

Confirm the latest backup or point-in-time-recovery point (the project's Backups page) and note its time in UTC. The
rollback in section 7 does not need it. Restoring a backup would discard every change made since, so it is a separate
decision, never part of this runbook.

### B2. The reviewed files

From a clean checkout of the #287 head commit that was approved (`git checkout --detach <sha>`), at the repository
root:

```sh
sha256sum supabase/migrations/20261031120000_close_live_write_holes.sql
# 843e356b69c732ba0f335447e920b5f954029bada2d6c7c85d0a97f0fe13a6c1
```

The apply script checks the same hash itself and refuses any other text. The release manifest pins it too
(`pinned_history`, PR #294).

### B3. Pre-check (read-only)

```sh
psql -X -v ON_ERROR_STOP=1 -f docs/release/hotfix-287-precheck.sql
```

It returns 26 rows, and every `ok` must be `t`. It confirms:

- the server is Postgres 17;
- none of the hotfix's objects exist yet, including an early draft of `release_review_screening`;
- there is no ledger row for `20261031120000`;
- the two review policies the hotfix replaces are exactly `main`'s, so the rollback restores this state;
- the triggers on `team_members`, `payment_submissions`, `reviews` and `user_reports` are `main`'s; the new triggers
  rely on their name order;
- the prerequisites exist: `private_sec`, `auth.uid()`, the API roles and the `admin_audit_log` columns.

If any row is `f`, stop, and send the `check_name | expected | actual` rows. They hold catalog data only.

### B4. Apply

```sh
psql -X -f docs/release/hotfix-287-apply.psql
```

One transaction: the migration, then its ledger row in the release template, then a schema-cache reload for the API.
The output ends with `COMMIT`. On a first apply it also prints five notices ending in "does not exist, skipping". Those
come from the file's `DROP … IF EXISTS` lines and are expected. It refuses, with exit code 3 and nothing applied, if:

- the file is not the reviewed text;
- the ledger already has the version;
- a lock is not granted within 5 seconds (a busy table: wait a few minutes and run it again);
- any statement fails.

It takes seconds. It creates eight functions (five in `public`, three in `private_sec`), four triggers and one small
table, and replaces two policies. No data is rewritten. Queries on the four tables can pause for up to 5 seconds while
it takes its locks.

### B5. Verify (read-only)

```sh
psql -X -v ON_ERROR_STOP=1 -f docs/release/hotfix-287-verify.sql
```

It returns 21 rows, and every `ok` must be `t`. It checks:

- each of the eight functions' definitions by hash, compared with a Postgres 17 replay;
- both new policies;
- that the four triggers are enabled and call the right functions;
- that `release_review_screening` is executable by `service_role` and not by `anon` or `authenticated`;
- that the hold table cannot be read through the API roles;
- that the ledger row records exactly the reviewed file.

If a definition row differs right after a successful apply, do not merge #287: send the rows. Production runs 17.6
and the hashes come from 17.11. The release branch's PG17 catalog check found no difference between them for 17
functions, so a difference needs a look, not a guess.

From the end of B4 until C2, the published build keeps every new non-gym review hidden. Have step C ready before you
start B4.

## 5. Step C: #287 app _approval_

1. **Merge #287** (merge commit), only after B5 passed. Lovable syncs `main` and rebuilds the preview.
2. **Publish.** Record the commit and time.
3. **Count held reviews** (read-only, counts only):

   ```sh
   psql -X -v ON_ERROR_STOP=1 -f docs/release/hotfix-287-held-reviews.sql
   ```

   `held_for_screening` at this point is the reviews written during the B4 to C2 gap, plus any the AI sent for human
   review. Note the number.

## 6. Step D: afterwards

1. **Decide the held reviews.** A superadmin opens Superadmin, Moderation, Reviews, "hidden only", reads each held
   review and unhides the ones that are fine. Authors of reviews written during the gap were told their review was
   posted, so do this the same day.
2. **Watch the release path.** Re-run the held-reviews count a few hours later, and again the next day. It should grow
   only with reviews the AI sends for human review. If it grows with every new review, the server is not releasing
   them, and authors see "Your review was saved but could not be published yet.":
   - check the published build is #287's;
   - check the server has its service-role key;
   - check the server log for the `release_review_screening` error. If the API does not know the function yet, reload
     its schema cache with `NOTIFY pgrst, 'reload schema';` as `postgres`; the apply already sends this once.

   This fails closed (reviews stay hidden), so fix it forward. Do not roll back for it.
3. **Re-run the verification the next day** (`hotfix-287-verify.sql`, all `ok`). That catches a later tool or agent
   overwriting a definition.
4. When the privacy release is prepared, its preflight recognizes this hotfix through `pinned_history`, by the ledger
   row written in B4.

## 7. Rollback

Prefer a forward fix: a new reviewed migration that keeps the protection. A rollback re-opens a live hole, so it needs
the owner's approval at the time, and only the part that misbehaves is undone. The four parts are independent.

| Symptom                                                                   | Part | First response                                                                                                                                                          |
| ------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A roster change fails with `MEMBER_IDENTITY_FIXED`                        | 1    | Only moving a row to another person or team is refused. The app edits role, number and position, and those still work. Send the screen and error: likely a forward fix. |
| A payment action fails with a `refund_*` error                            | 2    | The app never writes `refund_*` from the browser. The refund engine and the service role are unaffected. Send the error.                                                |
| New reviews stay hidden (D2)                                              | 3    | Fix forward (D2). If the #287 build itself must go, publish the previous build. It is safe on the new database: reviews stay hidden until a superadmin unhides them.     |
| A moderator's report change fails with `REPORT_FIELDS_FIXED`              | 4    | The app's moderation tools use the server path and are unaffected; only a direct API edit of a report is. Send the error.                                                |

Undo one or more parts (`parts=all`, or a comma list such as `parts=3` or `parts=2,4`):

```sh
PGOPTIONS="-c app.confirm_reopen_live_write_holes=yes" \
  psql -X -v ON_ERROR_STOP=1 -v parts=<parts> --single-transaction \
  -f docs/rollbacks/20261031120000_close_live_write_holes.down.sql
```

- It refuses (exit code 3, nothing changed) without the confirmation, or without a valid `parts`. It ends by checking
  that the named parts are gone.
- **Part 3: publish the previous app build first.** The #287 build relies on the hold; without it, reviews the AI
  sends for human review would be published. The previous build works on either database state. Reviews held at that
  moment stay hidden: a notice gives their number, and superadmins decide them in Moderation.
- Afterwards, run `hotfix-287-verify.sql`. The rolled-back part's rows read `missing`, or show `main`'s policy hashes
  for part 3; the other parts' rows stay `ok`.
- The ledger row stays; record the rollback with it. The release preflight will refuse the target until a forward fix
  restores a recognized state. That is intended.
- App rollback for #287 alone (publish the previous build) never requires a database rollback.

## 8. What was rehearsed (local, 2026-11-05)

Fresh replays of `main` (43100e8c) on PostgreSQL 17.11 and 16.15, run with
`/tmp/claude-0/-home-user-ballacity/6077ac3f-6266-5ad6-b242-855a0f5d2664/scratchpad/tools/hf287_rehearse.sh` (a
session script, not in the repository). Each replay has a ledger table shaped like production's
(`version` primary key, `statements text[]`, `name`).

| Check                                                              | PG17                                       | PG16                                                    |
| ------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------- |
| Pre-check on `main`                                                | 26/26 ok                                   | 25/26 (server major is 16: by design, production is 17) |
| Apply with a one-byte-altered migration file                       | refused, exit 3, nothing applied           | same                                                    |
| Apply                                                              | `COMMIT`                                   | same                                                    |
| Verify                                                             | 21/21 ok                                   | 20/21 (server major)                                    |
| Apply again                                                        | refused (duplicate ledger key), unchanged  | same                                                    |
| Rollback without confirmation; without `parts`; `5`; `all,3`; `1;DROP` | each refused, exit 3, unchanged         | same                                                    |
| Rollback of each part alone                                        | only that part's objects removed           | same                                                    |
| Re-running the file after each partial rollback                    | catalog identical to `main` + #287         | same                                                    |
| Rollbacks `1`, then `2`, then `3,4`                                | catalog identical to `main`                | same                                                    |
| Rollback `all`                                                     | catalog identical to `main`                | same                                                    |

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

The full SQL suite on `main` + #287 passes 951 assertions on PG16 and PG17, 55 of them in
`supabase/tests/440_live_write_holes.test.sql`. On the complete review stack (#294) it passes 3467 on both.

## 9. Files

| File                                                             | Use                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------- |
| `supabase/migrations/20261031120000_close_live_write_holes.sql`   | the migration (sha256 `843e356b…a6c1`)                  |
| `docs/release/hotfix-287-precheck.sql`                           | B3, read-only                                           |
| `docs/release/hotfix-287-apply.psql`                             | B4, one transaction with the ledger row                 |
| `docs/release/hotfix-287-verify.sql`                             | B5 and D3, read-only                                    |
| `docs/release/hotfix-287-held-reviews.sql`                       | C3 and D2, read-only counts                             |
| `docs/rollbacks/20261031120000_close_live_write_holes.down.sql`  | section 7, per part, refuses without confirmation       |
