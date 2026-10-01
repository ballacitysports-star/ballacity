# Guardian as a first-class account type — verification

Makes `parent` a real `profiles.account_type`/`account_profiles.kind` value,
replacing the "a guardian is stored as a player" mapping that caused the
originally reported bug. See `supabase/migrations/20261001130000_parent_account_type.sql`,
`supabase/migrations/20261001140000_backfill_parent_account_profiles.sql`,
`src/lib/account-type.ts`.

## Undocumented drift found while preparing this change

Querying the live database (read-only, before writing anything) turned up a
second CHECK constraint on `profiles.account_type` —
`profiles_account_type_valid` — that no file in `supabase/migrations/` ever
created. `supabase_migrations.schema_migrations` records it as version
`20260725025124`, `created_by apikey@lovable.dev`, applied directly to
production with no corresponding commit — the same kind of drift
`20260926155719_monetization_surfaces_ship_off.sql` documented for an
unrelated setting a month later. Back-filled as
`supabase/migrations/20260725025124_profiles_account_type_valid.sql`, body
byte-identical to production's stored statement (md5 `a25e6248b2cbf8c887a9f3df7c29b6a5`,
matching `md5(array_to_string(statements, E'\n'))` for that version in
production; confirmed locally after stripping the file's own trailing
newline, which production's stored value doesn't have).

This mattered beyond bookkeeping: `profiles_account_type_check` (the
constraint every prior migration touching this column names explicitly) and
`profiles_account_type_valid` (this undocumented one) enforce the same
four-value list independently. Widening only the first and missing the
second would have left `'parent'` silently rejected by the one nobody knew
about.

## Local replay

Full migration chain (288 files, plus these three) replayed on Postgres 16
with the same Supabase stubs prior verification docs in this repo use. Cast:
`parent` = `11111111-1111-1111-1111-111111111111` (the existing managed-children
replay fixture, already guardian to two managed children before this change).

| # | Check | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| G1 | `profiles.account_type`: `'parent'` accepted, an invalid value still rejected | accept / reject | accepted; rejected with `profiles_account_type_check` violation | PASS |
| G2 | `account_profiles.kind`: `'parent'` accepted, an invalid value still rejected | accept / reject | accepted; rejected with `account_profiles_kind_check` violation | PASS |
| G3 | `account_profiles_parent_uniq`: a second `'parent'` row for the same user | first succeeds, second rejected | first OK; second: `duplicate key … account_profiles_parent_uniq` | PASS |
| G4 | `handle_new_user()`: a real `auth.users` insert with `account_type: "parent"` in signup metadata | `profiles.account_type = 'parent'` | `parent` | PASS |
| G5 | `handle_new_user()`: an unrecognised `account_type` value | still silently nulled, not rejected (existing behaviour, unchanged) | `account_type IS NULL` | PASS |
| G6 | Backfill: the fixture guardian (2 pre-existing managed children, from before `'parent'` existed) | exactly one `account_profiles` row, `kind='parent'` | exactly one | PASS |
| G7 | `provision_managed_child()`: a guardian who already has a `parent` profile (from G6's backfill) provisions a second, new child | the new inline insert is a no-op — still exactly one `parent` row, not two | `parent_rows_before` 1, provision succeeds (`child_under_13`), `parent_rows_after` 1 | PASS |

Two corrections recorded, not hidden: G5 and an earlier G7 attempt first
failed against UUIDs that turned out to already exist in this long-reused
replay database from unrelated earlier testing this session — a test-fixture
collision, not a migration defect — re-run with freshly generated ids. A
separate first G7 attempt also failed on `LEGAL_VERSION_STALE` using a
hardcoded version string (`2026-09-11`) that had drifted from this replay's
actual current published legal document version (`2026-09-01`) by the time
this test ran; re-run with the correct version succeeded. Neither correction
touched the migration itself.

Confirmed already covered without a dedicated check: a brand-new guardian's
*first* `account_profiles` insert (no prior conflict) is the same
`INSERT … ON CONFLICT DO NOTHING` statement the backfill script's own run
already exercised successfully (`INSERT 0 2`, two fresh rows, zero
conflicts) — G7 specifically covers the complementary "already exists, no-op"
branch.

## Still to run

- **Apply through Lovable's chat with per-statement approval on the canonical
  project — not done yet, holding for explicit go-ahead, same as every prior
  migration this session.** Order: `20260725025124_profiles_account_type_valid.sql`
  first (back-filled drift — establishes the pre-existing narrow constraint
  the next file expects to find, matching production's own actual history),
  then `20261001130000_parent_account_type.sql`, then
  `20261001140000_backfill_parent_account_profiles.sql`.
- Read-only structural checks after applying (mirroring the checks already
  proven in the replay above): both widened `profiles` constraints, the
  widened `account_profiles_kind_check`, `account_profiles_parent_uniq`'s
  definition, and the backfill's actual row count against the live
  `managed_accounts` table.
- A real signup through "Parent / Guardian" on the published app, once the
  TypeScript changes in this same feature are also live — this doc only
  covers the database side.
