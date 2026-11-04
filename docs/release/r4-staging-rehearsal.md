# R4 staging rehearsal: applying the privacy stack to a verified sandbox

Status: **prepared, not run.** No sandbox is verified yet: `docs/release/verified-sandboxes.json` is an empty list, so
`scripts/rehearsal-guard.mjs` refuses every step. This plan touches no production system. Nothing in it is approval to
run anything; each step below needs the owner's go-ahead at the time.

Build under test: the throwaway integration branch the owner names at the time of the rehearsal. It is never merged
and never deployed to production. `staging/priv-rehearsal-r4` at `c637ec5e` (integration r4: R7, SEC-2, SEC-1, PAY-1,
#268 and the preflight) holds the R4 part only: 28 files, `20261103100000` to `20261107110000`. The release is now
**32 migrations**: those 28 plus SEC-4, SEC-5, SEC-6 and SEC-7 (`20261108100000_first_guardian_verification`,
`20261108110000_public_organizer_ref`, `20261108120000_image_quarantine_reencode`,
`20261108130000_remaining_security_defects`), and 33 if a payments PR adds `20261108140000`. The authoritative list,
order and sha256s are `docs/release/release-manifest.json` on the build under test at the time of the rehearsal,
regenerated with the preflight from PR #277 (section 3); this document does not fix them.

Related: runbook sections 4, 4a, 5 and 15 (`youth-privacy-release-runbook.md`); `sandbox-verification.md`;
`staging-test-checklist.md` (the ST-* IDs below); `privacy-gap-register.md`; `docs/privacy/*.md`.

## Hard limits (read before every session)

- **Production is never touched.** The production identifier is `9bd576a8-703f-4180-84d6-2cd32f2a851b` (the Lovable
  project id of the production app). Its Supabase project ref is `cpqihhcqeivbgxqbzatv` (runbook section 4). No
  production key, URL, database, Storage bucket, dashboard action or Lovable action is part of this plan.
- **Do not activate coarsening.** The switches stay OFF: `app_settings` keys for youth game, team post and team facility
  coarsening stay absent or false. Do not run the activation sequence of runbook section 8 or staging checklist ST-12.
- **Do not run the historical batches.** Do not call `coarsen_existing_youth_games`,
  `coarsen_existing_youth_team_posts`, `coarsen_existing_youth_team_facilities` or any other batch or backfill
  beyond what a migration does by itself. Do not run the historical (pre-range) migrations a second time. Do not run
  any file from `docs/migration-evidence/original-sources/`. Do not run `supabase/phase2/*` (see step V7 for the only
  allowed use).
- **Synthetic data only.** No production row, dump, media file, email address or phone number. A schema-only dump of
  production is not used either: the sandbox is rebuilt from the repository.
- **No E2E secret is set by this plan.** The owner alone configures the `e2e-sandbox` environment
  (`sandbox-verification.md` section 4) after verification.
- **Run the guard first, every time.** Run `SANDBOX_PROJECT_REF=<ref> bun run rehearsal:guard` at the start of every
  session and before every numbered step. If it does not print `OK`, stop.

## 1. Prerequisites and sandbox verification

| #   | Requirement                                                                                                                                                                                                                                                                                  | Evidence recorded                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| P1  | The owner completed `sandbox-verification.md` steps 1-9 for the candidate project                                                                                                                                                                                                            | owner's written "sandbox verified" |
| P2  | **Project ref is not production.** The Supabase ref differs from `cpqihhcqeivbgxqbzatv`, and the Lovable project (if any) differs from the production identifier `9bd576a8-703f-4180-84d6-2cd32f2a851b` and does not use the production backend                                              | ref, Lovable project id            |
| P3  | **Owned by a different organization or owner-controlled.** It is not the project that serves ballacity.com                                                                                                                                                                                   | organization names                 |
| P4  | **No production data.** `profiles`, `hosted_games`, `guardian_links`, `payment_submissions`, `availability_contact_requests`, `auth.users` and Storage are empty, or hold synthetic rows only. Check this before the reset (step R0)                                                         | row counts (aggregates only)       |
| P5  | **Separate keys.** The sandbox publishable key is refused by production (`/auth/v1/health` returns 401, run privately by the owner, never with a production key). Its service-role key is not the production key. Edge Function secrets hold no live PayPal, email, SMS, push or Google keys | key hash prefixes only; the 401    |
| P6  | No replication, foreign data wrapper, webhook or redirect URL pointing at production or `ballacity.com`                                                                                                                                                                                      | screenshot of the settings         |
| P7  | Postgres 17 (same major as production), `pg_graphql` state noted, exposed API schemas noted (`private_sec` must not be exposed)                                                                                                                                                              | `select version()`; API settings   |
| P8  | **Owner sign-off** recorded, then the owner adds one entry to `docs/release/verified-sandboxes.json` through a reviewed commit (format below)                                                                                                                                                | commit SHA                         |
| P9  | Operator machine: a checkout of `staging/priv-rehearsal-r4` at `c637ec5e` (or the reviewed rehearsal head), Node 20+, `psql` 17, and no production variable in the shell (`env \| grep -i -e supabase -e cpqihh -e 9bd576a8` is empty apart from the sandbox)                                | `git rev-parse HEAD`               |

Allow-list entry (added by the owner, never by the operator or an agent):

```json
[
  {
    "project_ref": "<20-letter sandbox ref>",
    "verified_by": "<owner name>",
    "verified_on": "YYYY-MM-DD",
    "owner_signoff": "<where the written sign-off is recorded>",
    "lovable_project_id": "<optional; never the production identifier>"
  }
]
```

The guard refuses unless `SANDBOX_PROJECT_REF` is set, has the Supabase ref format, is not a production identifier
(including refs in `supabase/config.toml` and `.env.production`), and is listed once with `verified_by`,
`verified_on` and `owner_signoff`. It also refuses if any environment variable contains a production identifier, or
if a Supabase URL or a readable JWT in the environment names another project. It connects to nothing. To revoke a
sandbox, add `"revoked": true` to its entry or remove it.

Connection for the SQL steps: put the sandbox connection string in the environment only, never on the command line or
in a file in the repository: `export PREFLIGHT_DATABASE_URL='postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres?sslmode=require'`.
Run the guard after exporting it: the guard checks that variable too.

## 2. Reset and rebuild to the pre-release point (R0)

Run the guard first. Then:

1. Reset the sandbox database (the owner's decision; the sandbox holds no real data).
2. Apply every file in `supabase/migrations` and `drizzle/migrations` **before** `20261103100000`, in the order
   `scripts/db-test.mjs` uses (timestamp order; a drizzle entry's time is its journal `when`; at the same instant the
   supabase file first). Give each file its own transaction. Do not apply `docs/migration-evidence/original-sources/`.
3. Load the synthetic fixtures (section 5).
4. Pass condition: the catalog fingerprint (`docs/migration-evidence/catalog-fingerprint-cte.sql`) equals a local
   replay of the same files (ST-0.2). The previous production build works against it (ST-0.3).

## 3. Pre-check (read-only preflight)

Run the guard first. Then, from the rehearsal checkout:

```sh
bun run preflight -- --offline                                  # manifest vs checkout; must PASS
bun run preflight -- --json > rehearsal-pre.json                # read-only; uses PREFLIGHT_DATABASE_URL
```

- It must exit 0 and list every manifest migration as pending (32, or 33 with `20261108140000`), in manifest order.
  That pending list, with its sha256s, is the order of section 4.
- **16-vs-17.** Use the fail-closed preflight from PR #277 (`claude/release-preflight`), with a manifest regenerated
  from the build under test and merged with its PG17 hashes from the `Release preflight (PG17)` CI artifact
  (`docs/release/release-preflight.md` on that branch). It **fails** (exit 1) when the manifest carries no hashes for
  the target's major; it does not warn or fall back. The sandbox runs 17, so a manifest generated only on 16 is
  refused. Any failure, including "unrecognized state", stops the rehearsal.
- Keep the JSON with the rehearsal record. The preflight is read-only (`BEGIN READ ONLY`, aborts unless
  `transaction_read_only = on`) and never writes the ledger.

## 4. Exact migration order

Apply **one file per transaction, in this order, with its ledger row in the same transaction**. The ledger row is
`version` = the file's 14-digit prefix, `name` = the file stem, `statements` = the file content. Never apply a file
whose sha256 differs from the manifest (`sha256sum <file>` against the manifest before each step). Never re-run a file.
Never skip a file. Run the guard before each file.

Template for each file (psql, as the `postgres` role of the sandbox):

```sql
\set ON_ERROR_STOP on
\set content `cat supabase/migrations/<file>.sql`
BEGIN;
SET LOCAL lock_timeout = '5s';          -- from the table below
SET LOCAL statement_timeout = '15min';
SET LOCAL idle_in_transaction_session_timeout = '20min';
\i supabase/migrations/<file>.sql
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('<version>', '<file stem>', ARRAY[:'content']);
COMMIT;
```

This is the same ledger insertion the release will use: `statements` holds the file content as one text element.
The preflight checks it: a release-range row whose `name` is not the file stem, whose `statements` is empty, or whose
`statements[1]` does not hash to the manifest sha256 fails. psql's backquote expansion drops the file's final newline,
and the preflight accepts exactly that difference and no other.
Do **not** use `supabase db push`. It would also try the historical files, which are ledgered differently (runbook
section 1).

**Dependency guards.** Each file starts with a guard block (`to_regprocedure` / `to_regclass` checks) that raises
and aborts if a prerequisite is missing. The "Dependency guard" column lists everything the manifest records the file
needs: the guard literals plus the runbook's "Needs" (functions, tables, schemas, earlier migrations). A file that
stops on its guard leaves nothing applied. Stop and record it; do not edit the file.

**lock_timeout.** A file that alters a table or creates a trigger or policy on it takes a strong lock (ACCESS
EXCLUSIVE for `ALTER TABLE` and `ALTER/CREATE POLICY`; SHARE ROW EXCLUSIVE for `CREATE TRIGGER`). The default is
`lock_timeout = '5s'`. For files that lock busy tables (`profiles`, `hosted_games`, `teams`, `team_members`,
`join_requests`, `team_posts`, `post_comments`, `post_reactions`, `notifications`, `messages`, `storage.objects`), use
`3s` and run them in a quiet window (in the sandbox: stop the E2E runner and the app's background jobs). On a lock
timeout the transaction rolls back completely. Wait, check `pg_stat_activity` for the blocker (read-only), and retry at
most three times. Never raise `lock_timeout` above `30s`, and never terminate another backend without the owner's
approval. Record every retry with its duration: production needs these numbers.

**Order.** Apply the files in the order of the pre-check's pending list (the manifest at the time of the rehearsal),
checking each file's sha256 against that manifest. The table below is **R4 only** (files 1-28, as recorded on
`c637ec5e`), kept for its dependency and lock notes; its sha256 column is not authoritative. Files 29-32 (SEC-4 to
SEC-7, `20261108100000` to `20261108130000`, then `20261108140000` if present) follow in timestamp order, with the
dependency guards the manifest records for them, `lock_timeout = '3s'` and a quiet window.

**Before SEC-7 (`20261108130000`): count the legacy payment settings.** SEC-7 forces `requires_approval = true` on
existing paid or `ballacity_processed` payment settings of games whose host is not a verified adult. Record, read-only,
before applying it:

```sql
BEGIN READ ONLY;
SELECT count(*)                                                    AS ballacity_processed_rows,
       count(*) FILTER (WHERE NOT coalesce(s.requires_approval, false)) AS without_approval,
       count(*) FILTER (WHERE coalesce(public.age_cohort_of(g.host_id), 'unknown') <> 'adult') AS non_adult_host
  FROM public.game_payment_settings s
  LEFT JOIN public.hosted_games g ON g.id = s.game_id
 WHERE s.payment_mode = 'ballacity_processed';
ROLLBACK;
```

Keep the three counts with the per-file log. After SEC-7, the rows with a non-adult host must all have
`requires_approval = true`. In the sandbox these rows come only from the synthetic fixtures. For production the same
count is a separate read-only step that needs its own approval.

| #   | File                                                         | sha256 (first 12) | Dependency guard (must exist before; from the manifest `requires`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Tables locked by DDL                                                                                                                                                                                           | lock_timeout                 |
| --- | ------------------------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1   | `20261103100000_single_review_helpfuls_trigger.sql`          | `c7040ea0de8b`    | fn `public.bump_helpful_count()`; tbl `public.review_helpfuls`, `public.reviews`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `public.review_helpfuls`                                                                                                                                                                                       | `5s`                         |
| 2   | `20261103101000_capture_enforce_gym_review.sql`              | `553ced7669d0`    | fn `public.has_verified_gym_visit(uuid,uuid)`, `public.try_uuid(text)`; tbl `public.trainer_orgs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | -                                                                                                                                                                                                              | `5s` (functions/grants only) |
| 3   | `20261103102000_capture_review_ring_suspects.sql`            | `cadae5a3d139`    | fn `public.is_moderator(uuid)`, `public.try_uuid(text)`; tbl `public.reviews`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | -                                                                                                                                                                                                              | `5s` (functions/grants only) |
| 4   | `20261103103000_revoke_enforce_skill_vote_execute.sql`       | `2d1258558f49`    | fn `public.enforce_skill_vote()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | -                                                                                                                                                                                                              | `5s` (functions/grants only) |
| 5   | `20261103104000_revoke_enforce_review_integrity_execute.sql` | `3b76ac3b4130`    | fn `public.enforce_review_integrity()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | -                                                                                                                                                                                                              | `5s` (functions/grants only) |
| 6   | `20261103110000_capture_structured_reviews.sql`              | `77618c88adc8`    | fn `public.enforce_review_integrity()`, `public.player_trait_counts(uuid)`; tbl `public.reviews`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `public.reviews`                                                                                                                                                                                               | `5s`                         |
| 7   | `20261103120000_minor_review_privacy.sql`                    | `67320ad16218`    | after `20261103110000`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `public.reputation_insights`, `public.reviews`                                                                                                                                                                 | `5s`                         |
| 8   | `20261103130000_profile_insert_guard.sql`                    | `2194cbdc6229`    | tbl `public.profiles`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `public.profiles`                                                                                                                                                                                              | `3s`, quiet window           |
| 9   | `20261103140000_payment_settings_host_guard.sql`             | `5c74b31e9ca9`    | tbl `public.game_payment_settings`, `public.payment_submissions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `public.game_payment_settings`, `public.payment_submissions`                                                                                                                                                   | `5s`                         |
| 10  | `20261103150000_helper_oracle_containment.sql`               | `cfad8daa58dd`    | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | -                                                                                                                                                                                                              | `5s` (functions/grants only) |
| 11  | `20261104100000_youth_game_private_location.sql`             | `09ec9a769775`    | fn `public.game_age_range_is_adult_only(integer,integer)`; tbl `public.app_settings`, `public.game_participants`, `public.guardian_links`, `public.hosted_games`, `public.payment_submissions`                                                                                                                                                                                                                                                                                                                                                                                         | `public.app_settings`, `public.hosted_game_private`, `public.hosted_games`                                                                                                                                     | `3s`, quiet window           |
| 12  | `20261104110000_game_age_and_minor_hosting.sql`              | `0ea54a6f3394`    | after `20261103140000`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `public.hosted_games`, `public.join_requests`, `public.minor_hosting_approvals`                                                                                                                                | `3s`, quiet window           |
| 13  | `20261104120000_minor_host_payments_and_identity.sql`        | `b24110055188`    | fn `private_sec.game_payee(text)`; after `20261103140000`, `20261104110000`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `public.game_payment_settings`, `public.host_payment_methods`, `public.host_paypal_accounts`, `public.hosted_games`, `public.minor_hosting_approvals`                                                          | `3s`, quiet window           |
| 14  | `20261104130000_location_text_detector.sql`                  | `b80eedac6ddc`    | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | -                                                                                                                                                                                                              | `5s` (functions/grants only) |
| 15  | `20261104140000_youth_game_public_text_guard.sql`            | `f8e1d84d94d7`    | fn `public.is_moderator(uuid)`; after `20261104100000`, `20261104130000`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `public.hosted_games`                                                                                                                                                                                          | `3s`, quiet window           |
| 16  | `20261104150000_contact_request_coarse_location.sql`         | `441f647df3ce`    | after `20261104100000`, `20261104130000`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `public.availability_contact_requests`, `public.notifications`                                                                                                                                                 | `3s`, quiet window           |
| 17  | `20261105100000_team_post_location_privacy.sql`              | `c423c874fd01`    | after `20261104100000`, `20261104130000`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `public.team_post_private`, `public.team_post_public_venues`, `public.team_posts`                                                                                                                              | `3s`, quiet window           |
| 18  | `20261105110000_team_facility_privacy.sql`                   | `44a53898b506`    | after `20261104100000`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `public.app_settings`, `public.team_facility_private`, `public.team_public_facilities`, `public.teams`                                                                                                         | `3s`, quiet window           |
| 19  | `20261105130000_location_disclosure_reports.sql`             | `d75b62ba4cca`    | fn `public.is_moderator(uuid)`; after `20261104130000`, `20261104140000`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `public.user_reports`                                                                                                                                                                                          | `5s`                         |
| 20  | `20261105140000_minor_host_identity.sql`                     | `5be4429020f0`    | after `20261104110000`, `20261104120000`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `public.child_controls`, `public.hosted_games`, `public.privacy_preferences`                                                                                                                                   | `3s`, quiet window           |
| 21  | `20261106100000_minor_availability_privacy.sql`              | `d743f376c7e6`    | fn `private_sec.can_see_minor_name(uuid,uuid)`, `private_sec.text_discloses_location(text,text)`, `public.minor_messaging_block(uuid,uuid)`; after `20261104120000`, `20261104130000`                                                                                                                                                                                                                                                                                                                                                                                                  | `public.availability_contact_requests`, `public.player_availabilities`                                                                                                                                         | `5s`                         |
| 22  | `20261106110000_minor_host_correlation.sql`                  | `f7731f0fc6da`    | fn `private_sec.can_see_minor_name(uuid,uuid)`, `private_sec.minor_has_active_youth_game(uuid)`, `private_sec.roster_row_visible(text,uuid)`; after `20261105140000`                                                                                                                                                                                                                                                                                                                                                                                                                   | `public.hosted_games`, `public.post_comments`, `public.post_reactions`, `public.skill_ratings`, `public.team_posts`, `public.teams`                                                                            | `3s`, quiet window           |
| 23  | `20261106120000_private_image_staging.sql`                   | `fb29a6167ba8`    | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `storage.objects`                                                                                                                                                                                              | `3s`, quiet window           |
| 24  | `20261106120500_attachment_check_binding.sql`                | `b4a04e39c49f`    | fn `private_sec.storage_write_is_trusted(uuid,text)`; tbl `public.message_attachment_checks`, `storage.objects`; schema `private_sec`                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `public.message_attachment_checks`, `public.messages`, `storage.objects`                                                                                                                                       | `3s`, quiet window           |
| 25  | `20261106130000_team_content_reports.sql`                    | `2b3a965bb31e`    | fn `private_sec.scrub_game_public_text(text)`, `public.age_cohort_of(uuid)`, `public.is_moderator(uuid)`; tbl `public.post_comments`, `public.team_posts`, `public.user_reports`; after `20261105130000`                                                                                                                                                                                                                                                                                                                                                                               | `public.content_report_holds`, `public.moderation_appeals`, `public.user_reports`                                                                                                                              | `5s`                         |
| 26  | `20261106140000_minor_messaging_authorization.sql`           | `215916e7867e`    | fn `private_sec.availability_post_visible(uuid)`, `private_sec.can_see_minor_name(uuid,uuid)`, `private_sec.wrap_oracle_helpers()`, `public.can_notify(uuid,uuid)`, `public.guard_contact_request_minor_recipient()`, `public.minor_messaging_block(uuid,uuid)`                                                                                                                                                                                                                                                                                                                        | `public.availability_contact_requests`, `public.guardian_link_requests`, `public.join_requests`, `public.message_reactions`, `public.team_members`                                                             | `3s`, quiet window           |
| 27  | `20261107100000_stack_hardening_from_review.sql`             | `662989465cb4`    | fn `private_sec.can_see_minor_name(uuid,uuid)`, `private_sec.minor_has_active_youth_game(uuid)`, `private_sec.tell_host_location_removed(uuid,text)`, `private_sec.wrap_oracle_helpers()`, `public.coarsen_existing_youth_games(integer)`, `public.guard_youth_location_switch()`, `public.minor_messaging_block(uuid,uuid)`, `public.moderator_scrub_game_text(text,text)`, `public.moderator_scrub_team_post_text(uuid,text)`, `public.set_listing_hidden(text,text,boolean)`, `public.sync_hosted_game_private()`; tbl `public.minor_hosting_approvals`, `public.team_post_private` | `public.app_settings`, `public.hosted_games`, `public.join_requests`, `public.location_report_evidence`, `public.org_members`, `public.profiles`, `public.teams`, `public.trainer_orgs`, `public.user_reports` | `3s`, quiet window           |
| 28  | `20261107110000_payment_path_fixes.sql`                      | `b72234c6d57b`    | fn `private_sec.can_manage_game_payment_settings(text)`, `private_sec.game_payee(text)`, `private_sec.messaging_connection(uuid,uuid)`, `private_sec.wrap_oracle_helpers()`                                                                                                                                                                                                                                                                                                                                                                                                            | `public.game_payment_settings`, `public.payment_submissions`                                                                                                                                                   | `5s`                         |

After each file, check before going on:

- the preflight again (read-only): that file is now applied, nothing else changed, and the remaining list is unchanged;
- the file's own verification queries from its header and runbook section 3 (definitions, grants, policies,
  `tgenabled`), compared with the local replay;
- the coarsening switches are still OFF (`ST-1.3`).

## 5. Seed fixtures (synthetic only)

Use disposable emails on a domain you control or `example.test`, generated names ("Test Teen T2 A"), and dates of birth
that set the cohort. Never real people, photos, schools, addresses or phone numbers. Venues are invented
("123 Example Court, Testville"). Payment details are PayPal sandbox values or placeholders. Load through the real
Auth signup path (so the `profiles` insert trigger runs) plus service-role inserts for rows a client cannot create.

| Kind      | Fixtures                                                                                                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Minors    | under-13 managed child **C** (with guardian), 13-15 **T1**, 16-17 **T2** with and without a guardian link, an unknown-age account                                                                           |
| Guardians | verified guardian of C and T2; revoked guardian; unverified (pending) guardian                                                                                                                              |
| Adults    | adult host, adult organizer / org admin, adult payment manager, team manager, unrelated adult, unrelated teen, moderator, administrator                                                                     |
| Teams     | one youth team (members C, T1, T2; manager; guardian), one adult team, one team with a private facility                                                                                                     |
| Games     | youth game (8-12), no-age-limit game, 18+ (21+) game, paid youth game, legacy youth game created before the release migrations, a game hosted by T2 (needs a hosting approval)                              |
| Content   | youth team post with a private event venue, availability posts by T1 and an adult, contact requests, a message thread with an attachment, GPS-EXIF images from `scripts/generate-exif-fixtures.py` (G3/G3b) |

Record fixture ids in the rehearsal record (synthetic ids only). Delete the fixtures at the end, or reset the sandbox.

## 6. Verifications that need a real Supabase project

Run each with the synthetic accounts above, through the real API (publishable key + user JWTs), not `SET ROLE`. Record
pass or fail with evidence (request, response code, row counts, screenshots). Any fail stops the rehearsal.

| ID  | Verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Pass                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| V1  | **Storage owner stamping and triggers on `storage.objects`.** `postgres` could create the triggers in the hosted project (migrations 23, 24 applied). A user's signed-upload-URL PUT (with and without upsert) is written by Storage as `service_role` with the signer in `owner`/`owner_id`. A service-key upload has no owner. `image_staging_refuse_overwrite` and `message_attachment_checked_is_final` refuse the signed-URL overwrite and allow the service write (G3b H1) | signer stamped; overwrite through a user token refused; service write accepted         |
| V2  | **`info()` returns `version`.** storage-js `info()` on a staged image and a message attachment returns `id` and `version`. An upsert keeps `id` and changes `version`. `finalizeAttachment` binds id and version and fails closed without them                                                                                                                                                                                                                                   | both fields present; attachment send works; mismatch refused                           |
| V3  | **Private-bucket signed URLs.** `image-staging` and `message-attachments` are private. An owner's signed URL works and expires. Another user, `anon`, and a signed URL for a quarantined original are refused. The five-minute SELECT window holds for `INSERT ... RETURNING`                                                                                                                                                                                                    | positives work; negatives 400/403                                                      |
| V4  | **CDN after replace or delete.** Replace (server promotion) and delete a public image, then fetch the public URL repeatedly (cache headers, purge latency, stale URL after delete)                                                                                                                                                                                                                                                                                               | record the times; a stale original served after replacement is a finding for the owner |
| V5  | **Staging sweeper pagination.** With more files than one Storage list page across several user folders (synthetic), run `superadminSweepImageStaging` as superadmin, dry run first, then live. It pages through folders and files, never removes a quarantined file, skips nested entries (`skippedNested`), and removes moderation rows of removed files                                                                                                                        | counts match the seeded set; quarantined files remain                                  |
| V6  | **Phase 2 compatibility, old and new clients (without closing anything).** The previous build (direct public-bucket upload) and the new build (staging + promotion) both work against the migrated database. The phase 2 closure itself is **not** applied (V7)                                                                                                                                                                                                                  | both builds upload; GPS absent in stored bytes for the new build                       |
| V7  | **Phase 2 rehearsal (optional, needs separate owner approval at the time).** Only in the sandbox, and only after V6: run `supabase/phase2/g3b_phase2_close_direct_image_uploads.sql` in a transaction. The old client is refused and the new client works; then roll back or reset. Never as a migration file, never outside the sandbox                                                                                                                                         | old refused, new works                                                                 |
| V8  | **pg_graphql exposure of the SEC-2 wrappers.** `select extname from pg_extension where extname = 'pg_graphql'`. If present, query `/graphql/v1` as an unrelated user and as `anon` for the 29 wrapped helpers: no `private_sec` function is exposed, and each wrapper gives its fixed answer. `private_sec` is not in the API's exposed schemas                                                                                                                                  | disabled, or fixed answers only; `private_sec` not exposed                             |
| V9  | **PostgREST schema cache.** After the last migration, the API sees new functions and tables without a manual restart (or after `NOTIFY pgrst, 'reload schema'`, recorded). `/rpc/<wrapper>` calls resolve to the public wrappers. Removed or renamed signatures return 404, not a stale definition                                                                                                                                                                               | new objects reachable as granted; record whether a reload was needed                   |
| V10 | **Realtime payloads.** Subscribe as each cohort to `hosted_games`, `availability_contact_requests`, `notifications`, `team_posts`, and try `hosted_game_private`, `team_post_private`, `team_facility_private`, `minor_hosting_approvals`. Private tables deliver nothing. No exact venue, minor name or other private field appears in any payload, including `old_record` (switch OFF: public columns unchanged)                                                               | no private payload to an unentitled subscriber                                         |
| V11 | **E2E browser matrix.** Playwright against the sandbox build: runbook section 5 and staging checklist sections 2-11 (cohorts x roles, positives and negatives, sign-out and account switching with cache purge, notifications, maps, invitations, free-text refusals, mobile 390 px and desktop 1280 px). Run it only after the owner has configured `e2e-sandbox` and `E2E_SANDBOX_PROJECT_REF`; this plan sets neither                                                         | all pass; Playwright stays non-required until it passes repeatedly                     |
| V12 | Auth and RLS through the gateway (runbook 4a items 1-2, ST-2, ST-3): real JWTs, guardian-child switch, every negative of section 5 through PostgREST; `anon` calls to trigger functions and helpers refused                                                                                                                                                                                                                                                                      | all refused with the right error                                                       |

## 7. Post-check (read-only preflight)

Run the guard first. Then:

```sh
bun run preflight -- --verify-after --json > rehearsal-post.json
```

It must exit 0: every manifest migration applied (32, or 33), and every protected function, policy, table and bucket
equal to `expect_after` for the sandbox's major (with the PG17 manifest of section 3). Then re-run the catalog fingerprint and the runbook section 12b
aggregates (expect the switch-OFF values; no coarsening has run). Record durations, row counts and anything
surprising (runbook 4.6).

## 8. Explicitly out of scope

- Activating any coarsening switch, the section 8 activation sequence, ST-12, or rehearsal step S9 of runbook section 15
  (it needs a separate plan and approval).
- Running `coarsen_existing_youth_games`, `coarsen_existing_youth_team_posts`, `coarsen_existing_youth_team_facilities`,
  any historical batch or backfill, or re-running any pre-range migration.
- Applying `supabase/phase2/*` as a migration (V7 is a transaction in the sandbox only, with separate approval).
- Inserting historical ledger rows (the 71 unledgered files are an owner decision, `docs/migration-history-reconciliation.md`).
- Anything in production: no read, no write, no preflight against production, no Lovable publish, no deploy.
- Setting E2E secrets or variables, or making Playwright a required check.

## 9. Rollback and forward-fix rules

- **A file fails.** Its transaction rolls back and nothing is half-applied. Stop, record the error and the guard or
  lock that triggered it, and fix the cause. Never edit the migration file in the sandbox, and never insert a ledger
  row for a failed file.
- **A post-file check mismatches.** Do not continue. Compare with the local replay. The fix is a new, reviewed migration
  on the rehearsal branch that keeps every protection, followed by a manifest regeneration. The rehearsal then restarts
  from R0.
- **Rollback scripts** (`docs/rollbacks/*.down.sql`) re-open exposure. Use them only to rehearse the reverse chain,
  only with the owner's typed approval at the time, and only in the sandbox. Afterwards the sandbox is reset (R0).
  Never "get unstuck" with a rollback script.
- **Never re-run an older file over a newer definition** (runbook section 2: never re-run 3 or 5 after 6). The
  preflight's regression check catches it; if it fires, reset to R0.
- **App rollback.** Before activation (always the case here), the previous build is safe against the migrated database.
- **Suspected exposure** (an unentitled account sees an exact venue, a minor's name, or a private payload): stop, keep
  the logs, tell the owner, and treat it as a finding even though the data is synthetic.
- **Clean-up.** At the end, delete the synthetic fixtures or reset the sandbox. Remove any operator-side copy of the
  connection string. If the sandbox will not be used again, the owner marks its allow-list entry `"revoked": true`.

## 10. Sign-off

| #   | Item                                                                       | Evidence                                   | Operator | Owner | Date |
| --- | -------------------------------------------------------------------------- | ------------------------------------------ | -------- | ----- | ---- |
| 1   | Sandbox verified (P1-P8); allow-list entry committed                       | sign-off, commit SHA                       |          |       |      |
| 2   | Guard prints OK on the operator machine; no production variable in the env | guard output                               |          |       |      |
| 3   | R0 rebuild: fingerprint equals local replay; previous build works          | fingerprint diff (empty)                   |          |       |      |
| 4   | Pre-check preflight exit 0, all 32 (or 33) pending, PG17 hashes            | `rehearsal-pre.json`                       |          |       |      |
| 5   | Migrations 1-32 (or 33) in manifest order; SEC-7 pre-count; lock retries   | per-file log with durations                |          |       |      |
| 6   | V1-V3 Storage (owner stamping, triggers, `info()` version, signed URLs)    | requests and responses                     |          |       |      |
| 7   | V4 CDN, V5 sweeper, V6 old and new clients (V7 only if approved)           | timings, counts                            |          |       |      |
| 8   | V8 pg_graphql, V9 schema cache, V10 realtime                               | queries, payload captures                  |          |       |      |
| 9   | V11 E2E matrix, V12 Auth/RLS through the gateway                           | Playwright report, screenshots             |          |       |      |
| 10  | Post-check `--verify-after` exit 0; switches still OFF; no batch run       | `rehearsal-post.json`, `app_settings` rows |          |       |      |
| 11  | Fixtures removed or sandbox reset; nothing touched production              | operator statement                         |          |       |      |
| 12  | Rehearsal record reviewed; decision on a production plan (separate)        | owner's written decision                   |          |       |      |
