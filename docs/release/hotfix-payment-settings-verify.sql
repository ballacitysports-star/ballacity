-- Read-only verification of hotfix 20261102100000 (payment-settings writes) on a Postgres 17 target. Catalog, ledgers
-- and one aggregate count: no row of application data is returned. One row per check; every `ok` must be true.
--   psql -X -v ON_ERROR_STOP=1 -f docs/release/hotfix-payment-settings-verify.sql
-- The statement between BEGIN and ROLLBACK is a single SELECT that does not depend on search_path, so it can also be
-- run on its own through Lovable's database tool (runbook, section 3).
-- Expected hashes are md5(pg_get_functiondef) / policy expressions from a replay of production's migrations plus this
-- hotfix on postgres:17. They are also what the release's 20261103140000 creates, so this check stays true after the
-- release until PRIV-2B part 2 (20261104120000) replaces the two functions.
BEGIN READ ONLY;
SET LOCAL search_path = '';
WITH expected_fn(sig, md5) AS (VALUES
    ('private_sec.game_payee(text)', '883af9b3905190368f4ea6efa29b088e'),
    ('private_sec.can_manage_game_payment_settings(text)', '5a61f1454e986888987775c3a5f5e9f1')),
expected_pol(name, md5) AS (VALUES
    ('Hosts manage own game payment settings (insert)', 'b68a6ffdc2c35755cd8614f061606cde'),
    ('Hosts manage own game payment settings (update)', 'b70856e55ed2d30e771e780685afcb34')),
checks(check_name, expected, actual) AS (
  SELECT 'server major', '17', (current_setting('server_version_num')::int / 10000)::text
  UNION ALL
  SELECT 'function ' || e.sig, e.md5, coalesce(md5(pg_get_functiondef(to_regprocedure(e.sig))), 'missing')
    FROM expected_fn e
  UNION ALL
  SELECT 'policy game_payment_settings / ' || e.name, e.md5,
         coalesce((SELECT md5(cmd || ':' || array_to_string(roles, '|') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''))
                     FROM pg_policies WHERE schemaname = 'public' AND tablename = 'game_payment_settings' AND policyname = e.name), 'missing')
    FROM expected_pol e
  UNION ALL
  SELECT 'execute on can_manage_game_payment_settings: authenticated yes, anon no', 'yes/no',
         CASE WHEN to_regprocedure('private_sec.can_manage_game_payment_settings(text)') IS NULL THEN 'missing'
              ELSE (CASE WHEN has_function_privilege('authenticated', 'private_sec.can_manage_game_payment_settings(text)', 'EXECUTE') THEN 'yes' ELSE 'no' END)
                   || '/' ||
                   (CASE WHEN has_function_privilege('anon', 'private_sec.can_manage_game_payment_settings(text)', 'EXECUTE') THEN 'yes' ELSE 'no' END) END
  UNION ALL
  SELECT 'execute on game_payee: authenticated no, anon no', 'no/no',
         CASE WHEN to_regprocedure('private_sec.game_payee(text)') IS NULL THEN 'missing'
              ELSE (CASE WHEN has_function_privilege('authenticated', 'private_sec.game_payee(text)', 'EXECUTE') THEN 'yes' ELSE 'no' END)
                   || '/' ||
                   (CASE WHEN has_function_privilege('anon', 'private_sec.game_payee(text)', 'EXECUTE') THEN 'yes' ELSE 'no' END) END
  UNION ALL
  SELECT 'row level security on public.game_payment_settings', 'on',
         CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.game_payment_settings')) THEN 'on' ELSE 'off' END
  UNION ALL
  SELECT 'settings rows held by someone other than the game''s host (count)', '0',
         (SELECT count(*) FROM public.game_payment_settings s JOIN public.hosted_games g ON g.id = s.game_id
           WHERE s.host_id IS DISTINCT FROM g.host_id)::text
  UNION ALL
  SELECT 'the reviewed text is recorded (drizzle hash, Lovable; or ledger version, psql)', 'recorded',
         CASE WHEN EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations d WHERE d.hash IN ('8f98b616625055b84f614d4bd9ee749196a2b7708ecb7143388398474d89fc8c', '6a1ae48d0c9f24a9085175c9f3e2030307d24d250effed6e20bc91f1d5f6a1d5'))
                OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations s WHERE s.version = '20261102100000')
              THEN 'recorded' ELSE 'not recorded' END)
SELECT check_name, expected, actual, actual = expected AS ok FROM checks;
ROLLBACK;
