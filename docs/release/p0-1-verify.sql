-- Read-only verification after the seven P0-1 migrations have been applied to the production Postgres 17 target.
-- Catalog, ledgers and two aggregate counts: no row of application data is returned. One row per check; every `ok`
-- must be true.
--   psql -X -v ON_ERROR_STOP=1 -f docs/release/p0-1-verify.sql
-- The statement between BEGIN and ROLLBACK is a single SELECT that does not depend on search_path, so it can also be
-- run on its own through Lovable's database tool (runbook, section 3).
-- Expected md5s are md5(pg_get_functiondef) / policy expressions / trigger definitions (schema prefix removed, so the value
-- does not depend on search_path) from a replay of main on
-- postgres:16 (2026-11-06) after the seven files; they are the texts in the repository, so they hold on 17 too
-- (the 2026-11-05 hotfix rehearsal found the same values on 16 and 17). The ledger check accepts, per file, a
-- supabase ledger row (psql path) or a drizzle row with the file's sha256 with or without its final newline (Lovable).
BEGIN READ ONLY;
SET LOCAL search_path = '';
WITH expected_fn(sig, md5, exec) AS (VALUES
    ('public.enforce_gym_review()', '1c776a864a0f9e4aac3d17d45cf31c9f', 'no/no/yes'),
    ('public.review_ring_suspects(integer)', 'f41ec9f31e2ef4b00a08dde328ea4f51', 'no/yes/yes'),
    ('public.guard_profile_insert()', '0a5bf62fa1a84f369d10be46a9bbe4dc', 'no/no/yes'),
    ('private_sec.game_payee(text)', '883af9b3905190368f4ea6efa29b088e', 'no/no/yes'),
    ('public.game_payee_id(text)', '67eeb66c163762cd7785055e215395fc', 'no/no/yes'),
    ('private_sec.can_manage_game_payment_settings(text)', '5a61f1454e986888987775c3a5f5e9f1', 'no/yes/yes'),
    ('private_sec.can_read_game_payment_settings(text,uuid)', '146c08b9c2a10ee4004ffefdc9924cca', 'no/yes/yes'),
    ('public.enforce_payment_destination()', '9966e4bbbab1c529c669a5f0d0b4a6f8', 'no/no/yes'),
    ('public.validate_join_request()', '360371fe6b5b898d64af524f45ca563c', 'no/no/yes'),
    ('public.enforce_approval_before_payment()', '3ffff8c3b95ae10ce43cdc4197cc886a', 'no/no/yes'),
    ('public.enforce_game_join_gate()', '9d4924a2d53915fca8fa245e15281a25', 'no/no/yes'),
    ('public.release_expired_payment_holds(text)', '3eee00253e98ac807138ccf333f1c498', 'no/yes/yes'),
    ('public.settle_paid_spot(text,uuid,text)', '57f56d6ca1f73350c5896219236713ee', 'no/no/yes'),
    ('public.get_game_refund_terms(text)', 'b3a83c3ae050ffd7f92869d29df5c6b5', 'yes/yes/yes'),
    ('public.get_game_host_payment_methods(uuid,text)', 'ca5a74909181a98cf1416c6a5d37d156', 'no/yes/yes')),
exec_only_fn(sig, exec) AS (VALUES
    ('public.enforce_skill_vote()', 'no/no/yes'),
    ('public.enforce_review_integrity()', 'no/no/yes')),   -- body differs in production by design (#245 captures it)
expected_pol(name, md5) AS (VALUES
    ('Hosts manage own game payment settings (insert)', 'b68a6ffdc2c35755cd8614f061606cde'),
    ('Hosts manage own game payment settings (update)', 'b70856e55ed2d30e771e780685afcb34'),
    ('Hosts manage own game payment settings (delete)', '5cf8024614c94bf797fa49201f6a36dd'),
    ('Host and linked players read payment settings', 'fc599566945daf0d6af7afb3f63b8061')),
expected_trg(rel, name, md5) AS (VALUES
    ('public.review_helpfuls', 'trg_review_helpfuls_count', 'aea08d1715ed8199488c43f83fad23f0'),
    ('public.profiles', 'aa_guard_profile_insert_trg', '6ecf4dea36ca2f7bd82200121aecbdec'),
    ('public.payment_submissions', 'aa_payment_destination_trg', '6796c3c0659acc4e5f777ba3302d1050')),
files(version, h1, h2) AS (VALUES
    ('20261103100000', 'c7040ea0de8b971da3b294c8489f4bb64f01b246a3daadab346ed5ae7e8fbf70', '7f1d3e836e98fddf4405f6485b815a7a26d90ab433ce0c75032e4ecad79f164f'),
    ('20261103101000', '553ced7669d0b1b914bf33a934d3c0dde24d53d98e7e31c992c604bcc7b1768b', 'd799c8edfbfe121ebc62ad6e1bd7ae8a4060df007cc3413fede78bd0aae0e1b3'),
    ('20261103102000', 'cadae5a3d1393b95c9502128f26ad5815706d1bd213cb747c1da09bd870918b1', '8cb455542f25bd90fd68747de71cba094f69aaf3ce01e1f08020ecbff70ed6f5'),
    ('20261103103000', '2d1258558f49a8861dcdea2372f41ae9e5fa830007dba54f67166a9d6f82be82', 'ac6d6168da2fcd6d4ebe5d3796e7c61a2f204a26583d8d53a1ff3c2bdfb5048a'),
    ('20261103104000', '3b76ac3b41306dd14bc7cbd89b2a03be3670a02f1bb64d6d459f9f679740d72c', 'f226a8442e0d8d4284a26d3c488ff9075b43ae2a9eab8d0a04157c10c5fbac4f'),
    ('20261103130000', '2194cbdc6229ef5332e47129208ffed23f58d462d6a26ec297bf474caedf8b8f', 'e441cfb8d70b7471ccf5cf28e91a2e3b569296b5478482df096bef4857cc5131'),
    ('20261103140000', '5c74b31e9ca99617b731b4361758acf8fb7b5e164c0008143e19b1d7006eb678', '3e0877265ada0373145900a5a3d9750a389f10f60cb8323ee4eb46cccee6caed')),
pol_md5 AS (
  SELECT policyname AS name, md5(regexp_replace(cmd || ':' || array_to_string(roles, '|') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), '\mpublic\.', '', 'g')) AS md5
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'game_payment_settings'),
checks(check_name, expected, actual) AS (
  SELECT 'server major', '17', (current_setting('server_version_num')::int / 10000)::text
  UNION ALL
  SELECT 'function ' || e.sig, e.md5, coalesce(md5(pg_get_functiondef(to_regprocedure(e.sig))), 'missing') FROM expected_fn e
  UNION ALL
  SELECT 'EXECUTE anon/authenticated/service_role on ' || e.sig, e.exec,
         CASE WHEN to_regprocedure(e.sig) IS NULL THEN 'missing' ELSE
           (CASE WHEN has_function_privilege('anon', to_regprocedure(e.sig), 'EXECUTE') THEN 'yes' ELSE 'no' END) || '/' ||
           (CASE WHEN has_function_privilege('authenticated', to_regprocedure(e.sig), 'EXECUTE') THEN 'yes' ELSE 'no' END) || '/' ||
           (CASE WHEN has_function_privilege('service_role', to_regprocedure(e.sig), 'EXECUTE') THEN 'yes' ELSE 'no' END) END
    FROM (SELECT sig, exec FROM expected_fn UNION ALL SELECT sig, exec FROM exec_only_fn) e
  UNION ALL
  SELECT 'policy game_payment_settings / ' || e.name, e.md5, coalesce((SELECT md5 FROM pol_md5 p WHERE p.name = e.name), 'missing') FROM expected_pol e
  UNION ALL
  SELECT 'policy count on game_payment_settings', '4', (SELECT count(*)::text FROM pol_md5)
  UNION ALL
  SELECT 'trigger ' || e.rel || '.' || e.name, e.md5,
         coalesce((SELECT md5(regexp_replace(pg_get_triggerdef(t.oid), '\mpublic\.', '', 'g')) FROM pg_trigger t WHERE t.tgrelid = to_regclass(e.rel) AND t.tgname = e.name), 'missing')
    FROM expected_trg e
  UNION ALL
  SELECT 'trigger review_helpfuls.bump_helpful_count_trg absent', 'absent',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.review_helpfuls') AND t.tgname = 'bump_helpful_count_trg') THEN 'present' ELSE 'absent' END
  UNION ALL
  SELECT 'row level security on game_payment_settings, payment_submissions, profiles', 'on/on/on',
         (SELECT string_agg(CASE WHEN relrowsecurity THEN 'on' ELSE 'off' END, '/' ORDER BY relname)
            FROM pg_class WHERE oid IN (to_regclass('public.game_payment_settings'), to_regclass('public.payment_submissions'), to_regclass('public.profiles')))
  UNION ALL
  SELECT 'settings rows held by someone other than the game''s host (count)', '0',
         (SELECT count(*) FROM public.game_payment_settings s JOIN public.hosted_games g ON g.id = s.game_id WHERE s.host_id IS DISTINCT FROM g.host_id)::text
  UNION ALL
  SELECT 'payment claims naming a payee other than the game''s host (count)', '0',
         (SELECT count(*) FROM public.payment_submissions p JOIN public.hosted_games g ON g.id = p.game_id WHERE p.host_id IS DISTINCT FROM g.host_id)::text
  UNION ALL
  SELECT 'recorded: ' || f.version, 'recorded',
         CASE WHEN EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations s WHERE s.version = f.version)
                OR EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations d WHERE d.hash IN (f.h1, f.h2))
              THEN 'recorded' ELSE 'not recorded' END
    FROM files f)
SELECT check_name, expected, actual, actual = expected AS ok FROM checks;
ROLLBACK;
