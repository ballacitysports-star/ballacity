-- Read-only pre-check before hotfix 20261031120000 (PR #287) is applied to a Postgres 17 target. Catalog and ledgers
-- only: no row of application data is read or returned. One row per check; every `ok` must be true before applying.
--   psql -X -v ON_ERROR_STOP=1 -f docs/release/hotfix-287-precheck.sql
-- The statement between BEGIN and ROLLBACK is a single SELECT that does not depend on search_path, so it can also be
-- run on its own through Lovable's database tool (runbook, section 4).
-- It confirms that the target holds none of the hotfix's objects and no record of it in either ledger (a ledger row,
-- or a drizzle row with the file's hash as Lovable's migration tool writes it), and that it holds exactly
-- what `main` defines for what the hotfix touches: the two review policies it replaces (so the rollback restores this
-- very state) and the triggers on the four tables (the new triggers rely on their name order). Expected values are
-- from a replay of `main` on postgres:17 (server_version_num 170011).
BEGIN READ ONLY;
SET LOCAL search_path = '';
WITH absent(label, present) AS (VALUES
    ('function public.lock_member_row_identity()', to_regprocedure('public.lock_member_row_identity()') IS NOT NULL),
    ('function public.lock_payment_refund_fields()', to_regprocedure('public.lock_payment_refund_fields()') IS NOT NULL),
    ('function public.hold_review_for_screening()', to_regprocedure('public.hold_review_for_screening()') IS NOT NULL),
    ('function public.release_review_screening(uuid,text,text)',
       to_regprocedure('public.release_review_screening(uuid,text,text)') IS NOT NULL),
    ('function public.release_review_screening(uuid) (an early draft of #287)',
       to_regprocedure('public.release_review_screening(uuid)') IS NOT NULL),
    ('function public.guard_report_moderation_update()', to_regprocedure('public.guard_report_moderation_update()') IS NOT NULL),
    ('function private_sec.record_review_hold(uuid,boolean)', to_regprocedure('private_sec.record_review_hold(uuid,boolean)') IS NOT NULL),
    ('function private_sec.review_is_held(uuid)', to_regprocedure('private_sec.review_is_held(uuid)') IS NOT NULL),
    ('function private_sec.audit_report_change(jsonb,jsonb)', to_regprocedure('private_sec.audit_report_change(jsonb,jsonb)') IS NOT NULL),
    ('table private_sec.review_screening_holds', to_regclass('private_sec.review_screening_holds') IS NOT NULL)),
main_pol(name, md5) AS (VALUES
    ('Users can write reviews as themselves', '01b79fb400dc4c25adc5849bd7df052f'),
    ('Reviewees view their private reviews', '67d44fc97f3a910dec5271ef538b0b37')),
main_trg(rel, names) AS (VALUES
    ('public.team_members', 'guard_team_member_role_change_trg, team_members_updated_at'),
    ('public.payment_submissions', 'aa_payment_destination_trg, enforce_approval_before_payment_trg, enforce_game_payment_cohort, '
       || 'no_payment_credentials, payment_submissions_guardian_first, payment_submissions_keep_verified, '
       || 'payment_submissions_state_guard, trg_guard_payment_player_fields, trg_log_payment_verification_event'),
    ('public.reviews', 'enforce_gym_review_trg, enforce_review_integrity_trg'),
    ('public.user_reports', 'user_reports_start_as_new, user_reports_touch_updated_at')),
prereq(label, ok) AS (VALUES
    ('schema private_sec', to_regnamespace('private_sec') IS NOT NULL),
    ('function auth.uid()', to_regprocedure('auth.uid()') IS NOT NULL),
    ('roles anon, authenticated, service_role',
       (SELECT count(*) = 3 FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role'))),
    ('admin_audit_log has actor_id, action, target_type, target_id, before, after',
       (SELECT count(*) = 6 FROM pg_attribute WHERE attrelid = to_regclass('public.admin_audit_log') AND NOT attisdropped
          AND attname IN ('actor_id', 'action', 'target_type', 'target_id', 'before', 'after')))),
checks(check_name, expected, actual) AS (
  SELECT 'server major', '17', (current_setting('server_version_num')::int / 10000)::text
  UNION ALL
  SELECT 'not yet present: ' || a.label, 'missing', CASE WHEN a.present THEN 'present' ELSE 'missing' END
    FROM absent a
  UNION ALL
  SELECT 'not yet present: trigger ' || t.name, 'missing',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = t.name) THEN 'present' ELSE 'missing' END
    FROM (VALUES ('a0_team_members_identity_locked'), ('a00_payment_refund_fields_locked'),
                 ('zz_reviews_hold_for_screening'), ('zz_user_reports_moderation_guard')) t(name)
  UNION ALL
  SELECT 'policy reviews / ' || e.name || ' (as on main)', e.md5,
         coalesce((SELECT md5(cmd || ':' || array_to_string(roles, '|') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''))
                     FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reviews' AND policyname = e.name), 'missing')
    FROM main_pol e
  UNION ALL
  SELECT 'triggers on ' || e.rel || ' (as on main)', e.names,
         coalesce((SELECT string_agg(t.tgname, ', ' ORDER BY t.tgname)
                     FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid = to_regclass(e.rel)), 'none')
    FROM main_trg e
  UNION ALL
  SELECT 'prerequisite: ' || p.label, 'present', CASE WHEN p.ok THEN 'present' ELSE 'missing' END
    FROM prereq p
  UNION ALL
  SELECT 'not yet recorded: no ledger row, no drizzle row with the file hash', 'none',
         coalesce(nullif(concat_ws(', ',
           (SELECT 'ledger row (name ' || coalesce(s.name, 'null') || ')'
              FROM supabase_migrations.schema_migrations s WHERE s.version = '20261031120000'),
           (SELECT count(*) || ' drizzle row(s) with the file hash' FROM drizzle.__drizzle_migrations d
             WHERE d.hash IN ('843e356b69c732ba0f335447e920b5f954029bada2d6c7c85d0a97f0fe13a6c1',
                              'ef17f8dd6b530f1a04a5dc700299e9759d50da930abdbe9609afcd1e5f971089')
            HAVING count(*) > 0)), ''), 'none'))
SELECT check_name, expected, actual, (expected = actual) AS ok FROM checks ORDER BY ok, check_name;
ROLLBACK;
