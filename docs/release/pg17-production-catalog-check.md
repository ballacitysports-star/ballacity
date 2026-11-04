# PostgreSQL 17 manifest and production catalog check (2026-11-04)

Status: **evidence only. Nothing in the checked-in manifest was replaced or allow-listed.** The preflight stays fail-closed
against production until the owner approves the reviewed decisions listed at the end.

## 1. PG17 manifest from CI, independently verified

- CI run: "Release preflight (PG17)" run 41916917377, job 126878913297, on `claude/release-preflight` at 8cfda9a6
  (PostgreSQL 17.11, `server_version_num` 170011). Self-tests: 58/58 pass.
- The artifact download is blocked from the review environment (egress proxy 403), so the workflow also prints the manifest
  into its log (gzip+base64). The coordinator rebuilt it from the log and computed `sha256 = e574cbc4d5062ea3ba6c58f38087fbaea109d4433b69f02ac523c89e160f1573`,
  identical to the `M17_SHA256` line and to the `sha256sum` step summary printed by the job. Majors in the file: `17` only.
- Scope: this manifest covers this branch's 24 release migrations. The full release (33 migrations on the combined build)
  needs the same run on the final integration tree before rehearsal.

## 2. Production (PostgreSQL 17.6) compared with the PG17 "before" expectations

Read-only catalog queries only (hashes of `pg_get_functiondef`, policy expressions, owners, ACLs, triggers, policy names;
no row data), run with `search_path = ''` exactly as the preflight reads a target.

| Area                                                 | Result                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 24 protected functions that exist before the release | **17 match exactly** (definition md5, owner, SECURITY DEFINER, search_path, ACL). No difference attributable to 17.6 vs 17.11 was observed.                                                                                                                                                                                  |
| Already partially applied (recognized)               | `enforce_gym_review`, `review_ring_suspects` equal their drift-capture states (20261103101000 / 102000); `enforce_review_integrity`, `player_trait_counts`, `review_question_keys`, `review_tag_keys` equal the state after 20261103110000 (a drift capture). These are expected by `drift_captures`.                        |
| **Unrecognized (preflight will fail, by design)**    | `enforce_skill_vote()`, `my_reviewable(text,text)`, `settle_paid_spot(text,uuid,text)`: production bodies are the repository bodies **with the inline `--` comments removed** (verified line by line against `20261012150000`, `20261012120000`, `20261008170000`). Behaviourally identical; byte-different, so md5 differs. |
| Policies (23)                                        | All present ones match exactly; the rest are absent as expected.                                                                                                                                                                                                                                                             |
| Tables: RLS / force RLS / policy names               | Match.                                                                                                                                                                                                                                                                                                                       |
| Tables: triggers                                     | Production lacks `bump_helpful_count_trg` on `review_helpfuls` (the replay creates both it and `trg_review_helpfuls_count`). `storage.objects` has platform triggers (`protect_objects_delete`, `update_objects_updated_at`) that the local Supabase stub does not create.                                                   |
| Tables: ACLs                                         | Production grants `INSERT, SELECT` on every listed public table to role **`sandbox_exec`** (login, BYPASSRLS, not a superuser; `postgres` is a member), which the replay does not have. `storage.objects` ACLs differ because the stub models only `postgres`. `MAINTAIN` (PG17) is present in both.                         |

## 3. Consequences for the release preflight

- Against production today the preflight **fails closed** on: the three comment-stripped functions, the `review_helpfuls`
  trigger set, every table ACL (because of `sandbox_exec`), and `storage.objects` triggers/ACL. That is the intended behaviour.
- **Never** replace expected hashes with production or test hashes wholesale. The reviewed options are:
  1. Comment-stripped functions: record them as `known_equivalent_drift` entries (production md5 + the evidence above),
     approved by the owner, or re-apply the repository definitions in production through a separately approved migration.
  2. `review_helpfuls`: production already equals the state after release migration `20261103100000_single_review_helpfuls_trigger.sql` (its header documents that the duplicate `bump_helpful_count_trg` was removed by hand in production). It is not in the manifest's `drift_captures` list, so the preflight flags it; the reviewed fix is to add `20261103100000` to `drift_captures` with that evidence.
  3. `sandbox_exec`: confirm with the hosting platform what this role is and who holds its credentials. If it is the
     platform's query role, model it as a known platform grant in the preflight (a named, reviewed exception), not as an
     ignored difference.
  4. `storage.objects`: compare ACLs and triggers only against platform-verified expectations taken from the verified
     sandbox (a Supabase project of the same version), never from the local stub.
- The full 33-migration manifest must be generated on PG17 from the final integration tree and these exceptions reviewed
  before any production preflight run.

## 4. Ledger name rule checked against production (2026-11-04, read-only)

Every Lovable-named production ledger row (`<timestamp>_<uuid>`) has a version **after** the timestamp in its name;
none is earlier. R5 review finding F5 restricts the preflight's name rule to rows 0 to 10 s after a **historical**
file's timestamp, which closes a duplicate row placed just before the release range.

Three production rows are further than 10 s from their file, both before and after this change (the old rule used
the absolute skew with the same 10 s limit), so the preflight **fails closed** on them today:

| Ledger row       | File                                                      | Skew |
| ---------------- | --------------------------------------------------------- | ---- |
| `20260718214541` | `20260718214528_cbc407df-c6aa-4df5-ba2f-ae581526bc09.sql` | 13 s |
| `20260719230101` | `20260719230031_a66617fa-84dc-4481-a23a-414363a80e97.sql` | 30 s |
| `20260722230218` | `20260722230205_a28148a8-85b7-49cf-a15f-fd379cced385.sql` | 13 s |

Reviewed option (owner approval, like section 3): list these three exact (version, name) pairs in the manifest's
`known_ledger_rows_without_file` and the three files in `known_unledgered`, after comparing each file's objects with
production. Do **not** widen `LEDGER_NAME_SKEW_SECONDS`.
