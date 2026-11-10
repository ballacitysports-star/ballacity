-- Read-only pre-check before hotfix 20261102100000 (payment-settings writes) is applied to a Postgres 17 target.
-- Catalog, ledgers and one aggregate count: no row of application data is returned. One row per check; every `ok`
-- must be true before applying.
--   psql -X -v ON_ERROR_STOP=1 -f docs/release/hotfix-payment-settings-precheck.sql
-- The statement between BEGIN and ROLLBACK is a single SELECT that does not depend on search_path, so it can also be
-- run on its own through Lovable's database tool (runbook, section 3).
-- Both ledger tables must exist (production has both). It confirms that the target holds neither helper the hotfix creates and no record of it in either ledger, that the
-- two write policies it replaces are exactly the ones production had on 2026-11-05 (so the rollback restores this very
-- state), and that no settings row is held by anyone but its game's host (the hotfix refuses to finish otherwise).
BEGIN READ ONLY;
SET LOCAL search_path = '';
WITH before_pol(name, md5) AS (VALUES
    ('Hosts manage own game payment settings (insert)', '6a8cb6a37ae7876cbd4852f1f605d324'),
    ('Hosts manage own game payment settings (update)', '946ffc22fe902ec137262b891b91a8f2')),
checks(check_name, expected, actual) AS (
  SELECT 'server major', '17', (current_setting('server_version_num')::int / 10000)::text
  UNION ALL
  SELECT 'not yet present: function ' || f.sig, 'missing',
         CASE WHEN to_regprocedure(f.sig) IS NULL THEN 'missing' ELSE 'present' END
    FROM (VALUES ('private_sec.game_payee(text)'), ('private_sec.can_manage_game_payment_settings(text)')) f(sig)
  UNION ALL
  SELECT 'policy game_payment_settings / ' || e.name || ' (as before the hotfix)', e.md5,
         coalesce((SELECT md5(cmd || ':' || array_to_string(roles, '|') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''))
                     FROM pg_policies WHERE schemaname = 'public' AND tablename = 'game_payment_settings' AND policyname = e.name), 'missing')
    FROM before_pol e
  UNION ALL
  SELECT 'row level security on public.game_payment_settings', 'on',
         CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.game_payment_settings')) THEN 'on' ELSE 'off' END
  UNION ALL
  SELECT 'prerequisite: schema private_sec usable by authenticated', 'yes',
         CASE WHEN to_regnamespace('private_sec') IS NOT NULL AND has_schema_privilege('authenticated', 'private_sec', 'USAGE') THEN 'yes' ELSE 'no' END
  UNION ALL
  SELECT 'prerequisite: function auth.uid()', 'yes', CASE WHEN to_regprocedure('auth.uid()') IS NOT NULL THEN 'yes' ELSE 'no' END
  UNION ALL
  SELECT 'prerequisite: hosted_games.host_id uuid, game_payment_settings.game_id text', 'uuid/text',
         coalesce((SELECT format_type(atttypid, atttypmod) FROM pg_attribute
                    WHERE attrelid = to_regclass('public.hosted_games') AND attname = 'host_id' AND NOT attisdropped), '?')
         || '/' ||
         coalesce((SELECT format_type(atttypid, atttypmod) FROM pg_attribute
                    WHERE attrelid = to_regclass('public.game_payment_settings') AND attname = 'game_id' AND NOT attisdropped), '?')
  UNION ALL
  SELECT 'settings rows held by someone other than the game''s host (count)', '0',
         (SELECT count(*) FROM public.game_payment_settings s JOIN public.hosted_games g ON g.id = s.game_id
           WHERE s.host_id IS DISTINCT FROM g.host_id)::text
  UNION ALL
  SELECT 'not yet recorded: drizzle ledger hash of the hotfix text', 'none',
         CASE WHEN EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations d WHERE d.hash IN ('8f98b616625055b84f614d4bd9ee749196a2b7708ecb7143388398474d89fc8c', '6a1ae48d0c9f24a9085175c9f3e2030307d24d250effed6e20bc91f1d5f6a1d5'))
              THEN 'recorded' ELSE 'none' END
  UNION ALL
  SELECT 'not yet recorded: supabase ledger version 20261102100000', 'none',
         CASE WHEN EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations s WHERE s.version = '20261102100000')
              THEN 'recorded' ELSE 'none' END)
SELECT check_name, expected, actual, actual = expected AS ok FROM checks;
ROLLBACK;
