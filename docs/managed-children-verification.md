# Managed children — verification

Managed children are minors a guardian adds without giving them an email or
password. Each one is a real auth user with no usable credentials (placeholder
address on the reserved `managed.invalid` domain, no password), created by the
app's server function with the service role and provisioned by
`provision_managed_child()` running **as the guardian**. Because the child is a
real auth user, every control verified in
[`family-architecture-final-verification.md`](./family-architecture-final-verification.md)
and [part 2](./family-architecture-verification-part2.md) keys on the child's
auth id and applies unchanged. This supersedes the stage-3 plan for
`player_profiles` (see the note at the end of the final-verification doc).

Code: `supabase/migrations/20260930120000_managed_children.sql`,
`supabase/migrations/20260930121000_freeze_player_profiles.sql`,
`src/lib/managed-children*.ts`, `src/lib/managed-session.ts`.

## How this was verified

**Behaviour was verified on a local replay; the live database has been checked
structurally only** (see "Applied to the live database" below). The migrations
are applied through Lovable (`docs/supabase-cli.md`: never by hand on the
production project), so the provisioning and guard matrix in this document
comes from a run that replayed the **entire migration chain (287 files) on vanilla Postgres 16** with
minimal Supabase stubs (`auth.users`, `auth.uid()` from the
`request.jwt.claim.sub` setting, `storage`/`realtime` tables, the API roles),
then called every function **as the `authenticated` role with the caller's id in
the JWT claim** — the same way PostgREST evaluates a real user's request. Two
adjustments were needed for vanilla Postgres and are recorded, not hidden:

- `MAINTAIN` (a Postgres 17 privilege, used by `20260731205616`) was stripped —
  production runs Postgres 17.
- `public.guard_profile_moderation_fields()` exists in production but no
  migration creates it (schema drift); a no-op stub was created so
  `20260915225632` could revoke it.

Cast: `parent` (adult, confirmed email), `other` (unrelated adult), `teenacct`
(a 13–15 with their own login), `stranger` (adult), and managed children created
the way the server function does — `raw_app_meta_data = {managed: true,
managed_by: parent}`, placeholder email, no password.

## Provisioning

| # | Test | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| M1a | Parent provisions a 10-year-old | created, consent recorded | `child_under_13`, `consent=true` | PASS |
| M1b | Parent provisions a 16-year-old | created, no consent row (not required for 16–17) | `teen_16_17`, `consent=false` | PASS |
| M1c | Parent provisions a 14-year-old | created, consent recorded; account active | `teen_13_15`, `consent=true`; `platform_status` `active`, not locked | PASS |
| M2 | A 13–15 login provisions a child | refused | `ADULT_REQUIRED` | PASS |
| M2b | A managed child's own session provisions a child | refused | `ADULT_REQUIRED` | PASS |
| M3 | Another adult provisions the parent's child | refused | `NOT_YOUR_MANAGED_CHILD` | PASS |
| M3b | Child user created more than 15 minutes ago | refused | `NOT_YOUR_MANAGED_CHILD` | PASS |
| M3c | `app_metadata.managed = false` | refused | `NOT_YOUR_MANAGED_CHILD` | PASS |
| M3d | Anonymous caller | refused | `AUTH_REQUIRED` | PASS |
| M4 | Provisioning the same child again | refused | `ALREADY_PROVISIONED` | PASS |
| M4b | No guardian attestation | refused | `ATTESTATION_REQUIRED` | PASS |
| M4c | Adult birthday | refused | `CHILD_IS_ADULT` | PASS |
| M4d | Name containing digits | refused | `NAME_INVALID` | PASS |
| M4e | Terms version older than the published one | refused | `LEGAL_VERSION_STALE` | PASS |
| M4f | Sixth child in 24 hours | refused | `MANAGED_LIMIT` on the 6th | PASS |

## Resulting state

| # | Check | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| M5 | Profile | name/initials/sport set, `account_type = player`, cohort derived | `Jake S.`, `JS`, `Basketball`, `player`, `child_under_13` | PASS |
| M6 | Guardian link | active and verified | `active`, `verified_at` set, relationship kept | PASS |
| M7 | Consent (under 13) | approved, method, versions, scope | `approved`, `email_confirmation`, `2026-09-01`/`2026-09-01`, `{source: managed_child, guardian_attested: true}` | PASS |
| M8 | Child controls (both cohorts) | safe defaults | `guardian_only` messaging, `private` media, games on, AI off | PASS |
| M9 | Legal acceptance | terms + privacy, accepted by the guardian | both rows, `accepted_by = parent` | PASS |
| M10 | Privacy | minor floor | `private`, AI processing and training off | PASS |
| M11 | Platform status | usable immediately | `active`, not locked | PASS |
| M11b | Audit trail | every row names the guardian | `managed.created`, `link.active`, `controls.created`, `consent.required`, `consent.approved` — all `actor = parent` | PASS |
| M11c | Notifications | one per child, no duplicate | 1 for the under-13 (consent trigger), 1 for the 16–17 ("Child profile added") | PASS |

## The child's existing controls still apply

| # | Check | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| M12a | `minor_messaging_allowed(child, stranger)` | false | false | PASS |
| M12b | `minor_messaging_allowed(child, parent)` | true | true | PASS |
| M12c | `child_game_participation_allowed(child)` | true | true | PASS |
| M12d | `is_guardian_of(parent, child)` | true | true | PASS |
| M13 | Anonymous / stranger reads the child's profile | nothing | `0` rows / `0` rows | PASS |
| M13b | Child changes their own birthday | refused | `BIRTHDAY_LOCKED` | PASS |

## Guards

| # | Check | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| M14 | `managed_accounts` read by parent / child / stranger | own rows only | all the parent's / 1 / 0 | PASS |
| M15 | Parent inserts into `managed_accounts` directly | refused | `42501 permission denied` | PASS |
| M16 | Parent ends the family link with a managed child | refused | `MANAGED_CHILD_DELETE_INSTEAD` | PASS |
| M17 | Deleting the parent's auth user while they manage a child | refused by the database | foreign-key violation on `managed_accounts_managed_by_fkey` | PASS |
| M18 | Deleting the child's auth user | cascades | `managed_accounts`, profile, birthday, link, controls all gone | PASS (see note) |
| M19 | Signed-in insert / update on `player_profiles` | refused | `42501 permission denied` for both | PASS |

Note on M18: the test deleted the auth user directly. `legal_consents` rows and
the `account_profiles` player row are not foreign-keyed to `auth.users`, so a
direct delete leaves them — true for every account today, not only managed
children. The app's delete path (`purgeUserAccount`) now removes the
`account_profiles` rows explicitly; `legal_consents` rows are kept as the
consent record, as before.

## Applying the migrations and publishing

The migrations are applied through Lovable (`docs/supabase-cli.md`), which is a
separate step from publishing the app, so for a while the new code may run
against a database without the new table, column and functions. Ordinary
accounts must not notice, and this was made so after review found one case that
would have broken them:

- **Published before the migration:** "Add your child" answers "isn't available
  yet" without creating anything, and account deletion behaves as before. The
  Terms/Privacy acceptance never names `legal_consents.accepted_by` for an
  ordinary account (PostgREST rejects a column that does not exist even when its
  value is null, which would have broken every signup and re-accept).
  `managed-children.test.ts` pins all of this.
- **Migrated before publishing:** the previously published Add Player screen can
  no longer create `player_profiles` rows (writes are revoked). That screen wrote
  rows nothing read, so nothing of value is lost.
- **Recommended order:** apply both migrations, run the checks below, then
  publish.

Do not use `supabase db push` for this: Lovable does not record what it applies
in the CLI's history (older migrations sit in `supabase_migrations.schema_migrations`
under Lovable's own names; the current tool tracks them in
`drizzle.__drizzle_migrations`), so the CLI can try to replay history the
database has already moved past (see the note in `docs/supabase-cli.md` and the
back-fill history behind it). Ask Lovable to apply the two files, in order,
exactly as written. Its current tool saves its own copy of each migration under
`drizzle/migrations/` (see below); the copy is harmless because every statement
is written to be safe to run twice.

Read-only checks to run afterwards (SQL editor); each was run against the local
replay both before and after the migrations, and the expected result is the
"after" one:

```sql
-- 1. true
select to_regclass('public.managed_accounts') is not null as managed_accounts_exists;
-- 2. two rows: is_managed_account, provision_managed_child
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('provision_managed_child', 'is_managed_account')
 order by 1;
-- 3. one row: accepted_by
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'legal_consents' and column_name = 'accepted_by';
-- 4. false (true before the migration)
select has_any_column_privilege('authenticated', 'public.player_profiles', 'INSERT')
  as authenticated_can_insert_player_profiles;
-- 5. false, true (errors if the function is missing)
select has_function_privilege('anon', 'public.provision_managed_child(uuid,date,text,text,text,jsonb,boolean)', 'EXECUTE') as anon_can_provision,
       has_function_privilege('authenticated', 'public.provision_managed_child(uuid,date,text,text,text,jsonb,boolean)', 'EXECUTE') as authenticated_can_provision;
```

## Applied to the live database (2026-09-30)

Both migrations were applied to the production database through Lovable's agent.
The pull request was not merged yet, so the two files were not in Lovable's copy
of the repo; the exact SQL was pasted into the project chat instead, with an
instruction to run it unchanged, and each migration was held for approval before
it ran. The saved copies were then compared with the files in this repository:
`drizzle/migrations/0000_managed_children.sql` and
`0001_freeze_player_profiles.sql` are identical to
`supabase/migrations/20260930120000_managed_children.sql` and
`20260930121000_freeze_player_profiles.sql` except for the missing final newline.

Read-only structural checks afterwards, against the live database (no user data
read or written):

| # | Check | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| L1 | `public.managed_accounts` exists, row-level security on, one policy, no rows | yes | yes, on, 1, 0 rows | PASS |
| L2 | `is_managed_account`, `provision_managed_child` exist | both | both | PASS |
| L3 | `legal_consents.accepted_by` exists | yes | yes | PASS |
| L4 | `authenticated` can INSERT / UPDATE `player_profiles` | no / no | false / false | PASS |
| L4b | `authenticated` can still SELECT / DELETE `player_profiles` | yes / yes | true / true | PASS |
| L5 | `provision_managed_child` executable by `anon` / `authenticated` | no / yes | false / true | PASS |
| L6 | `player_profiles` keeps its four policies | 4 | 4 | PASS |
| L7 | `player_profiles` table comment marks it frozen | yes | "Frozen (read/delete only). Superseded by…" | PASS |
| L8 | `revoke_guardian_link` contains the managed-child guard | yes | yes | PASS |

Not yet done on the live database: the behavioural checks (M1–M19 through the
Data API with real user tokens) listed below.

**Repository side effects of Lovable's migration tool**, all on `main` and not
part of this pull request: it added `drizzle.config.ts`, `drizzle/schema.ts` (an
empty placeholder), `drizzle/migrations/` (the two SQL files, a journal and two
snapshots), the dev dependencies `drizzle-kit`, `drizzle-orm` and `postgres`
(with the matching `bun.lock` update), and regenerated
`src/integrations/supabase/types.ts` (identical to this branch's hand-added
types: merging `main` into this branch is conflict-free). It tracks the two
migrations in `drizzle.__drizzle_migrations` and did **not** record them in
`supabase_migrations.schema_migrations`. The schema history is therefore now
split across `supabase/migrations/` (the chain the replay tests and this
document use, and the only one that rebuilds a fresh database completely) and
`drizzle/migrations/` (what Lovable's tool applied). The overlap is harmless
because both copies are idempotent.

**A production migration that no branch held.** Reading production's migration
history for the checks above turned up `20260926155719`
(`monetization_surfaces_ship_off`), which `supabase_migrations.schema_migrations`
records as applied but which had no file in `supabase/migrations/`, on `main` or
on any other branch — the same kind of drift that commit `b09c2d7` back-filled
for three earlier migrations. Its `created_by` is NULL, so who applied it is not
recorded. It is unrelated to managed children; it is recorded here only because
it was found while checking.

It is now in `supabase/migrations/20260926155719_monetization_surfaces_ship_off.sql`,
under production's exact version, with production's stored statement as its
body. Checked:

- The body is byte-identical: its md5 (`1b707e78b26580751d77ca10d4b8b123`) equals
  `md5(array_to_string(statements, E'\n'))` for that version in production.
- The whole chain (288 files, this one included) applies on the local
  Postgres 16 replay. Without the file, the chain leaves `subscriptionsEnabled`,
  `merchShopEnabled` and `upgradePromptsEnabled` ON; with it they end OFF, and
  those are the only three values in the `monetization` setting that change.
- A second run changes nothing. A configuration an admin has changed is left
  alone (each of seven variations tried: Free Mode off, payments on, checkout
  on, premium features on, and each of the three surfaces already off), and it
  applies cleanly when the `monetization` row is absent.
- Production already shows the result. Its live `monetization.access` (one row
  of app configuration, read-only, no user data) is identical to the replay's
  result with this migration applied, and the row was last updated on
  2026-09-26 at 16:00 UTC, a few minutes after the migration's version timestamp
  (15:57). Nothing was written to production: the statement and that one row
  were only read.

## Still to run on the live backend

Run these against the dev/E2E project first where possible, with real user
tokens as in the earlier verification documents:

1. `admin.createUser` accepts an `@managed.invalid` address with no password,
   and `auth.admin.generateLink({ type: 'magiclink' })` returns a
   `hashed_token` **without** calling the send-email hook.
2. M1–M19 above through the Data API.
3. `startManagedSession`: refused for an unrelated adult, for a managed child's
   own token, and for a child with their own login (`NOT_MANAGED`); the returned
   token redeems with `verifyOtp({ type: 'email' })` into the child's session.
4. Sections E and F of the final-verification document with a managed child as
   the subject.
5. `e2e/managed-child.spec.ts` (it skips itself until the migration is present).

## Known limitations

- A child session can call `updateUser({ password })` directly and give the
  account a working password; GoTrue has no server-side way to refuse it. The UI
  never offers it (Security settings are hidden, `/account/security` redirects),
  and every control still applies because the actor is still the child. An email
  change from a child session cannot complete as long as email changes require
  confirmation (the project's auth setting): the auth-email hook never sends mail
  for a placeholder address, so the confirmation link never arrives.
- The guardian's session is parked in the browser while they act as the child.
  If another tab rotates that refresh token outside Supabase's reuse window,
  switching back falls back to signing in again.
- Switching back to the guardian is one tap, not a lock. A PIN-protected kid mode
  is a possible later addition.
- Consent is recorded with method `email_confirmation` (the same as an invite
  accepted from a signed-in adult account) and scope
  `{guardian_attested: true}`. Counsel sign-off on the verifiable-consent method
  is still required (P0 in `child-teen-compliance-audit.md`).

This records observed behaviour of specific controls. It is not a legal
compliance certification for COPPA, GDPR-K or any other regime.
