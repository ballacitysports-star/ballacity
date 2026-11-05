-- Read-only verification of hotfix 20261031120000 (PR #287) on a Postgres 17 target. Catalog and ledgers only: no row
-- of application data is read or returned. One row per check; every `ok` must be true.
--   psql -X -v ON_ERROR_STOP=1 -f docs/release/hotfix-287-verify.sql
-- The statement between BEGIN and ROLLBACK is a single SELECT that does not depend on search_path, so it can also be
-- run on its own through Lovable's database tool (runbook, section 4).
-- Expected definition hashes are md5(pg_get_functiondef) / policy expressions from a replay of main + this migration on
-- postgres:17 (server_version_num 170011). Before the migration (or after its rollback) the definition checks report
-- missing; after an edited or older version, they report a different hash.
-- The text is recorded either way it can be applied: as the ledger row's statements[1] (release template, psql), or as
-- a drizzle ledger hash of the exact file text, with or without its final newline (Lovable's migration tool).
BEGIN READ ONLY;
SET LOCAL search_path = '';
WITH expected_fn(sig, md5) AS (VALUES
    ('public.lock_member_row_identity()', 'bca2a422bd388227d32988871deb2c9d'),
    ('public.lock_payment_refund_fields()', '612e04718c530da621ae085d3e682760'),
    ('public.hold_review_for_screening()', 'f12c50849551450ebd650a03c376124f'),
    ('public.release_review_screening(uuid,text,text)', '78bdcecb5fbfc6322dcae314f231300d'),
    ('public.guard_report_moderation_update()', '068bd940e53ddb701433327872acbeb7'),
    ('private_sec.record_review_hold(uuid,boolean)', '851776ed2f1f9cbe90a8b1c963686f4d'),
    ('private_sec.review_is_held(uuid)', '5ce9a60eabb13e7e570627aee0a79d2a'),
    ('private_sec.audit_report_change(jsonb,jsonb)', '8bdd186d68de18629ea7d481a4bbecf1')),
expected_pol(name, md5) AS (VALUES
    ('Users can write reviews as themselves', '5f0dc7c039e6aff0e5af6ea2997e9887'),
    ('Reviewees view their private reviews', '72b568b64e479024e34a28b7ae9f284b')),
expected_trg(rel, name, fn) AS (VALUES
    ('public.team_members', 'a0_team_members_identity_locked', 'public.lock_member_row_identity()'),
    ('public.payment_submissions', 'a00_payment_refund_fields_locked', 'public.lock_payment_refund_fields()'),
    ('public.reviews', 'zz_reviews_hold_for_screening', 'public.hold_review_for_screening()'),
    ('public.user_reports', 'zz_user_reports_moderation_guard', 'public.guard_report_moderation_update()')),
checks(check_name, expected, actual) AS (
  SELECT 'server major', '17', (current_setting('server_version_num')::int / 10000)::text
  UNION ALL
  SELECT 'function ' || e.sig, e.md5,
         coalesce(md5(pg_get_functiondef(to_regprocedure(e.sig))), 'missing')
    FROM expected_fn e
  UNION ALL
  SELECT 'policy reviews / ' || e.name, e.md5,
         coalesce((SELECT md5(cmd || ':' || array_to_string(roles, '|') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''))
                     FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reviews' AND policyname = e.name), 'missing')
    FROM expected_pol e
  UNION ALL
  SELECT 'trigger ' || e.rel || ' / ' || e.name, 'enabled, calls ' || e.fn,
         coalesce((SELECT CASE WHEN t.tgenabled = 'O' THEN 'enabled' ELSE 'state ' || t.tgenabled::text END
                          || ', calls ' || n.nspname || '.' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')'
                     FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE NOT t.tgisinternal AND t.tgname = e.name AND t.tgrelid = to_regclass(e.rel)), 'missing')
    FROM expected_trg e
  UNION ALL
  SELECT 'release_review_screening callable by ' || r.role, r.expect::text,
         coalesce(has_function_privilege(r.role, to_regprocedure('public.release_review_screening(uuid,text,text)'), 'EXECUTE')::text, 'missing')
    FROM (VALUES ('service_role', true), ('authenticated', false), ('anon', false)) r(role, expect)
  UNION ALL
  SELECT 'review_screening_holds not readable by ' || r.role, 'false',
         coalesce(has_table_privilege(r.role, to_regclass('private_sec.review_screening_holds'), 'SELECT')::text, 'missing')
    FROM (VALUES ('authenticated'), ('anon')) r(role)
  UNION ALL
  SELECT 'the reviewed text is recorded (' || CASE
           WHEN EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations s WHERE s.version = '20261031120000')
             THEN 'ledger row, release template)'
           WHEN EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations d WHERE d.hash IN (
                  '843e356b69c732ba0f335447e920b5f954029bada2d6c7c85d0a97f0fe13a6c1',
                  'ef17f8dd6b530f1a04a5dc700299e9759d50da930abdbe9609afcd1e5f971089'))
             THEN 'drizzle ledger, Lovable)'
           ELSE 'no record)' END,
         '843e356b69c732ba0f335447e920b5f954029bada2d6c7c85d0a97f0fe13a6c1',
         CASE
           WHEN EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations s WHERE s.version = '20261031120000') THEN
             (SELECT CASE
                       WHEN encode(sha256(convert_to(s.statements[1], 'UTF8')), 'hex') = '843e356b69c732ba0f335447e920b5f954029bada2d6c7c85d0a97f0fe13a6c1'
                         OR encode(sha256(convert_to(s.statements[1] || E'\n', 'UTF8')), 'hex') = '843e356b69c732ba0f335447e920b5f954029bada2d6c7c85d0a97f0fe13a6c1'
                       THEN '843e356b69c732ba0f335447e920b5f954029bada2d6c7c85d0a97f0fe13a6c1'
                       ELSE 'ledger row with a different or empty text (name ' || coalesce(s.name, 'null') || ')' END
                FROM supabase_migrations.schema_migrations s WHERE s.version = '20261031120000')
           WHEN EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations d WHERE d.hash IN (
                  '843e356b69c732ba0f335447e920b5f954029bada2d6c7c85d0a97f0fe13a6c1',
                  'ef17f8dd6b530f1a04a5dc700299e9759d50da930abdbe9609afcd1e5f971089'))
             THEN '843e356b69c732ba0f335447e920b5f954029bada2d6c7c85d0a97f0fe13a6c1'
           ELSE 'no ledger row and no drizzle row with the file hash'
         END)
SELECT check_name, expected, actual, (expected = actual) AS ok FROM checks ORDER BY ok, check_name;
ROLLBACK;
