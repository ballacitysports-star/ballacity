# Release record: P0-1 reconciliation and the safety batch (production, 2026-11-07)

Production project `cpqihhcqeivbgxqbzatv` (Lovable project "BallaCity"). Every database step below was approved by
the owner in the session at the time it was taken. This record holds catalog facts, hashes and counts only. It holds
no user data.

## Route

Production's own Supabase Management API refused this session's token (`database_read` missing). Every query and every
apply went through Lovable's database tool (`query_database`) on the published project, the tool the runbooks name.

- **One transaction per file.** A probe confirmed that the tool runs a multi-statement string as one transaction: a
  transaction-local setting was visible to the next statement. So a failed file leaves nothing behind.
- **Exact text.** Each migration was sent exactly as committed: no `BEGIN`/`COMMIT` added, and the sha256 was checked
  against `main` first.
- **Ledger rows.** This route writes no ledger row of its own. Each file's `supabase_migrations.schema_migrations` row
  (`statements` empty, per the reconciliation template) was added after it was applied.

## Steps

| #   | Step                                                                                                                               | Approval                                  | Result                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | P0-1 pre-check (`docs/release/p0-1-precheck.sql`, read-only)                                                                       | owner allowed read-only production access | 32/32 ok. Postgres 17. Both "hole used" counts 0. None of the seven recorded                                                                            |
| 2   | Extra read-only check                                                                                                              | (same)                                    | `20261106120000_game_join_policy` missing on production too. Supabase ledger: 288 rows, none since 2026-10-20. Drizzle ledger: 35 rows, last 2026-11-05 |
| 3   | P0-1 step B: apply 7 files plus `game_join_policy`                                                                                 | owner: "yes" to step B                    | All 8 applied without error. Both counts re-checked at 0 right before the payment fix                                                                   |
| 4   | P0-1 step C verify (read-only)                                                                                                     | none needed                               | 45/52 before ledger rows. The 7 failures were the "recorded" rows only. `get_game_join_policy` md5 `3f1fb160…` = main                                   |
| 5   | P0-1 step D, group D: 8 ledger rows                                                                                                | owner: "yes"                              | Ledger 288 → 296. Verify 52/52                                                                                                                          |
| 6   | Safety-batch pre-check (`docs/release/safety-batch-precheck.sql`, read-only)                                                       | none needed                               | All gating rows ok (see the counts below)                                                                                                               |
| 7   | #332 telemetry age-gating: merge, apply, ledger row                                                                                | owner: safety batch "yes"                 | 11/11 ok. Ledger 297                                                                                                                                    |
| 8   | #300 authenticated oracles and role writes: merge, apply, ledger row                                                               | (same)                                    | 18/18 ok. `user_roles` rows unchanged (3). Ledger 298                                                                                                   |
| 9   | #314 under-13 self-registration: merge, apply, ledger row                                                                          | (same)                                    | Function md5 = main. Existing under-13 row untouched (1). Ledger 299                                                                                    |
| 10  | #330 youth venue privacy: merged on owner instruction. Owner published the app, then the migration was applied with its ledger row | owner: "merge #330", then "published"     | 11/11 ok. Ledger 300                                                                                                                                    |
| 11  | Safety-batch verify (`docs/release/safety-batch-verify.sql`, read-only)                                                            | none needed                               | **38/38 ok**                                                                                                                                            |

### Order

- **#300 and #314 went in before their app changes were published.** That differs from the runbook's "app first". It was
  checked first and is safe for both:
  - #300's app change is a label ("Age not shared" → "Age not shown") and comments. The published app already treated a
    missing age as not shown. It never calls the three revoked messaging functions and never writes `user_roles`.
  - #314 makes the database refuse an under-13 self-set birthday. The only cost before the app was published was a raw
    error message instead of the friendly one.
- **#330 had to wait for the publish.** It withdraws client `select *` on `team_posts`.
  - Before applying, production's `team_posts` columns were checked against the app's `TEAM_POST_PUBLIC_COLUMNS`. They
    are exactly the 23 app columns plus the 5 venue columns.
  - This session could not fetch the live site (the proxy refuses it). The publish was confirmed by the owner, and
    Lovable's latest commit (`9cc42d2b`) includes #330.

## Files applied

| Version        | File                                    | sha256 (first 12) |
| -------------- | --------------------------------------- | ----------------- |
| 20261103100000 | single_review_helpfuls_trigger          | c7040ea0de8b      |
| 20261103101000 | capture_enforce_gym_review              | 553ced7669d0      |
| 20261103102000 | capture_review_ring_suspects            | cadae5a3d139      |
| 20261103103000 | revoke_enforce_skill_vote_execute       | 2d1258558f49      |
| 20261103104000 | revoke_enforce_review_integrity_execute | 3b76ac3b4130      |
| 20261103130000 | profile_insert_guard                    | 2194cbdc6229      |
| 20261103140000 | payment_settings_host_guard             | 5c74b31e9ca9      |
| 20261106120000 | game_join_policy                        | 03e754b6d817      |
| 20261106200000 | telemetry_age_gating (#332)             | f028cc1a8cbb      |
| 20261106150000 | close_authenticated_oracles (#300)      | a9e113073c12      |
| 20261106160000 | refuse_under13_self_registration (#314) | 7441fb99e15e      |
| 20261106210000 | youth_post_venue_privacy (#330)         | a93d0f7a7e2f      |

## What the batch acted on (counts from the pre-check)

| PR   | What it acted on                                                                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- |
| #300 | 3 `user_roles` rows. They are unchanged; only the server can write them now                                                       |
| #314 | 1 stored birthday under 13. It is untouched; only new self-registration below 13 is refused                                       |
| #330 | 0 tryout or clinic posts with a stored venue, so nothing visibly changed today                                                    |
| #332 | 184 signed-out sign-in events lost their full user agent (owner decision; this cannot be undone). No minors' rows needed clearing |

## P0-1 step E: catalog fingerprint (read-only, after the batch)

`docs/migration-evidence/catalog-fingerprint-cte.sql` (per-row form) was run on production and on a local replay of
`main` at `9cc42d2b` (405 migrations, postgres 16). 2,940 objects on production, 2,934 in the replay.

- **Only in the replay:** none.
- **Only on production (6), all expected:** drift register rows 1 to 3, which #245 captures:
  - columns `reviews.answers`, `reviews.recommend`, `reviews.tags`;
  - constraint `reviews_recommend_check`;
  - functions `review_question_keys(text)`, `review_tag_keys(text)`.
- **Different (3):**
  - `enforce_review_integrity()` and `player_trait_counts(uuid)`: expected (drift rows 1 to 3, #245).
  - `messages.messages_body_or_attachment_chk`: **new drift, cosmetic.** Production reads
    `deleted_at IS NOT NULL OR (body IS NOT NULL AND length(btrim(body)) > 0) OR attachment_path IS NOT NULL`, and `main`
    has the same three conditions in a different order. Same logic. Recorded here, not changed by hand, as the runbook
    says. A capture migration that writes production's order would make the fingerprints match exactly.

## Not done here

- **Ledger groups A, B, C and E** of `docs/release/p0-1-ledger-rows.sql` (older hand-applied history). Each needs the
  owner's approval per group.
- **P0-1 step F** (activate the `main`
  ruleset) and **step G** (how Lovable works under the ruleset).
- **Held PRs with migrations still not on production:** #315, #317, #343 (events stage 1), #344 and #345 (coach identity).
- **A check of the live site** from this session (the proxy refuses it). Owner's smoke test: a team page with a tryout
  loads, and signing in works.
