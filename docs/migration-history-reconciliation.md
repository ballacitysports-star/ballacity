# Migration history reconciliation

Status: prepared 2026-11-03. Nothing in this document was written to production. Production was read with SELECT
statements only (catalogs, ledgers, aggregate counts). Nothing here changes `supabase_migrations.schema_migrations` or
`drizzle.__drizzle_migrations`, and no ledger row has been or should be inserted without separate owner approval.

Production project: `cpqihhcqeivbgxqbzatv` (PostgreSQL 17.6). Repository: `main` at `890082cb`.

## 1. The two ledger rows that had no source file

Both original files are in Git history, so nothing here is reconstructed. They were authored by Lovable
(`gpt-engineer-app[bot]`), applied as `apikey@lovable.dev`, and later removed from the tree by Lovable "Reverted to
commit" commits. Each is archived byte for byte from the Git object. The ledger stores the statement text, and the md5
of the stored statement equals the md5 of the Git file.

| Ledger version   | Ledger name                                           | Original Git commit              | Archived copy (not executable)                                                                          | md5 (file = ledger statement)      |
| ---------------- | ----------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `20260708185350` | `20260708185348_97d89a2e-6e82-4a38-b870-5da2e718a847` | `c3288250` (2026-07-08 18:53:55) | `docs/migration-evidence/original-sources/20260708185348_97d89a2e-6e82-4a38-b870-5da2e718a847.sql.orig` | `4960a600fbb14ae055ed032073e15058` |
| `20260725025124` | `20260725025123_dc6f1a08-f936-4a43-9806-de61c4ed9c77` | `b1553001` (2026-07-25 02:51:33) | `docs/migration-evidence/original-sources/20260725025123_dc6f1a08-f936-4a43-9806-de61c4ed9c77.sql.orig` | `a25e6248b2cbf8c887a9f3df7c29b6a5` |

**Why they are archived and not placed in `supabase/migrations/`.** An earlier draft of this branch put them there. That
was wrong, for a concrete reason:

- The first statement adds `profiles.skill_levels`. `20260730002630` and `20260730004722` drop it three weeks later, and
  production does not have the column. Running the file again against production would **re-create a column that was
  deliberately dropped**. The ledger version (`20260708185350`) differs from the file's timestamp prefix
  (`20260708185348`), so a tool that matches by version would treat the file as unapplied and run it.
- The second statement is a no-op on production today (the constraint it guards already exists in its later,
  `parent`-aware form, and the column is already nullable without a default), but it is the same kind of file: an old
  statement that later files superseded.
- They are not needed to rebuild. A replay of every migration on `main` with and without them produces an identical
  catalog fingerprint (functions, tables, columns, constraints, indexes, policies, triggers, buckets, realtime) and the
  same 828 SQL assertions pass.

Rule: no historical migration file is ever re-applied to production. The archived copies exist so the two ledger rows
can be explained and checked, nothing more. (The 265 Lovable-named files already on `main` carry the same one-to-two second
skew between file timestamp and ledger version; nothing in this project matches by version, but it is the reason a ledger
row must never be inserted by guesswork.)

Notes:

- The second file is also byte-identical to `drizzle/migrations/0004_profiles_account_type_valid.sql`: its SHA-256
  (`350c298e37885c6f...`) equals drizzle ledger row 5.
- A commit on `origin/claude/guardian-account-type` (`e31daefe`, 2026-10-01) once added a file named
  `20260725025124_profiles_account_type_valid.sql`. Its header says it was back-filled from the ledger and that no branch
  ever held the original. The header is wrong about the original (`b1553001` held it), and that file is not on `main`. It
  must not be used as the source of record.
- Correction to earlier reports: the effects of `20260708185350` are **not** present in production (the column was
  added and then dropped), which is the expected final state.

## 2. The Drizzle ledger row that had no journal entry

The production Drizzle ledger has 33 rows; the repository journal has 32 entries.

- All 32 repository files have the SHA-256 recorded in the matching ledger row (checked one to one).
- Ledger row 22 (`created_at` 1792495848439, 2026-10-20 11:30:48 UTC, hash `b266e30fd6947963...`) equals the SHA-256 of
  `drizzle/migrations/0021_hide_team_posts_moderation_hidden_at.sql` in commit `f97dd5f8` (2026-10-20 11:30:53,
  `gpt-engineer-app[bot]`), which exists only on `origin/lovable-sync` and never reached main.
- Its effects are in production (policy `team_posts_moderated_read`, column `hidden_at`) and are covered on main by
  `20261016120000_post_text_moderation.sql` and `20261020120000_hide_posts_and_comments.sql`.
- Consequence: the repository's Drizzle numbering from `0021` on differs from the ledger's order by one. Do not run
  `drizzle-kit generate` or `migrate` against this project without reading this section. No action is needed on the ledger.

## 3. Source files without a ledger row

Exact recount against the live Supabase ledger (288 rows, latest `20260926155719`): **71** files from
`20260915214000_freeze_payment_claim_metadata_on_dispute.sql` to `20261030120000_sport_hubs_setting.sql` have no ledger
row. (Earlier reports said 76; that was an overcount made by filename range.) They were applied by hand. Four other
hand-named files in the same range do have rows (`20260917015500`, `20260917023000`, `20260924120000`,
`20260926155719`). Two more merged files, `20261103130000_profile_insert_guard.sql` and
`20261103140000_payment_settings_host_guard.sql`, are on main but **not applied in production**.

## 4. Method and result of the production comparison

Production's catalog was compared with a scratch PostgreSQL replay of every migration on main up to and including
`20261030120000` (both folders, in timestamp order, with the two restored files; the two unapplied `20261103*` files left
out). The comparison query is `docs/migration-evidence/catalog-fingerprint-cte.sql`.

| Object kind                          | Production | Replay | Result                                                                        |
| ------------------------------------ | ---------- | ------ | ----------------------------------------------------------------------------- |
| Tables and views (kind, RLS, grants) | 102        | 102    | identical                                                                     |
| Columns                              | 1,241      | 1,238  | production has 3 more: `reviews.recommend`, `reviews.answers`, `reviews.tags` |
| Constraints                          | 484        | 483    | production has `reviews_recommend_check`                                      |
| Indexes                              | 294        | 294    | identical                                                                     |
| Policies (public, storage)           | 282        | 282    | identical                                                                     |
| Storage buckets                      | 13         | 13     | identical                                                                     |
| Realtime publication tables          | 18         | 18     | identical                                                                     |
| Triggers (public, `auth.users`)      | 157        | 158    | replay has `bump_helpful_count_trg` that production lacks                     |
| Functions                            | 317        | 315    | see drift register                                                            |

Normalizations: comments and whitespace in function bodies; the PostgreSQL 17-only `MAINTAIN` privilege; owner names;
platform-owned triggers in `storage`. Everything not listed above matched.

### Drift register (production differs from what main rebuilds)

| #   | Object                                                              | Production                                                                              | Source on main                                                         | Handling                                                                                          |
| --- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | `reviews.recommend`, `.answers`, `.tags`, `reviews_recommend_check` | present                                                                                 | absent                                                                 | captured by `20261103110000_capture_structured_reviews.sql` (#245)                                |
| 2   | functions `review_question_keys`, `review_tag_keys`                 | present                                                                                 | absent                                                                 | captured by #245                                                                                  |
| 3   | `enforce_review_integrity`, `player_trait_counts` definitions       | production versions                                                                     | older                                                                  | captured by #245                                                                                  |
| 4   | `enforce_review_integrity` EXECUTE                                  | `service_role` only                                                                     | PUBLIC/anon/authenticated                                              | #245 does not revoke it either (checked); captured by `20261103104000` in #253 (open, not merged) |
| 5   | trigger `review_helpfuls.bump_helpful_count_trg`                    | absent                                                                                  | present (second trigger, double-counts votes)                          | fixed by `20261103100000_single_review_helpfuls_trigger.sql` (#251)                               |
| 6   | `enforce_gym_review` definition                                     | has a bypass for system updates (`pg_trigger_depth() > 1` or `app.review_system = '1'`) | no bypass                                                              | captured by `20261103101000` in #253 (open, not merged)                                           |
| 7   | `review_ring_suspects` definition                                   | alias `mean_rating`                                                                     | alias `avg_rating`, which collides with the `avg_rating` output column | captured by `20261103102000` in #253 (open, not merged)                                           |
| 8   | `enforce_skill_vote` EXECUTE                                        | `service_role` only                                                                     | PUBLIC/anon/authenticated                                              | captured by `20261103103000` in #253 (open, not merged); low risk (trigger function)              |

Items 4 and 6 to 8 are captured by #253, which is open and has not been merged or applied anywhere; until it is, they remain differences. Items 6 to 8 are new in this report. None is caused by the privacy release, and production is the safer side in each.
The risk is a rebuild or a later `CREATE OR REPLACE` from source silently reverting a hand fix.

## 5. Per-file evidence for the 71 files without ledger rows

How to read it. For each file, every object it creates, alters, drops or grants on was extracted from the SQL
(591 references). Each reference was looked up in the replay and, through the matching catalog fingerprint, in
production. "Evidenced" means every object the file defines that survives in the final schema is present in production
with an identical fingerprint, and anything the file dropped or later files replaced is absent from both. Data
statements and `DO` blocks were checked by their outcome (a residual-row count, a named constraint, a cron job).

Limits: this proves the file's effects are present, not that the file itself was executed. Where a later file
redefines an object, the evidence is for the final definition. Residual-row checks are weak on tables that are empty or
tiny in production (noted where it applies). Production tables have 7 games, 45 teams, 2 child-control rows and no
follows.

| #   | Migration file                                                | Objects checked                                                  | Result                | Notes                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `20260915214000_freeze_payment_claim_metadata_on_dispute.sql` | 2 function                                                       | Evidenced             |                                                                                                                                                                                                                                 |
| 2   | `20260915225631_guard_profile_moderation_fields.sql`          | 1 function, 2 trigger                                            | Evidenced             |                                                                                                                                                                                                                                 |
| 3   | `20260930120000_managed_children.sql`                         | 1 column, 9 function, 1 index, 2 policy, 5 table                 | Evidenced             |                                                                                                                                                                                                                                 |
| 4   | `20260930121000_freeze_player_profiles.sql`                   | 1 table                                                          | Evidenced             |                                                                                                                                                                                                                                 |
| 5   | `20261006120000_hosted_games_org_authorization.sql`           | 1 function, 1 index, 2 trigger                                   | Evidenced             |                                                                                                                                                                                                                                 |
| 6   | `20261006130000_org_court_inquiries.sql`                      | 1 function, 2 index, 6 policy, 5 table, 4 trigger                | Evidenced             |                                                                                                                                                                                                                                 |
| 7   | `20261006140000_org_featured.sql`                             | 1 column, 1 function, 1 index, 1 table, 2 trigger                | Evidenced             |                                                                                                                                                                                                                                 |
| 8   | `20261006150000_court_booking_model.sql`                      | 3 column, 8 constraint, 1 table                                  | Evidenced             |                                                                                                                                                                                                                                 |
| 9   | `20261006160000_trainer_age_groups.sql`                       | 1 column                                                         | Evidenced             |                                                                                                                                                                                                                                 |
| 10  | `20261006180000_hosted_games_community_runs.sql`              | 3 column, 4 function, 2 trigger                                  | Evidenced             | data: rows with org_id set and org_official not true = 0 (7 games in table)                                                                                                                                                     |
| 11  | `20261006190000_reel_advanced_analytics.sql`                  | 1 column                                                         | Evidenced             |                                                                                                                                                                                                                                 |
| 12  | `20261006200000_restore_child_ai_processing_on_approval.sql`  | 2 function                                                       | Evidenced             |                                                                                                                                                                                                                                 |
| 13  | `20261007120000_payment_spot_hold.sql`                        | 1 column, 2 constraint, 4 function                               | Evidenced             | cron job `release-expired-payment-holds` at `*/5 * * * *` exists in production (name and schedule identical to the file)                                                                                                        |
| 14  | `20261007140000_worker_secret_check.sql`                      | 3 function                                                       | Evidenced             |                                                                                                                                                                                                                                 |
| 15  | `20261007160000_trainer_session_cancel_accepted.sql`          | 3 function, 2 policy, 4 trigger                                  | Evidenced             |                                                                                                                                                                                                                                 |
| 16  | `20261008120000_cancel_windows.sql`                           | 3 column, 13 function, 1 index, 2 policy, 5 table, 6 trigger     | Evidenced             | DO block: 3 CHECK constraints `*_cancel_cutoff_min_chk` and 3 `cancel_cutoff_min` columns exist in production                                                                                                                   |
| 17  | `20261008130000_reel_drafts.sql`                              | 1 column, 1 function                                             | Evidenced             |                                                                                                                                                                                                                                 |
| 18  | `20261008140000_refund_policies.sql`                          | 6 column, 4 constraint, 17 function, 10 trigger                  | Evidenced             | DO block: 6 CHECK constraints (`*_refund_rule_chk`, `*_late_refund_pct_chk`) and 6 columns (`refund_rule`, `late_refund_pct`) exist on game_payment_settings, team_posts, teams                                                 |
| 19  | `20261008140000_teen_reel_sharing.sql`                        | 2 constraint, 3 function, 2 trigger                              | Evidenced             |                                                                                                                                                                                                                                 |
| 20  | `20261008150000_family_posts.sql`                             | 1 column, 3 function, 1 index, 2 trigger                         | Evidenced             |                                                                                                                                                                                                                                 |
| 21  | `20261008160000_family_post_links.sql`                        | 8 function, 1 index, 2 policy, 5 table, 2 trigger                | Evidenced             |                                                                                                                                                                                                                                 |
| 22  | `20261008160000_guardian_cancel_child_game.sql`               | 10 function                                                      | Evidenced             |                                                                                                                                                                                                                                 |
| 23  | `20261008170000_family_post_team_tier.sql`                    | 2 column, 14 function, 2 trigger                                 | Evidenced             |                                                                                                                                                                                                                                 |
| 24  | `20261008170000_guardian_refund_notices.sql`                  | 7 function                                                       | Evidenced             |                                                                                                                                                                                                                                 |
| 25  | `20261008180000_family_sharing_guardian_toggles.sql`          | 2 column, 7 function                                             | Evidenced             |                                                                                                                                                                                                                                 |
| 26  | `20261008190000_public_xp_toggle.sql`                         | 1 column, 3 function                                             | Evidenced             |                                                                                                                                                                                                                                 |
| 27  | `20261008200000_coach_analytics_sharing.sql`                  | 11 function, 2 policy, 5 table, 2 trigger                        | Evidenced             |                                                                                                                                                                                                                                 |
| 28  | `20261009120000_superadmin_inherits_admin_roles.sql`          | 3 function                                                       | Evidenced             |                                                                                                                                                                                                                                 |
| 29  | `20261012120000_review_integrity.sql`                         | 2 column, 9 function, 3 index, 3 policy, 3 table, 2 trigger      | Evidenced, with drift | `enforce_review_integrity`: definition + ACL differ - captured by #245 (20261103110000)                                                                                                                                         |
| 30  | `20261012130000_review_ring_detection.sql`                    | 6 function                                                       | Evidenced, with drift | `review_ring_suspects`: definition differs (production aliases mean_rating; source uses avg_rating, which collides with the OUT column) - NOT yet captured                                                                      |
| 31  | `20261012140000_review_ai.sql`                                | 3 function, 2 policy, 8 table                                    | Evidenced, with drift | `player_trait_counts`: definition differs - captured by #245 (20261103110000)                                                                                                                                                   |
| 32  | `20261012150000_skill_ratings.sql`                            | 4 function, 1 index, 3 policy, 8 table, 2 trigger                | Evidenced, with drift | `enforce_skill_vote`: production allows EXECUTE only to `service_role` (a hand REVOKE); this file never revokes, so a rebuild leaves PUBLIC/anon/authenticated EXECUTE on a trigger function                                    |
| 33  | `20261014120000_game_refund_terms.sql`                        | 3 function                                                       | Evidenced             |                                                                                                                                                                                                                                 |
| 34  | `20261014130000_minor_messaging_block_side.sql`               | 8 function                                                       | Evidenced             |                                                                                                                                                                                                                                 |
| 35  | `20261015120000_teen_reel_team_approval.sql`                  | 2 column, 11 function, 2 trigger                                 | Evidenced             | data: child_controls rows still at media_visibility=members = 0 (2 rows in table; weak evidence)                                                                                                                                |
| 36  | `20261016120000_post_text_moderation.sql`                     | 4 column, 4 constraint, 2 function, 2 index, 4 policy, 4 trigger | Evidenced             |                                                                                                                                                                                                                                 |
| 37  | `20261016130000_team_event_availability.sql`                  | 3 function, 2 index, 1 policy, 4 table, 1 trigger                | Evidenced             |                                                                                                                                                                                                                                 |
| 38  | `20261016140000_availability_levels_and_intent.sql`           | 2 column, 4 constraint, 1 index                                  | Evidenced             |                                                                                                                                                                                                                                 |
| 39  | `20261020120000_accept_message_request.sql`                   | 2 function                                                       | Evidenced             |                                                                                                                                                                                                                                 |
| 40  | `20261020120000_hide_posts_and_comments.sql`                  | 2 function, 4 policy                                             | Evidenced             |                                                                                                                                                                                                                                 |
| 41  | `20261020130000_unsent_attachments_stay_private.sql`          | 1 index, 2 policy                                                | Evidenced             |                                                                                                                                                                                                                                 |
| 42  | `20261020160000_capture_live_function_changes.sql`            | 2 function                                                       | Evidenced             |                                                                                                                                                                                                                                 |
| 43  | `20261021120000_team_post_images.sql`                         | 1 column, 2 constraint                                           | Evidenced             |                                                                                                                                                                                                                                 |
| 44  | `20261021130000_team_logo_column.sql`                         | 1 column, 2 constraint                                           | Evidenced             | data: teams with a URL in `avatar` and no `avatar_url` = 0 (45 teams)                                                                                                                                                           |
| 45  | `20261021140000_listing_discovery.sql`                        | 3 index, 12 table                                                | Evidenced             |                                                                                                                                                                                                                                 |
| 46  | `20261021150000_teams_anon_read_narrow.sql`                   | 3 policy, 2 table                                                | Evidenced             | 1 reference(s) dropped or replaced by later files (absent from the final schema and from production)                                                                                                                            |
| 47  | `20261021160000_trainer_orgs_anon_internal_columns.sql`       | 1 table                                                          | Evidenced             |                                                                                                                                                                                                                                 |
| 48  | `20261022130000_listing_claim_review.sql`                     | 4 column, 2 constraint, 20 function, 2 index                     | Evidenced             |                                                                                                                                                                                                                                 |
| 49  | `20261023100000_owner_hide_listings.sql`                      | 8 column, 5 function, 8 policy, 8 trigger                        | Evidenced             | data: hidden rows lacking moderator_hidden_at = 0 for team_posts, teams, trainer_orgs; hosted_games shows 4 rows hidden by their owner (owner_hidden_at set), 0 unexplained                                                     |
| 50  | `20261023110000_team_posts_no_pickup.sql`                     | 2 constraint                                                     | Evidenced             | data: team_posts of kind pickup = 0                                                                                                                                                                                             |
| 51  | `20261023120000_payment_health_metrics.sql`                   | 3 function                                                       | Evidenced             |                                                                                                                                                                                                                                 |
| 52  | `20261023120100_guardian_can_message_own_teen.sql`            | 3 function                                                       | Evidenced             |                                                                                                                                                                                                                                 |
| 53  | `20261023130000_follow_approval.sql`                          | 1 column, 13 function, 1 index, 1 policy, 6 table, 2 trigger     | Evidenced             | data: minors without require_follow_approval = 0; follows of minors = 0 (follows table empty: weak evidence); DO block grants on 4 follow functions identical to production                                                     |
| 54  | `20261023130100_quarantine_policy_sees_moderation_rows.sql`   | 3 function, 2 policy                                             | Evidenced             |                                                                                                                                                                                                                                 |
| 55  | `20261023140000_reports_start_as_new.sql`                     | 2 function, 2 trigger                                            | Evidenced             |                                                                                                                                                                                                                                 |
| 56  | `20261027120000_join_gate_hardening.sql`                      | 3 function                                                       | Evidenced             |                                                                                                                                                                                                                                 |
| 57  | `20261027130000_guardian_join_request_either_order.sql`       | 3 function                                                       | Evidenced             |                                                                                                                                                                                                                                 |
| 58  | `20261027140000_team_members_no_direct_minor_add.sql`         | 2 policy                                                         | Evidenced             |                                                                                                                                                                                                                                 |
| 59  | `20261027150000_waitlist_notified_on_leave.sql`               | 2 function, 2 trigger                                            | Evidenced             |                                                                                                                                                                                                                                 |
| 60  | `20261027160000_trainer_org_no_forged_affiliation.sql`        | 6 function, 5 policy, 2 trigger                                  | Evidenced             | 1 reference(s) dropped or replaced by later files (absent from the final schema and from production); DO block only raises a NOTICE; objects covered above                                                                      |
| 61  | `20261028120000_message_attachment_checks.sql`                | 2 function, 4 table, 2 trigger                                   | Evidenced             |                                                                                                                                                                                                                                 |
| 62  | `20261028130000_image_bucket_mime_types.sql`                  | no catalog objects (data/DO block only)                          | Evidenced             | data: storage.buckets allowed_mime_types fingerprint identical for all 13 buckets                                                                                                                                               |
| 63  | `20261028140000_guardian_before_payment.sql`                  | 2 function, 2 trigger                                            | Evidenced             |                                                                                                                                                                                                                                 |
| 64  | `20261028150000_host_blocks_stop_joins.sql`                   | 3 function, 4 trigger                                            | Evidenced             |                                                                                                                                                                                                                                 |
| 65  | `20261028160000_fix_revoke_parental_consent.sql`              | 1 function                                                       | Evidenced             |                                                                                                                                                                                                                                 |
| 66  | `20261028170000_team_manager_null_guard.sql`                  | 2 function                                                       | Evidenced             |                                                                                                                                                                                                                                 |
| 67  | `20261028180000_unsend_message_allows_deleted.sql`            | 2 constraint                                                     | Evidenced             |                                                                                                                                                                                                                                 |
| 68  | `20261029120000_remove_unclaimed_listing.sql`                 | 3 function                                                       | Evidenced             |                                                                                                                                                                                                                                 |
| 69  | `20261029150000_hosted_games_anon_minors_guard.sql`           | 3 function, 2 policy                                             | Evidenced             |                                                                                                                                                                                                                                 |
| 70  | `20261029190000_highlight_reels_restricted_game_guard.sql`    | 3 function, 2 policy                                             | Evidenced             |                                                                                                                                                                                                                                 |
| 71  | `20261030120000_sport_hubs_setting.sql`                       | no catalog objects (data/DO block only)                          | Evidenced             | data: app_settings.sport_hubs row exists but value is {"enabled": false}; the file inserts true with ON CONFLICT DO NOTHING, so production state differs from the file default by an operator/feature-flag choice, not by drift |

Totals: 71 files, 591 object references. 67 files are evidenced with no differences. 4 are evidenced with drift
(`20261012120000_review_integrity`, `20261012130000_review_ring_detection`, `20261012140000_review_ai` and
`20261012150000_skill_ratings`; see the register). No file was found missing from production.

## 6. Per-entry ledger evidence (starting point for reconciliation; nothing is inserted)

`docs/migration-evidence/ledger-evidence.csv` has one row per file with: source file, SHA-256, the version a row
would carry, expected schema and data effects, verified production postconditions, definition or permission drift,
confidence, what happens if the file is re-applied without a row, and whether inserting a row could mislead a future
migration decision. Summary:

- Confidence: 55 High, 12 Medium (data, bucket or setting effects proven by outcome, or mostly superseded), 4 Medium with
  drift. None is Low.
- 27 of the 71 files define objects that later files redefine or drop. Re-running any of them against production would
  silently regress those objects, so a **missing** row is the larger hazard for them than a present one. One file
  (`20261023100000_owner_hide_listings`) would also relabel 4 owner-hidden games as moderator-hidden if re-run.
- 4 files carry drift. A row for any of them would record "applied" while production holds a different definition or grant,
  which a version check cannot see. They are blocked until the drift capture lands:
  `20261012120000_review_integrity` (EXECUTE on `enforce_review_integrity`), `20261012130000_review_ring_detection`,
  `20261012150000_skill_ratings` (EXECUTE on `enforce_skill_vote`), and `20261012140000_review_ai` (covered by #245).
  The fifth drifting object, `enforce_gym_review`, lives in a Lovable-named file (`20260730162842`) that already has a ledger row, so
  no row is in question for it; the drift is still captured by #253.
- No row has been or will be inserted without the owner's written approval of this table, entry by entry or by group.

| Group                                            | Entries | Proposed handling once approved                        |
| ------------------------------------------------ | ------- | ------------------------------------------------------ |
| Low risk, High confidence, nothing superseded    | see CSV | insert, `version` = file timestamp                     |
| Superseded objects (row protects against re-run) | 27      | insert after owner review of the re-run column         |
| Medium / Low confidence                          | 12      | owner reviews each; Low ones need a direct check first |
| Drift                                            | 4       | not until the drift capture is merged and applied      |

## 7. What this document does not authorize

- No insert into `supabase_migrations.schema_migrations` or `drizzle.__drizzle_migrations`.
- No production DDL. The `20261103100000` fix (#251) and the drift captures (#253) are repository changes only until the owner approves
  applying them.

## See also

PR #229 (`docs/migration-ledger.md`, opened 2026-10-28, not merged) is an earlier, separate record of what production contained for the 65 files then newer than the last ledger row, including that `20261023130000_follow_approval` was applied to production on 2026-10-28 on the owner's approval. It uses a different method (object presence by name) and covers a different set; the two do not conflict, and neither inserts a ledger row.
