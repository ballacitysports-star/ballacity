# Release preflight

`scripts/release-preflight.mjs` checks a target database against `docs/release/release-manifest.json` before the
privacy release migrations are applied by hand (runbook sections 2 and 6), and again afterwards with `--verify-after`.
It is read-only: every query runs in one `BEGIN READ ONLY` transaction with `default_transaction_read_only = on`, and
the tool aborts unless the session reports `transaction_read_only = on`. It never inserts a ledger row and never runs a
migration file against the target. `node scripts/release-preflight.mjs --help` lists every option.

| Command                                                                     | What it does                                                         |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `bun run preflight -- --offline`                                            | manifest against the checkout (sha256s, order, allow-lists); no DB   |
| `bun run preflight -- --db-url <url>`                                       | pre-release check of a target; prints the exact pending list         |
| `bun run preflight -- --db-url <url> --verify-after`                        | post-release check: everything applied, every protection = after     |
| `bun run preflight -- --write-manifest --from 20261103100000`               | regenerate the manifest on the LOCAL Postgres (scratch DB, dropped)  |
| `bun run preflight -- --merge-hashes <other.json> [--manifest <base.json>]` | add another major's hashes (e.g. the PG17 CI artifact) to a manifest |
| `bun run preflight:test`                                                    | self-tests on the local Postgres (scratch DBs, dropped)              |

## Running against production (read-only, only after separate approval)

Running the preflight against production is a production read and needs its own, separate written approval from the
release owner, even though it writes nothing. Approval to run it is not approval to apply anything.

1. Use the manifest that carries hashes for production's major (17): the checked-in manifest after the PG17 hashes
   are merged (see below), at the reviewed commit. Check `generated.majors` contains `"17"`.
2. Run `bun run preflight -- --offline --manifest <that manifest>` from the same checkout. It must pass.
3. Use a read-only database role if one exists. Pass the URL through the environment so it is not in shell history:
   `PREFLIGHT_DATABASE_URL='postgresql://…?sslmode=require' bun run preflight -- --manifest <manifest> --json > preflight-pre.json`.
   Ambient `PG*` variables are ignored, the URL and password are never printed, and `sslmode=require` is the default
   for non-local hosts.
4. Exit 0 means every check passed and prints the pending list in apply order. Exit 1 means a check failed: stop,
   do not apply anything, and take the named object or row to the owner. Exit 2 is a usage or connection error.
5. Keep the JSON report with the release record. After the release, run again with `--verify-after`; it must exit 0.

## The 16-vs-17 rule

Protected functions and policies are compared by md5 of `pg_get_functiondef` and of the `pg_policies` expressions.
Those are deparsed text and can differ between Postgres majors (for example `BEGIN ATOMIC` bodies and policy
expressions), and default ACLs differ too (Postgres 17 adds the `MAINTAIN` table privilege), so a recorded state is
only ever compared on the major it was generated on:

- Every recorded state in the manifest is keyed by major: `expect_before: { "16": state, "17": state }`, likewise `expect_steps`
  and `expect_after`; `generated.majors` lists the majors present.
- If the target's major is not in `generated.majors`, both the default run and `--verify-after` **fail**. They do not
  warn and do not fall back to another major.
- The local machine has Postgres 16 only, so the checked-in manifest is generated on 16. Production runs 17.11, so
  production needs the PG17 hashes from CI, merged into the manifest.
- The self-tests generate their own manifest on whatever server they run on (in `before()`), so they pass on 16 and
  17 alike. The checked-in manifest is checked offline and compared structurally with that regeneration (and hash for
  hash when it carries the current major).

## Fail-closed rules

Every check below fails (exit 1) and names the object or row; none of them is downgraded to a warning. The checks
cover exactly the ledger rows, files and protected objects listed here. Objects the release does not touch (other
functions, tables, roles, extensions, column grants, buckets the release does not create) are **not** checked.

**Protected objects and what is compared.** The manifest lists, per Postgres major, the state of:

| Kind      | Which objects                                                                                                                                                                    | State compared                                                                                                                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Functions | every function a release file creates, alters or grants/revokes on, and every function whose state any release file changes in the replay                                        | md5 of `pg_get_functiondef`, owner role name, `prosecdef`, the `search_path` in `proconfig`, and the ACL as sorted `grantee:PRIVILEGE` pairs from `aclexplode` (grantor dropped, `NULL` expanded to the default) |
| Policies  | every policy a release file creates or alters                                                                                                                                    | md5 of `qual`, of `with_check`, and of `cmd`, `permissive` and `roles` together (from `pg_policies`)                                                                                                             |
| Tables    | every table a release file creates, alters, grants/revokes on, or puts a trigger or policy on; every table whose state a release file changes; every table of a protected policy | `relrowsecurity`, `relforcerowsecurity`, the normalized ACL, every non-internal trigger (name, function, `tgtype`, `tgenabled`), and the **full** set of policy names, so an extra policy fails                  |
| Buckets   | every `storage.buckets` row a release file creates or changes                                                                                                                    | `public`                                                                                                                                                                                                         |

The replay runs as role `postgres` (the role production's migrations are applied as), so owners and ACLs in the
manifest name `postgres`. Platform objects the release only touches (for example `storage.objects`, which gets
release policies) are recorded as the Supabase stub (`supabase/tests/support/supabase-stub.sql`) creates them. If a
real project's owner or grants on such an object differ, the first run fails and names the field; resolve it by a
reviewed manifest or stub change, never by hand at release time.

| Rule                 | Fails when                                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server               | the target's major is not 16 or 17; schema `supabase_migrations` or its `schema_migrations` table is missing                                                                                          |
| Hash major           | the manifest has no hashes for the target's major (default run and `--verify-after`)                                                                                                                  |
| Manifest             | a release file changed (sha256), is missing, unlisted, duplicated or out of order; manifest format is not 2                                                                                           |
| Ledger gaps          | a later release migration is applied while an earlier one is not                                                                                                                                      |
| Ledger content       | a release-range row's `name` is not the file stem (or the part after the version, the Lovable stem rule), its `statements` is empty or NULL, or `sha256(statements[1])` is not the manifest sha256    |
| Unknown ledger rows  | any row, before or in the release range, whose version matches no file in `supabase/migrations` or the drizzle journal, and is not a Lovable row (see below) or in `known_ledger_rows_without_file`   |
| Unknown drizzle rows | a `drizzle.__drizzle_migrations` row matching no journal file (hash or `created_at`) and not in `known_drizzle_rows_without_file`                                                                     |
| Unledgered history   | a file before the release range has no ledger row and is not in `known_unledgered` (the 71 files of runbook section 1, with their reviewed sha256); a drizzle journal file with no drizzle ledger row |
| Regression           | a pending release migration would redefine an object whose later definition is already applied                                                                                                        |
| Protection state     | a protected function, policy, table or bucket (table above) is not in the state the ledger implies (below)                                                                                            |
| Dependencies         | a pending migration's required function, table, schema or earlier migration is neither in the target nor provided by an earlier pending migration                                                     |

**Recognized protection states.** The replay records each protected object before the release range
(`expect_before`, `null` = absent), after each of its defining migrations (`expect_steps`), and after the range
(`expect_after`). For the target's ledger:

- none of its defining migrations applied: it must equal `expect_before`, which means absent when a pending migration
  creates it;
- some applied: it must equal the snapshot after the last applied defining migration;
- all applied: it must equal `expect_after` (`--verify-after` requires this for every object).

One explicit exception: `drift_captures` (runbook section 1a) are release migrations that write down a hand fix
production already has. While a capture is the next pending definer, the target may already hold the captured
definition. The `def` md5 the replay records for `enforce_gym_review()` after `20261103101000` is `1c776a86…`, the
production md5 in runbook 1a; its owner and ACL must match too (`postgres`, EXECUTE for `postgres` and `service_role`).

**Ledger matching.** Release migrations are matched by version (each gets its own ledger row at release), and the row
must be the one the runbook writes (section 2; the per-file template in `docs/release/r4-staging-rehearsal.md`
section 4): `name` = the file stem and `statements` = `ARRAY[<file content>]`. The preflight hashes `statements[1]`
and accepts it when it equals the manifest sha256 of the file, either byte for byte or after adding back the one
trailing newline that psql's backquote expansion (`` \set content `cat <file>` ``) removes. Release rows are never
written without statements, so an empty or NULL `statements` fails. Historical Lovable rows carry a version one or two
seconds after the file's timestamp and the file stem as `name`
(`docs/migration-history-reconciliation.md` section 1); a row is matched to such a file only by its stem and only within
10 seconds. The two ledger rows whose files Lovable removed (`20260708185350`, `20260725025124`) and drizzle ledger row
22 are listed by version and name or by hash and `created_at`, with their evidence.

**Expect a first production run to be strict.** The ledger names were not part of the 2026-11-03 inventory. If production
stores them differently, the run fails and names every row it cannot match. Read those rows, and have the owner
review them. Change the manifest's allow-lists or matching only through a reviewed commit, never by hand at release time.

## Pinned history: hotfixes dated before the release range

A hotfix that ships to production ahead of the release is dated before `release_range.from` (today:
`20261031120000_close_live_write_holes.sql`, PR #287). The ledger only proves that _a_ row exists for a historical
version, not which text was applied, so the manifest pins these files in `pinned_history` (version, path, sha256,
basis; generated from `PINNED_HISTORY` in the script):

- **Offline:** the file must still have the pinned sha256, and any migration dated after the newest `known_unledgered`
  file and before the range must be pinned. A new backdated file fails as "unpinned history".
- **Online:** the target must record exactly the pinned text, in either ledger:
  - its ledger row for that version: `statements[1]` hashes to the pinned sha256, with the same rule as release-range
    rows (the release template, applied with psql);
  - or a `drizzle.__drizzle_migrations` row whose hash is the pinned sha256, or the sha256 of the file without its one
    trailing newline. Lovable's migration tool stores the sha256 of the exact SQL it ran (`docs/supabase-cli.md`). The
    report then carries a warning saying the hotfix was recognized this way.

  An older version, a ledger row written without the text, or a drizzle row for any other text fails. That drizzle row
  is reported as unknown, and the hotfix as unrecognized history.

So apply the hotfix either with the release ledger template (runbook section 2: name = the file stem,
`statements = ARRAY[file content]`), or through Lovable with the file's exact text, unchanged
(`docs/release/hotfix-286-287-runbook.md`, PR #287). If a hotfix is changed before it ships, regenerate the manifest; once it is
applied, its file must not change.

## PG17 manifest from CI

The workflow **Release preflight (PG17)** (`.github/workflows/release-preflight.yml`, job "Release preflight on
Postgres 17") runs on pull requests that touch `scripts/release-preflight*`, the manifest, `supabase/migrations/**`,
`drizzle/migrations/**`, `docs/migration-evidence/**` or the workflow, and on manual dispatch. It is not a required check. On a `postgres:17` service it:

1. runs `bun run preflight:test`;
2. regenerates the manifest (`--write-manifest --from <release_range.from> --manifest /tmp/m17.json`) and checks it
   offline;
3. merges those hashes into a copy of the checked-in manifest (`/tmp/release-manifest-merged.json`);
4. prints the server version and the sha256 of both files in the job log and the run summary;
5. uploads both as the artifact `release-preflight-manifest-pg17` (30 days).

To use it:

1. Open the run for the release commit (Actions, "Release preflight (PG17)"), and check that it is green and that the
   summary shows server 17.x.
2. Download the artifact: `gh run download <run-id> -n release-preflight-manifest-pg17 -D /tmp/pg17`.
3. Check that `sha256sum /tmp/pg17/m17.json` equals the sha256 in the run summary.
4. Merge it into the checked-in manifest from the same commit:
   `bun run preflight -- --merge-hashes /tmp/pg17/m17.json`. This is refused unless both manifests list identical
   migrations, sha256s, requires/provides, protections, `defined_by` and allow-lists.
5. Run `bun run preflight -- --offline`, review the diff (it only adds `"17"` keys), and commit it through review.
   Then `generated.majors` holds `16` and `17`.

## Regenerating the checked-in manifest

Regenerate it after any change to a release migration, on the local Postgres 16:
`bun run preflight -- --write-manifest --from 20261103100000`. Then run `bun run preflight -- --offline` and
`bun run preflight:test`. Regenerating drops the other majors' hashes, so merge the PG17 artifact from a CI run on the
new commit again.
