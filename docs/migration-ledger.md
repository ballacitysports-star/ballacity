# Production migration ledger

Checked: 2026-10-28, against the production database, with read-only catalog queries
(`pg_proc`, `pg_class`, `pg_trigger`, `pg_policies`, `pg_indexes`, `pg_constraint`,
`information_schema.columns`, `storage.buckets`). No user rows were read and nothing was changed; the only data queries were aggregate counts (fixture
accounts, and follows of minors).

## Why this exists

Production's recorded migration history stops at `20260926155719` in
`supabase_migrations.schema_migrations` (288 rows). `drizzle.__drizzle_migrations` (32 rows) ends at
`0030_listing_claim_review`. Of the 65 files in `supabase/migrations` newer than the last recorded
version, only 10 have a same-named drizzle migration. The other 55 have no history
row anywhere. Migrations applied by hand or through the Lovable database tool leave no history row, so
the history cannot say what production contains. This ledger records what it actually contains.

**Do not insert history rows to make this match, and do not replay a migration because its objects look
missing or present.** Decide each row on its own.

## What "present" means

For each file, the objects it creates (functions, tables, added columns, indexes, triggers, policies and
added constraints) were looked up by name. "Present" means every one of them exists. It does **not** mean the
definition is identical. Bodies were compared only where the Notes column says so. Not checked: `DROP`
statements, grants and revokes, data changes, and function bodies not named in Notes.

## Summary

| Result                               | Files |
| ------------------------------------ | ----- |
| present                              | 61    |
| MISSING when checked (since applied) | 1     |
| not checkable                        | 3     |

## Finding: `20261023130000_follow_approval.sql` was not applied, and now is

When checked on 2026-10-28, nothing this migration creates existed in production, although the app code
for it was already live. Following called `request_follow` and related functions that did not exist, and
privacy saves upserted a `require_follow_approval` column that did not exist (inferred from the code and
catalog; not run against production). The minor-safety rule was not in force: `authenticated` could still
insert into `follows`.

It was applied to production later the same day, on the owner's explicit approval, exactly as in the repo
file. Read back afterwards:

- `follow_requests` exists with row-level security on and one SELECT policy. `authenticated` can only
  SELECT it; `anon` has no access.
- `authenticated` can no longer INSERT or UPDATE `follows` (SELECT and DELETE remain).
- The 2 existing minors' privacy rows have `require_follow_approval` set; none are left off.
- Production had 0 follows and 0 follow requests, so nothing was moved to pending.
- The bodies of all 8 functions match the repo file by MD5 of `prosrc`. `request_follow`,
  `respond_follow_request`, `remove_follower` and `cancel_follow_request` are executable by
  `authenticated` and not by `anon`; the other four are not executable by either.
- Trigger `trg_accept_pending_when_public` is enabled.

Not done: the follow flow and privacy save were not exercised in a browser against production, and the
production history still has no row for this migration.

## Per-file results

| File                                                         | Same-named drizzle migration | Result                                       | Objects checked | Notes                                                                                           |
| ------------------------------------------------------------ | ---------------------------- | -------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `20260930120000_managed_children.sql`                        | yes                          | present                                      | 7               |                                                                                                 |
| `20260930121000_freeze_player_profiles.sql`                  | yes                          | not checkable                                | 0               | Changes only grants or data; nothing to look up in the catalog.                                 |
| `20261006120000_hosted_games_org_authorization.sql`          | no                           | present                                      | 3               |                                                                                                 |
| `20261006130000_org_court_inquiries.sql`                     | no                           | present                                      | 9               |                                                                                                 |
| `20261006140000_org_featured.sql`                            | no                           | present                                      | 4               |                                                                                                 |
| `20261006150000_court_booking_model.sql`                     | no                           | present                                      | 6               |                                                                                                 |
| `20261006160000_trainer_age_groups.sql`                      | no                           | present                                      | 1               |                                                                                                 |
| `20261006180000_hosted_games_community_runs.sql`             | no                           | present                                      | 6               |                                                                                                 |
| `20261006190000_reel_advanced_analytics.sql`                 | no                           | present                                      | 1               |                                                                                                 |
| `20261006200000_restore_child_ai_processing_on_approval.sql` | no                           | present                                      | 1               |                                                                                                 |
| `20261007120000_payment_spot_hold.sql`                       | no                           | present                                      | 3               |                                                                                                 |
| `20261007140000_worker_secret_check.sql`                     | no                           | present                                      | 1               |                                                                                                 |
| `20261007160000_trainer_session_cancel_accepted.sql`         | no                           | present                                      | 5               |                                                                                                 |
| `20261008120000_cancel_windows.sql`                          | no                           | present                                      | 16              |                                                                                                 |
| `20261008130000_reel_drafts.sql`                             | no                           | present                                      | 2               |                                                                                                 |
| `20261008140000_refund_policies.sql`                         | no                           | present                                      | 22              |                                                                                                 |
| `20261008140000_teen_reel_sharing.sql`                       | no                           | present                                      | 4               |                                                                                                 |
| `20261008150000_family_posts.sql`                            | no                           | present                                      | 5               |                                                                                                 |
| `20261008160000_family_post_links.sql`                       | no                           | present                                      | 7               |                                                                                                 |
| `20261008160000_guardian_cancel_child_game.sql`              | no                           | present                                      | 4               |                                                                                                 |
| `20261008170000_family_post_team_tier.sql`                   | no                           | present                                      | 8               |                                                                                                 |
| `20261008170000_guardian_refund_notices.sql`                 | no                           | present                                      | 3               |                                                                                                 |
| `20261008180000_family_sharing_guardian_toggles.sql`         | no                           | present                                      | 7               |                                                                                                 |
| `20261008190000_public_xp_toggle.sql`                        | no                           | present                                      | 2               |                                                                                                 |
| `20261008200000_coach_analytics_sharing.sql`                 | no                           | present                                      | 7               |                                                                                                 |
| `20261009120000_superadmin_inherits_admin_roles.sql`         | no                           | present                                      | 1               |                                                                                                 |
| `20261012120000_review_integrity.sql`                        | no                           | present                                      | 13              |                                                                                                 |
| `20261012130000_review_ring_detection.sql`                   | no                           | present                                      | 2               |                                                                                                 |
| `20261012140000_review_ai.sql`                               | no                           | present                                      | 5               |                                                                                                 |
| `20261012150000_skill_ratings.sql`                           | no                           | present                                      | 9               |                                                                                                 |
| `20261014120000_game_refund_terms.sql`                       | no                           | present                                      | 1               |                                                                                                 |
| `20261014130000_minor_messaging_block_side.sql`              | no                           | present                                      | 4               |                                                                                                 |
| `20261015120000_teen_reel_team_approval.sql`                 | no                           | present                                      | 9               |                                                                                                 |
| `20261016120000_post_text_moderation.sql`                    | no                           | present                                      | 11              |                                                                                                 |
| `20261016130000_team_event_availability.sql`                 | no                           | present                                      | 6               |                                                                                                 |
| `20261016140000_availability_levels_and_intent.sql`          | no                           | present                                      | 5               |                                                                                                 |
| `20261020120000_accept_message_request.sql`                  | no                           | present                                      | 1               |                                                                                                 |
| `20261020120000_hide_posts_and_comments.sql`                 | no                           | present                                      | 3               |                                                                                                 |
| `20261020130000_unsent_attachments_stay_private.sql`         | no                           | present                                      | 2               |                                                                                                 |
| `20261020160000_capture_live_function_changes.sql`           | no                           | present                                      | 2               |                                                                                                 |
| `20261021120000_team_post_images.sql`                        | no                           | present                                      | 2               |                                                                                                 |
| `20261021130000_team_logo_column.sql`                        | no                           | present                                      | 2               |                                                                                                 |
| `20261021140000_listing_discovery.sql`                       | yes                          | present                                      | 6               |                                                                                                 |
| `20261021150000_teams_anon_read_narrow.sql`                  | no                           | present                                      | 2               |                                                                                                 |
| `20261021160000_trainer_orgs_anon_internal_columns.sql`      | no                           | not checkable                                | 0               | Changes only grants or data; nothing to look up in the catalog.                                 |
| `20261022130000_listing_claim_review.sql`                    | yes                          | present                                      | 13              |                                                                                                 |
| `20261023100000_owner_hide_listings.sql`                     | no                           | present                                      | 18              |                                                                                                 |
| `20261023110000_team_posts_no_pickup.sql`                    | no                           | present                                      | 1               |                                                                                                 |
| `20261023120000_payment_health_metrics.sql`                  | yes                          | present                                      | 1               |                                                                                                 |
| `20261023120100_guardian_can_message_own_teen.sql`           | no                           | present                                      | 1               |                                                                                                 |
| `20261023130000_follow_approval.sql`                         | no                           | **MISSING when checked; applied 2026-10-28** | 13              | Applied exactly as in the repo file; all 8 function bodies match by MD5. See the finding above. |
| `20261023130100_quarantine_policy_sees_moderation_rows.sql`  | no                           | present                                      | 1               |                                                                                                 |
| `20261023140000_reports_start_as_new.sql`                    | no                           | present                                      | 2               |                                                                                                 |
| `20261027120000_join_gate_hardening.sql`                     | yes                          | present                                      | 3               |                                                                                                 |
| `20261027130000_guardian_join_request_either_order.sql`      | yes                          | present                                      | 1               |                                                                                                 |
| `20261027140000_team_members_no_direct_minor_add.sql`        | yes                          | present                                      | 1               |                                                                                                 |
| `20261027150000_waitlist_notified_on_leave.sql`              | yes                          | present                                      | 2               |                                                                                                 |
| `20261027160000_trainer_org_no_forged_affiliation.sql`       | yes                          | present                                      | 6               |                                                                                                 |
| `20261028120000_message_attachment_checks.sql`               | no                           | present                                      | 3               |                                                                                                 |
| `20261028130000_image_bucket_mime_types.sql`                 | no                           | not checkable                                | 0               | 7 public image buckets allow only jpeg/png/webp                                                 |
| `20261028140000_guardian_before_payment.sql`                 | no                           | present                                      | 2               | function body and trigger match the repo                                                        |
| `20261028150000_host_blocks_stop_joins.sql`                  | no                           | present                                      | 3               | function body and both triggers match the repo                                                  |
| `20261028160000_fix_revoke_parental_consent.sql`             | no                           | present                                      | 1               | function body matches the repo                                                                  |
| `20261028170000_team_manager_null_guard.sql`                 | no                           | present                                      | 2               | both function bodies match the repo                                                             |
| `20261028180000_unsend_message_allows_deleted.sql`           | no                           | present                                      | 1               | constraint definition is logically identical to the repo's                                      |
