# Production runbook: hotfix 20261102100000 (payment-settings writes)

One migration, `supabase/migrations/20261102100000_hotfix_payment_settings_writes.sql`, applied whole and ahead of
the privacy release. Every database step needs the owner's approval. Nothing here deploys the app: the hotfix has no app
change.

## 1. Why now

The hole is live in production; checked read-only on 2026-11-05.

- **The gap.** The INSERT and UPDATE policies on `public.game_payment_settings` check only `host_id = auth.uid()`. They
  do not check that the caller hosts the game.
- **How it is abused.** `enforce_game_join_gate` reads `requires_approval` and `entry_fee` from the newest settings row
  of a game. Any signed-in account can add a row `{ game_id: <someone else's game>, host_id: <itself>,
requires_approval: false, entry_fee: 0 }`, then insert itself into that game's participants with no host approval.
- **Who is exposed.** Youth games too, and it works while payments are switched off.
- **Exploited so far?** No. When checked, production had no settings row held by anyone but its game's host.

The full fix ships in the release as `20261103140000_payment_settings_host_guard` (PR #250, merged to `main`). It also
rewrites the join gate, the payment functions and the payment
trigger. That is far more than this hole needs.

**What the hotfix does.** It is only the write half of #250: the two helpers `private_sec.game_payee` and
`private_sec.can_manage_game_payment_settings`, plus the two write policies. Names, bodies and grants are byte-for-byte
#250's, so the release later re-creates them unchanged.

**Why the write half is enough.** Once only the host can write, every row is the host's. The readers that still take
"the newest row" are then correct, so the hotfix does not touch them.

**The guard.** The migration ends with a check. If any row is held by someone other than its game's host, it stops
(`HOTFIX_STOPPED`) and applies nothing.

**What it does not change.** No row is changed. Hosts keep creating and editing their own settings exactly as the app
does today: the app inserts the `hosted_games` row first, then upserts settings for it.

## 2. Before any step

- **The approved commit.** Check out the PR head the owner approved. The migration text must be byte-identical:
  - sha256 `8f98b616…fc8c`, 53 lines;
  - it starts with `-- Hotfix: only a game's host may write that game's payment settings.`
- **Backup.** Note the time and confirm a point-in-time backup covers it (Lovable Cloud / Supabase dashboard).

## 3. Steps

### A. Pre-check (read-only)

Through Lovable's database tool, run the statement between `SET LOCAL search_path = '';` and `ROLLBACK;` in
`docs/release/hotfix-payment-settings-precheck.sql`. It is a single SELECT.

Every `ok` must be true: 12 rows. On 2026-11-05 production returned 12/12.

If the foreign-row count is not 0, stop. Someone has used the hole. Investigate those rows before going further; the
hotfix would refuse anyway.

### B. Apply through Lovable _(owner approval)_

Send Lovable the file's exact text and ask it to apply it with its migration tool, unchanged.

- **The record.** Lovable runs it in one transaction and records `sha256(text)` in `drizzle.__drizzle_migrations`. It
  writes no `supabase_migrations` row. It then commits a drizzle copy to the repository.
- **Why that copy is skipped.** The release preflight's pinned history (#294 follow-up) recognises that copy by hash,
  so the release replay skips it, the same way it skips #287's.
- **If the text was changed.** Lovable may strip comments or reformat. If so, the verify step's ledger row reports
  `not recorded`. Do not re-apply. Compare what Lovable ran with the file; the catalog rows still show whether the
  policies are in place.

### C. Verify (read-only)

Run the statement in `docs/release/hotfix-payment-settings-verify.sql` the same way. All 10 rows must be ok. The
function and policy hashes are from a PG17 replay, and the ledger row accepts the file hash with or without its final
newline.

### Alternative: a direct `postgres` connection

`psql -X -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations/20261102100000_hotfix_payment_settings_writes.sql`,
then add the ledger row with the release ledger template, then run both check files with psql.

## 4. Rollback

`docs/rollbacks/20261102100000_hotfix_payment_settings_writes.down.sql` is one `DO` statement, so it can be sent through
Lovable's database tool or run with psql.

- **What it does.** It restores the two policies exactly as production had them and drops the two helpers.
- **Why you would rarely want it.** It reopens the hole. Use it only if the hotfix breaks host settings.
- **What stays.** The ledger row stays.

## 5. What was rehearsed (local, 2026-11-05)

**The production model.** A replay of `main` without the release range (`20261103*` to `20261108*`). Its four
`game_payment_settings` policies have the same md5s as production's, read-only.

**The rehearsal scripts.** The PG16/PG17 rehearsal is a session tool, not in the repository:
`/tmp/claude-0/-home-user-ballacity/6077ac3f-6266-5ad6-b242-855a0f5d2664/scratchpad/tools/hf250_rehearse.sh`. It
emulates Lovable's migration tool as "run the text in one transaction, record sha256(text) in the drizzle ledger".

| Step                                                               | postgres:17 (170011)                                                            | postgres:16 (160015)      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------- |
| Pre-check on the production model                                  | 12/12                                                                           | 11/12 (server major only) |
| Apply as Lovable does                                              | exit 0                                                                          | exit 0                    |
| Verify                                                             | 10/10                                                                           | 9/10 (server major only)  |
| Verify with the hash of the text without its final newline         | 10/10                                                                           | 9/10                      |
| `341_payment_settings_write_hotfix` on the result                  | 10/10                                                                           | 10/10                     |
| Rollback, one statement                                            | catalog equals pre-hotfix exactly                                               | same                      |
| Test 341 after rollback (negative control: the bypass works again) | 4 passed, 6 failed                                                              | same                      |
| Re-apply after rollback; apply twice                               | catalog equals post-hotfix; idempotent                                          | same                      |
| A foreign row present                                              | `HOTFIX_STOPPED`, catalog unchanged, no ledger row; the pre-check shows count 1 | same                      |
| A comment-stripped text applied instead                            | policies ok; ledger row `not recorded`                                          | same                      |

**Without the hotfix.** On the production model, test 341 fails 6 of 10: a stranger writes `requires_approval=false`
for the host's game and joins it.

**On `main`.** `bun run test:db` (every migration, this hotfix then #250) passed 961/0 on PG16 and on PG17.
