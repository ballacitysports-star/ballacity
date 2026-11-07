-- P0-1 step D: ledger rows for the hand-applied migrations (runbook section 3, step D). NOT a migration.
-- Nothing in this file applies SQL to the schema. Each statement records that one file in supabase/migrations was
-- already applied to production by hand (docs/migration-history-reconciliation.md sections 3 to 9 and
-- docs/migration-evidence/ledger-evidence.csv hold the evidence, file by file). `version` is the file's timestamp,
-- `name` the file name without .sql, `statements` empty (the row claims nothing about the text, per the reconciliation
-- document's template). Each insert is its own transaction and is a no-op if the row already exists.
--
-- Run only after the owner has approved the group in writing. The groups are separate so they can be approved
-- separately:
--   A. INSERT-PROTECTIVE and INSERT-OPTIONAL with a version of their own: 52 statements, active below.
--   B. INSERT-AFTER-OWNER-REVIEW (6): commented out; the owner reads the postconditions column in the CSV first,
--      then uncomments the ones approved.
--   C. HOLD-DRIFT (4) and HOLD-OWNER (1): commented out. Two of the drift holds (20261012130000_review_ring_detection,
--      20261012150000_skill_ratings) can be lifted once the P0-1 verify has passed, because the captures 20261103102000
--      and 20261103103000 record what production holds; the other two (20261012120000_review_integrity,
--      20261012140000_review_ai) wait for #245. The sport_hubs hold is an operator choice to confirm.
--   D. The seven P0-1 files themselves: Lovable records a drizzle row when it applies a file; a supabase row for each is
--      optional and commented out below (the psql path writes it with the release ledger template).
--   E. The four duplicate-version pairs (8 files, PR #289): `version` is the primary key, so one row cannot stand for two
--      files. Commented out. The owner chooses, per #289: one row per version named after the first file of the pair, or
--      leave both files of each pair unledgered. Whichever is chosen, both files are already applied (catalog evidence).
--
-- Verify a file's sha256 against the CSV before inserting its row:  sha256sum supabase/migrations/<file>
-- Afterwards: SELECT count(*) FROM supabase_migrations.schema_migrations;  -- expect the previous count + rows inserted

-- ============================================================ A. protective and optional, own version (52, active)
-- INSERT-PROTECTIVE | sha256 fc39ebd0fe110819bd24f2ff6e475ce8c2e0af017cf6629e681e12c58eda71a2
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20260915214000', '20260915214000_freeze_payment_claim_metadata_on_dispute', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260915214000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 a5fe5b4f717576dcce567a8870137deb5f594818733f75687e2c4661181cac6f
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20260915225631', '20260915225631_guard_profile_moderation_fields', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260915225631');
COMMIT;
-- INSERT-PROTECTIVE | sha256 7e92077b15da1d882ac194328325c0491349cfe62baa83508feab84a04cda9ba
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20260930120000', '20260930120000_managed_children', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260930120000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 f3f123455c0337f7ec7fcdb008c3c3bb21052615b1890b65d30638f6df56d7da
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20260930121000', '20260930121000_freeze_player_profiles', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260930121000');
COMMIT;
-- INSERT-PROTECTIVE | sha256 cc382a54b808996669550c1869718e4a9efaaf19d038f60381dcb3c727190d30
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261006120000', '20261006120000_hosted_games_org_authorization', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261006120000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 94cfdce7bf2d6c9df4a1480a3bf97b99fd6bd96414626a166531d87f84682814
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261006130000', '20261006130000_org_court_inquiries', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261006130000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 2e40b22b5c9f6ae9d66440d0e52af7c1e506be2183c30228de3672a418dc0a38
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261006140000', '20261006140000_org_featured', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261006140000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 d1cfac395d311a7b999db4b6103f0fb93bc765aea44942fec7fe7d7834227c82
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261006150000', '20261006150000_court_booking_model', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261006150000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 30c91efeec33c3547318cdf5f38c7b5b6692de5a220fda80810389624b050345
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261006160000', '20261006160000_trainer_age_groups', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261006160000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 50556107a59df982ff23c5dd1d32385f63fd1aac56a56f5004c7152fe7ff99fd
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261006190000', '20261006190000_reel_advanced_analytics', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261006190000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 aba1c0c2ecaa62168dfea558db2b3f9a1956bbae680f060e1801c23717982f8d
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261006200000', '20261006200000_restore_child_ai_processing_on_approval', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261006200000');
COMMIT;
-- INSERT-PROTECTIVE | sha256 46fcb98b740f23137e04333821a95ce6ea21b5fb09a010889b36f29372b86cc9
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261007120000', '20261007120000_payment_spot_hold', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261007120000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 11cb2ddf1b4078e3a217be0801cb5c0287cf076f6ede14e9c3d233d8c16716fc
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261007140000', '20261007140000_worker_secret_check', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261007140000');
COMMIT;
-- INSERT-PROTECTIVE | sha256 ed87eec97acbfc3a69152d2a568af9a7097a8a5d9122cf4b0dda848cf904f7a3
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261007160000', '20261007160000_trainer_session_cancel_accepted', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261007160000');
COMMIT;
-- INSERT-PROTECTIVE | sha256 19d5755ea99bb345f6578ae59eac4311d13111659cf65e5d705bb14c86a4a65d
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261008120000', '20261008120000_cancel_windows', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261008120000');
COMMIT;
-- INSERT-PROTECTIVE | sha256 2a09f4240201defbd27d7337e156120ed557af53590b525f13393da2a64b913a
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261008130000', '20261008130000_reel_drafts', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261008130000');
COMMIT;
-- INSERT-PROTECTIVE | sha256 c49b25898710a0f5cde7d4649b4b192c7ed9bc1bcef63e0242adc9fc0f102956
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261008150000', '20261008150000_family_posts', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261008150000');
COMMIT;
-- INSERT-PROTECTIVE | sha256 2278b7b888828faba4b35870777c5caffbe40f2657e775799d5cc400525bdaf5
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261008180000', '20261008180000_family_sharing_guardian_toggles', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261008180000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 ad06f32bded0144dc51b661eb1190b867a772f478bc1ec8b94e0d50766b0a6f2
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261008190000', '20261008190000_public_xp_toggle', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261008190000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 3b59d194bdd36c37eb1de58ba1cb7ea3965be39804a03b50a77bab71dd59df57
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261008200000', '20261008200000_coach_analytics_sharing', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261008200000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 c1ebd254ad42a4409a0cd54ae84d9cc1e9fd7ad20b381cd11854725c375d5298
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261009120000', '20261009120000_superadmin_inherits_admin_roles', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261009120000');
COMMIT;
-- INSERT-PROTECTIVE | sha256 791d92a5e23cf24f2b3c89f660b5d1d434d83e789a0cf890ee3460d058bb1f76
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261014120000', '20261014120000_game_refund_terms', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261014120000');
COMMIT;
-- INSERT-PROTECTIVE | sha256 2e3b7b39ac733e77b3310c52216400d7ebccaea6c3530566a9c2804889e937ec
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261014130000', '20261014130000_minor_messaging_block_side', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261014130000');
COMMIT;
-- INSERT-PROTECTIVE | sha256 302a7c1487282bd85ab77f328e7cd458c070d8263f4f2c037c0eb5bc79929831
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261016120000', '20261016120000_post_text_moderation', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261016120000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 4f1a40b1dea90337526c3b363e7999b4ac93aebb0ec8befe3a80dc4f877771e4
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261016130000', '20261016130000_team_event_availability', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261016130000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 3119708a64dcfb5012aefcb15cb8ae6b3b3eee30bbafba6e92b5642d03679dd4
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261016140000', '20261016140000_availability_levels_and_intent', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261016140000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 d55c627b19bf3b97af5362c0a03c57db67318221600cac575804b3a65381dd31
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261020130000', '20261020130000_unsent_attachments_stay_private', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261020130000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 17062bf813bb8c3b5bb14ea2d1417d76db165a6e586299aaf89500eeafc8b8c3
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261020160000', '20261020160000_capture_live_function_changes', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261020160000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 80fdecc0fdfb37bd580bc8e8df87339f12c1bcca0c2c0ae1250088efe68a1530
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261021120000', '20261021120000_team_post_images', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261021120000');
COMMIT;
-- INSERT-PROTECTIVE | sha256 404daa4db0413a988b702be37dc6ff1a92cf2b5df4bc06053337c692cc067583
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261021140000', '20261021140000_listing_discovery', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261021140000');
COMMIT;
-- INSERT-PROTECTIVE | sha256 73f8ec585b5f7c8f4c38a8c4f1888b68777ca2a62f43ae6f7e5bd5360278b6a2
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261021150000', '20261021150000_teams_anon_read_narrow', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261021150000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 abe132b4459ce4c3601251d1623cf24834a0e3987eb1a9e6aa789f06acf680cc
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261021160000', '20261021160000_trainer_orgs_anon_internal_columns', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261021160000');
COMMIT;
-- INSERT-PROTECTIVE | sha256 f99b7f2b6e6f5cf2b276ffcb491356bd2621c4dae7398ee5709fcfe05e7db613
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261022130000', '20261022130000_listing_claim_review', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261022130000');
COMMIT;
-- INSERT-PROTECTIVE (priority) | sha256 47c3ebc667656d1d317116c20275e3ffebb597313e4ee3a1a6a26f697c1b0352
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261023100000', '20261023100000_owner_hide_listings', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261023100000');
COMMIT;
-- INSERT-PROTECTIVE | sha256 86fe3df2112ce0e41b070a8cf5fd12f382929e381ae2d1d41ea0e29fcce7c80b
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261023120000', '20261023120000_payment_health_metrics', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261023120000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 1af230fca6d141d2f64ff94e853e224c812b970b1cc468b0a798e65381a992bc
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261023120100', '20261023120100_guardian_can_message_own_teen', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261023120100');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 1ca988869e9d3cb847a389e8129ef904e33b524cfe42194cfedf924bb13c2bf5
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261023130100', '20261023130100_quarantine_policy_sees_moderation_rows', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261023130100');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 bce2956167875d88a7c2242774695b7cd4684faa1bd895b3172886cee3a03977
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261023140000', '20261023140000_reports_start_as_new', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261023140000');
COMMIT;
-- INSERT-PROTECTIVE | sha256 b82304067dbd403e4f22eb568b801d9a59f8186230444143a03e1152f6027912
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261027120000', '20261027120000_join_gate_hardening', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261027120000');
COMMIT;
-- INSERT-PROTECTIVE | sha256 399a853213fcd4f86fcd0c53ab8dec6b06b43d0bf552b35415702eaa8ef4a787
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261027130000', '20261027130000_guardian_join_request_either_order', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261027130000');
COMMIT;
-- INSERT-PROTECTIVE | sha256 95c9d759ecf174c8ef464786b78fcb9979cd7600fdc8c6f79ac6c4cce3d2454c
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261027140000', '20261027140000_team_members_no_direct_minor_add', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261027140000');
COMMIT;
-- INSERT-PROTECTIVE | sha256 4f94ce0d56a39beb5d334ca075b22234361509edd264404424614127a6301ca7
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261027150000', '20261027150000_waitlist_notified_on_leave', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261027150000');
COMMIT;
-- INSERT-PROTECTIVE | sha256 1bead9eb15d57c9ff499d78e1b3b184f14b2e2ce63efdf5bd4a908c64c36473c
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261027160000', '20261027160000_trainer_org_no_forged_affiliation', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261027160000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 9ed9a92871865e9f85d5ed2f926c0483f62cb7249e608742663d86c2f81b9349
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261028120000', '20261028120000_message_attachment_checks', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261028120000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 f66fc2884aaec1f4331a11d5381e5930e15595cfebed103252a83a57dffedb21
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261028140000', '20261028140000_guardian_before_payment', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261028140000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 9145d553461d4162589b8edd345e69210a09e5ec097b7ddd6936033eacbf77c3
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261028150000', '20261028150000_host_blocks_stop_joins', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261028150000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 880347ab2bf0dc051aa37a0309ecd1aa9ff5f1e1ad4fb2fa24334b67582ab43e
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261028160000', '20261028160000_fix_revoke_parental_consent', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261028160000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 a673155922ed170c0e15350472aae812d9bc22d495765ac744c0a8adde531fff
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261028170000', '20261028170000_team_manager_null_guard', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261028170000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 4aa0af6cc1f5c1f2f432cbd41511c42e0c2739fd27a20391b5daddb477a7920b
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261028180000', '20261028180000_unsend_message_allows_deleted', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261028180000');
COMMIT;
-- INSERT-PROTECTIVE | sha256 2a313e271167c223b87c6578c151b0737aeff3b70d05ee59e00c05a6d853b12a
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261029120000', '20261029120000_remove_unclaimed_listing', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261029120000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 ebad1d40687e5bb8a2d4bbe79baf03dd4be726a9e399239e5d9eb5c3b6784c4c
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261029150000', '20261029150000_hosted_games_anon_minors_guard', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261029150000');
COMMIT;
-- INSERT-OPTIONAL (history only) | sha256 47133deda031639573b3720fe4c9b0c816ee61466106eaea0b5542458241511a
BEGIN;
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
SELECT '20261029190000', '20261029190000_highlight_reels_restricted_game_guard', array[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261029190000');
COMMIT;

-- ============================================================ B. after owner review (commented out)
-- postconditions: 8 object reference(s) present in production with identical fingerprint; 0 dropped/superseded by later files and absent in both; data: rows with org_id set and org_official not true = 0 (7 games in table)
-- -- INSERT-AFTER-OWNER-REVIEW | sha256 11fae6058b63379e0d0a8891178bd73674cd910dbdefd8e34ceb554ceed1ef91
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261006180000', '20261006180000_hosted_games_community_runs', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261006180000');
-- COMMIT;
-- postconditions: 14 object reference(s) present in production with identical fingerprint; 0 dropped/superseded by later files and absent in both; data: child_controls rows still at media_visibility=members = 0 (2 rows in table; weak evidence)
-- -- INSERT-AFTER-OWNER-REVIEW | sha256 687a1ed0079153a1472b390864119baa164f0936a8f4a4d2c89451f02c0c55ee
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261015120000', '20261015120000_teen_reel_team_approval', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261015120000');
-- COMMIT;
-- postconditions: 2 object reference(s) present in production with identical fingerprint; 0 dropped/superseded by later files and absent in both; data: teams with a URL in `avatar` and no `avatar_url` = 0 (45 teams)
-- -- INSERT-AFTER-OWNER-REVIEW | sha256 d566f87603ee2b4c379e154ede6b800bedab243162e74cbf21157b718cce3270
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261021130000', '20261021130000_team_logo_column', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261021130000');
-- COMMIT;
-- postconditions: 1 object reference(s) present in production with identical fingerprint; 0 dropped/superseded by later files and absent in both; data: team_posts of kind pickup = 0
-- -- INSERT-AFTER-OWNER-REVIEW | sha256 9da7d18e81d64fb486dcfa85565671deb10a771f24b27726a88f413ae375e70d
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261023110000', '20261023110000_team_posts_no_pickup', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261023110000');
-- COMMIT;
-- postconditions: 23 object reference(s) present in production with identical fingerprint; 0 dropped/superseded by later files and absent in both; data: minors without require_follow_approval = 0; follows of minors = 0 (follows table empty: weak evidence); DO block grants on 4 follow functions identical to production
-- -- INSERT-AFTER-OWNER-REVIEW | sha256 6a5219b8ce2b758de9ae35c10ccee2b093a08ca4d0412cfbc3640a33930df315
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261023130000', '20261023130000_follow_approval', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261023130000');
-- COMMIT;
-- postconditions: 0 object reference(s) present in production with identical fingerprint; 0 dropped/superseded by later files and absent in both; data: storage.buckets allowed_mime_types fingerprint identical for all 13 buckets (confidence raised from the automatic Low: the evidence is a direct bucket/setting check, see postconditions)
-- -- INSERT-AFTER-OWNER-REVIEW | sha256 c5f1bcc4056cdab8082eca297be94ff9527a8430c5b08c064732e6846d7bc55b
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261028130000', '20261028130000_image_bucket_mime_types', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261028130000');
-- COMMIT;

-- ============================================================ C. holds (commented out)
-- drift / note: Drift item D1: `enforce_review_integrity` definition (production is the structured-review version, captured by #245) and EXECUTE (production: service_role only; source: PUBLIC) - capture PR 'drift-captures' fixes the grant
-- -- HOLD-DRIFT | sha256 96de1ac2befa61fae05771ec5d746e8faffc7453a75d51bcf71b30971d10b6a1
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261012120000', '20261012120000_review_integrity', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261012120000');
-- COMMIT;
-- drift / note: Drift item D2: `review_ring_suspects` production definition uses alias `mean_rating`; source `avg_rating` - capture PR 'drift-captures'
-- -- HOLD-DRIFT | sha256 de6a5f4fdbde6c7e1d56a8518dd6124424616758f191f79c6bf219104df01e4f
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261012130000', '20261012130000_review_ring_detection', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261012130000');
-- COMMIT;
-- drift / note: `player_trait_counts` production definition differs (structured-review version) - captured by #245 (20261103110000)
-- -- HOLD-DRIFT | sha256 92e615527856930c1ec18619fe5297593eb8c85e071d1256f4447f9696c3c4fa
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261012140000', '20261012140000_review_ai', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261012140000');
-- COMMIT;
-- drift / note: Drift item D3: `enforce_skill_vote` EXECUTE (production: service_role only; source: PUBLIC) - capture PR 'drift-captures'
-- -- HOLD-DRIFT | sha256 220c4df493a854725b7953da46977f4f291a586385e71c54731ee30c610ab31f
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261012150000', '20261012150000_skill_ratings', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261012150000');
-- COMMIT;
-- drift / note: none
-- -- HOLD-OWNER | sha256 be6be45747778e8d633c7279c6478118c138a4d83533fda067fce9767d6a51a5
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261030120000', '20261030120000_sport_hubs_setting', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261030120000');
-- COMMIT;

-- ============================================================ D. the seven P0-1 files (optional supabase rows; Lovable writes drizzle rows)
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261103100000', '20261103100000_single_review_helpfuls_trigger', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261103100000');
-- COMMIT;
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261103101000', '20261103101000_capture_enforce_gym_review', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261103101000');
-- COMMIT;
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261103102000', '20261103102000_capture_review_ring_suspects', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261103102000');
-- COMMIT;
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261103103000', '20261103103000_revoke_enforce_skill_vote_execute', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261103103000');
-- COMMIT;
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261103104000', '20261103104000_revoke_enforce_review_integrity_execute', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261103104000');
-- COMMIT;
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261103130000', '20261103130000_profile_insert_guard', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261103130000');
-- COMMIT;
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261103140000', '20261103140000_payment_settings_host_guard', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261103140000');
-- COMMIT;

-- ============================================================ E. duplicate-version pairs (commented out; owner decides per #289)
-- -- INSERT-PROTECTIVE | sha256 b29f4ecc15b01546cddcff3fe8a0ba626b07c59caa312edd87c21510e42bfcad
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261008140000', '20261008140000_refund_policies', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261008140000');
-- COMMIT;
-- -- INSERT-PROTECTIVE | sha256 4a2cfad0277551f911972fb129061023899d6f3269d3291f6f0e0057fc5bf53a
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261008140000', '20261008140000_teen_reel_sharing', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261008140000');
-- COMMIT;
-- -- INSERT-PROTECTIVE | sha256 fae7996c35d56a930e6481eb1f3d342307f3e93dab9342edb2bf6e72ce851bc1
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261008160000', '20261008160000_family_post_links', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261008160000');
-- COMMIT;
-- -- INSERT-OPTIONAL (history only) | sha256 017eb9f75bcbfbd6e862204dfe72f68ed792e8f69ea5165583cf83e3e0772a6a
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261008160000', '20261008160000_guardian_cancel_child_game', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261008160000');
-- COMMIT;
-- -- INSERT-PROTECTIVE | sha256 6bca5ed6ff76a45fd24c0bda22413de474b4ecae7454718b2dad9b88fcf6d7ba
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261008170000', '20261008170000_family_post_team_tier', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261008170000');
-- COMMIT;
-- -- INSERT-PROTECTIVE | sha256 30c858c9c3f988ebbd77c6e39d383623ec058371849494d90508e7a34091af5d
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261008170000', '20261008170000_guardian_refund_notices', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261008170000');
-- COMMIT;
-- -- INSERT-OPTIONAL (history only) | sha256 fdb3d8675ab1fc2d45c61f92d43b47a7ffd72b824ab5ae453c07bdc873f446ef
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261020120000', '20261020120000_accept_message_request', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261020120000');
-- COMMIT;
-- -- INSERT-OPTIONAL (history only) | sha256 170ce696646a1d9f03bf80b709b22ce0972576c463442f147ee9fb253b5fad14
-- BEGIN;
-- INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
-- SELECT '20261020120000', '20261020120000_hide_posts_and_comments', array[]::text[]
-- WHERE NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261020120000');
-- COMMIT;
