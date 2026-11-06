-- Read-only pre-check before the seven merged-but-unapplied migrations (P0-1) are applied to the production
-- Postgres 17 target. Catalog, ledgers and two aggregate counts: no row of application data is returned. One row
-- per check; every `ok` must be true before applying anything.
--   psql -X -v ON_ERROR_STOP=1 -f docs/release/p0-1-precheck.sql
-- The statement between BEGIN and ROLLBACK is a single SELECT that does not depend on search_path, so it can also be
-- run on its own through Lovable's database tool (runbook, section 3).
--
-- What it confirms, in three groups (runbook section 1):
--   * the five drift captures (20261103100000 .. 20261103104000) describe what production ALREADY has, so applying
--     them changes nothing: the captured function texts match by md5, the grants are service-role only, and the
--     duplicate helpful-count trigger is absent;
--   * the two real fixes (20261103130000 profile_insert_guard, 20261103140000 payment_settings_host_guard) are NOT yet
--     present, while the write-half hotfix 20261102100000 they build on IS present (helpers and write policies by md5),
--     and the read policy they replace is exactly the one production had, so the rollback restores this state;
--   * no settings row and no payment claim names a payee other than the game's host (the full fix adds a trigger that
--     would refuse new ones; an existing one means the hole was used and must be reviewed first);
--   * none of the seven is recorded in either ledger yet.
-- Function md5s are md5(pg_get_functiondef(...)) from a replay of main on postgres:16 (2026-11-06); trigger md5s are of
-- pg_get_triggerdef with the schema prefix removed, so they do not depend on the session's search_path (Lovable's tool and the
-- Management API run the bare SELECT); the capture files'
-- headers state the same values as read from production on 2026-11-03. Function bodies that Lovable may have applied
-- comment-stripped are checked for presence only.
BEGIN READ ONLY;
SET LOCAL search_path = '';
WITH captured_fn(sig, md5) AS (VALUES
    ('public.enforce_gym_review()', '1c776a864a0f9e4aac3d17d45cf31c9f'),
    ('public.review_ring_suspects(integer)', 'f41ec9f31e2ef4b00a08dde328ea4f51')),
svc_only_fn(sig) AS (VALUES
    ('public.enforce_skill_vote()'), ('public.enforce_review_integrity()'), ('public.enforce_gym_review()')),
hotfix_fn(sig, md5) AS (VALUES
    ('private_sec.game_payee(text)', '883af9b3905190368f4ea6efa29b088e'),
    ('private_sec.can_manage_game_payment_settings(text)', '5a61f1454e986888987775c3a5f5e9f1')),
before_pol(name, md5) AS (VALUES
    ('Hosts manage own game payment settings (insert)', 'b68a6ffdc2c35755cd8614f061606cde'),
    ('Hosts manage own game payment settings (update)', 'b70856e55ed2d30e771e780685afcb34'),
    ('Hosts manage own game payment settings (delete)', '5cf8024614c94bf797fa49201f6a36dd'),
    ('Host and linked players read payment settings', 'a1645286b9978be327bf19a5a1b4ac94')),
not_yet_fn(sig) AS (VALUES
    ('public.guard_profile_insert()'), ('public.game_payee_id(text)'),
    ('private_sec.can_read_game_payment_settings(text,uuid)'), ('public.enforce_payment_destination()')),
present_fn(sig) AS (VALUES
    ('public.enforce_game_join_gate()'), ('public.validate_join_request()'), ('public.enforce_approval_before_payment()'),
    ('public.release_expired_payment_holds(text)'), ('public.settle_paid_spot(text,uuid,text)'),
    ('public.get_game_refund_terms(text)'), ('public.get_game_host_payment_methods(uuid,text)')),
versions(v) AS (VALUES
    ('20261103100000'), ('20261103101000'), ('20261103102000'), ('20261103103000'), ('20261103104000'),
    ('20261103130000'), ('20261103140000')),
drizzle_hashes(h) AS (VALUES
    ('c7040ea0de8b971da3b294c8489f4bb64f01b246a3daadab346ed5ae7e8fbf70'), ('7f1d3e836e98fddf4405f6485b815a7a26d90ab433ce0c75032e4ecad79f164f'),
    ('553ced7669d0b1b914bf33a934d3c0dde24d53d98e7e31c992c604bcc7b1768b'), ('d799c8edfbfe121ebc62ad6e1bd7ae8a4060df007cc3413fede78bd0aae0e1b3'),
    ('cadae5a3d1393b95c9502128f26ad5815706d1bd213cb747c1da09bd870918b1'), ('8cb455542f25bd90fd68747de71cba094f69aaf3ce01e1f08020ecbff70ed6f5'),
    ('2d1258558f49a8861dcdea2372f41ae9e5fa830007dba54f67166a9d6f82be82'), ('ac6d6168da2fcd6d4ebe5d3796e7c61a2f204a26583d8d53a1ff3c2bdfb5048a'),
    ('3b76ac3b41306dd14bc7cbd89b2a03be3670a02f1bb64d6d459f9f679740d72c'), ('f226a8442e0d8d4284a26d3c488ff9075b43ae2a9eab8d0a04157c10c5fbac4f'),
    ('2194cbdc6229ef5332e47129208ffed23f58d462d6a26ec297bf474caedf8b8f'), ('e441cfb8d70b7471ccf5cf28e91a2e3b569296b5478482df096bef4857cc5131'),
    ('5c74b31e9ca99617b731b4361758acf8fb7b5e164c0008143e19b1d7006eb678'), ('3e0877265ada0373145900a5a3d9750a389f10f60cb8323ee4eb46cccee6caed')),
pol_md5 AS (
  SELECT policyname AS name, md5(regexp_replace(cmd || ':' || array_to_string(roles, '|') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), '\mpublic\.', '', 'g')) AS md5
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'game_payment_settings'),
checks(check_name, expected, actual) AS (
  SELECT 'server major', '17', (current_setting('server_version_num')::int / 10000)::text
  UNION ALL
  SELECT 'capture already in place: ' || e.sig, e.md5, coalesce(md5(pg_get_functiondef(to_regprocedure(e.sig))), 'missing') FROM captured_fn e
  UNION ALL
  SELECT 'capture already in place: EXECUTE on ' || e.sig || ' is service_role only', 'no/no/yes',
         CASE WHEN to_regprocedure(e.sig) IS NULL THEN 'missing' ELSE
           (CASE WHEN has_function_privilege('anon', to_regprocedure(e.sig), 'EXECUTE') THEN 'yes' ELSE 'no' END) || '/' ||
           (CASE WHEN has_function_privilege('authenticated', to_regprocedure(e.sig), 'EXECUTE') THEN 'yes' ELSE 'no' END) || '/' ||
           (CASE WHEN has_function_privilege('service_role', to_regprocedure(e.sig), 'EXECUTE') THEN 'yes' ELSE 'no' END) END
    FROM svc_only_fn e
  UNION ALL
  SELECT 'capture already in place: trigger review_helpfuls.bump_helpful_count_trg absent', 'absent',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.review_helpfuls') AND t.tgname = 'bump_helpful_count_trg') THEN 'present' ELSE 'absent' END
  UNION ALL
  SELECT 'capture already in place: trigger review_helpfuls.trg_review_helpfuls_count', 'aea08d1715ed8199488c43f83fad23f0',
         coalesce((SELECT md5(regexp_replace(pg_get_triggerdef(t.oid), '\mpublic\.', '', 'g')) FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.review_helpfuls') AND t.tgname = 'trg_review_helpfuls_count'), 'missing')
  UNION ALL
  SELECT 'hotfix 20261102100000 present: ' || e.sig, e.md5, coalesce(md5(pg_get_functiondef(to_regprocedure(e.sig))), 'missing') FROM hotfix_fn e
  UNION ALL
  SELECT 'policy game_payment_settings / ' || e.name || ' (as before the full fix)', e.md5, coalesce((SELECT md5 FROM pol_md5 p WHERE p.name = e.name), 'missing') FROM before_pol e
  UNION ALL
  SELECT 'not yet present: ' || e.sig, 'missing', CASE WHEN to_regprocedure(e.sig) IS NULL THEN 'missing' ELSE 'present' END FROM not_yet_fn e
  UNION ALL
  SELECT 'not yet present: trigger profiles.aa_guard_profile_insert_trg', 'absent',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.profiles') AND t.tgname = 'aa_guard_profile_insert_trg') THEN 'present' ELSE 'absent' END
  UNION ALL
  SELECT 'not yet present: trigger payment_submissions.aa_payment_destination_trg', 'absent',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.payment_submissions') AND t.tgname = 'aa_payment_destination_trg') THEN 'present' ELSE 'absent' END
  UNION ALL
  SELECT 'present (replaced by the full fix): ' || e.sig, 'present', CASE WHEN to_regprocedure(e.sig) IS NULL THEN 'missing' ELSE 'present' END FROM present_fn e
  UNION ALL
  SELECT 'prerequisites: private_sec usable by authenticated, auth.uid(), admin_audit_log', 'yes',
         CASE WHEN to_regnamespace('private_sec') IS NOT NULL AND has_schema_privilege('authenticated', 'private_sec', 'USAGE')
                   AND to_regprocedure('auth.uid()') IS NOT NULL AND to_regclass('public.admin_audit_log') IS NOT NULL THEN 'yes' ELSE 'no' END
  UNION ALL
  SELECT 'settings rows held by someone other than the game''s host (count)', '0',
         (SELECT count(*) FROM public.game_payment_settings s JOIN public.hosted_games g ON g.id = s.game_id WHERE s.host_id IS DISTINCT FROM g.host_id)::text
  UNION ALL
  SELECT 'payment claims naming a payee other than the game''s host (count)', '0',
         (SELECT count(*) FROM public.payment_submissions p JOIN public.hosted_games g ON g.id = p.game_id WHERE p.host_id IS DISTINCT FROM g.host_id)::text
  UNION ALL
  SELECT 'not yet recorded: supabase ledger versions', 'none',
         CASE WHEN EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations s JOIN versions v ON v.v = s.version) THEN 'recorded' ELSE 'none' END
  UNION ALL
  SELECT 'not yet recorded: drizzle ledger hashes (either newline form)', 'none',
         CASE WHEN EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations d JOIN drizzle_hashes h ON h.h = d.hash) THEN 'recorded' ELSE 'none' END)
SELECT check_name, expected, actual, actual = expected AS ok FROM checks;
ROLLBACK;
