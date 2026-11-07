-- Read-only pre-check before the four held safety migrations are applied to the production Postgres 17 target:
--   1. 20261106150000_close_authenticated_oracles      (#300, P0-2)
--   2. 20261106160000_refuse_under13_self_registration (#314, P0-13)
--   3. 20261106210000_youth_post_venue_privacy         (#330, D0)
--   4. 20261106200000_telemetry_age_gating             (#332, P3-7)
-- Run it AFTER the P0-1 runbook (docs/release/p0-1-reconciliation-runbook.md) steps B to D: it expects P0-1's fixes in place.
--
-- Catalog, ledger and aggregate counts only: no row of application data is returned. One row per check. Every row whose
-- `expected` is not '(info)' must have ok = true before applying anything. The '(info)' rows are counts of what the
-- migrations will act on (rows the telemetry backfill will clear, venues that become private, and so on). They are for
-- the release record and to decide whether to warn anyone. They do not gate.
--   psql -X -v ON_ERROR_STOP=1 -f docs/release/safety-batch-precheck.sql
-- The statement between BEGIN and ROLLBACK is a single SELECT that does not depend on search_path, so it can also be run
-- on its own through Lovable's database tool or the Management API.
--
-- What it confirms:
--   * the server is Postgres 17, and P0-1's two fixes are present (so this batch builds on the reconciled state);
--   * each object the batch REPLACES is exactly what a replay of main has (md5 of pg_get_functiondef and of the policy
--     text, and the grants), so the rollbacks in docs/rollbacks restore what production has now;
--   * each object the batch ADDS is not there yet;
--   * what the new code relies on exists (helpers, tables, columns, the private_sec schema);
--   * none of the four versions is in the ledger.
-- Expected values are from a replay of main at a23932ac on postgres:16 (2026-11-06), the method the P0-1 pre-check used.
BEGIN READ ONLY;
SET LOCAL search_path = '';
WITH replaced_fn(sig, md5, pr) AS (VALUES
    ('public.profile_ages(uuid[])', '42673800dedbb6af26008feeb64bf391', '#300'),
    ('public.set_my_birthday(date)', '26b6c380e5849ff13a7ba9da1806f9e3', '#314')),
exec_before(sig, grants, pr) AS (VALUES
    ('public.minor_messaging_block(uuid,uuid)', 'no/yes/yes', '#300'),
    ('public.minor_messaging_block_reason(uuid,uuid)', 'no/yes/yes', '#300'),
    ('public.minor_messaging_allowed(uuid,uuid)', 'no/yes/yes', '#300'),
    ('public.profile_ages(uuid[])', 'no/yes/yes', '#300'),
    ('public.set_my_birthday(date)', 'no/yes/yes', '#314')),
not_yet_fn(sig, pr) AS (VALUES
    ('public.minor_messaging_block_me(uuid)', '#300'),
    ('public.guard_user_roles_write()', '#300'),
    ('private_sec.team_is_youth(text)', '#330'),
    ('private_sec.can_see_post_venue(uuid)', '#330'),
    ('private_sec.post_venue(uuid)', '#330'),
    ('public.team_post_venues(uuid[])', '#330'),
    ('private_sec.telemetry_subject_is_adult(uuid)', '#332'),
    ('private_sec.anonymise_minor_location_denial()', '#332'),
    ('private_sec.anonymise_minor_signin_event()', '#332')),
not_yet_trg(tbl, name, pr) AS (VALUES
    ('public.user_roles', 'aa_guard_user_roles_write_trg', '#300'),
    ('public.location_denial_events', 'aa_anonymise_minor_location_denial', '#332'),
    ('public.auth_signin_events', 'aa_anonymise_minor_signin_event', '#332')),
needed_fn(sig) AS (VALUES
    ('public.age_cohort_of(uuid)'), ('public.is_guardian_of(uuid,uuid)'), ('public.is_team_manager(text,uuid)'),
    ('public.is_team_member(text,uuid)'), ('auth.uid()')),
needed_col(tbl, col) AS (VALUES
    ('public.team_posts', 'location'), ('public.team_posts', 'formatted_address'), ('public.team_posts', 'place_id'),
    ('public.team_posts', 'lat'), ('public.team_posts', 'lng'), ('public.teams', 'age_groups'),
    ('public.team_members', 'role'), ('public.profile_birthdays', 'birthday'),
    ('public.location_denial_events', 'user_id'), ('public.location_denial_events', 'user_agent'),
    ('public.location_denial_events', 'message'),
    ('public.auth_signin_events', 'user_id'), ('public.auth_signin_events', 'user_agent'),
    ('public.auth_signin_events', 'error_message')),
versions(v) AS (VALUES ('20261106150000'), ('20261106160000'), ('20261106200000'), ('20261106210000')),
pol_md5 AS (
  SELECT policyname AS name, md5(regexp_replace(cmd || ':' || array_to_string(roles, '|') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), '\mpublic\.', '', 'g')) AS md5
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_roles'),
checks(check_name, expected, actual) AS (
  SELECT 'server major', '17', (current_setting('server_version_num')::int / 10000)::text
  UNION ALL
  SELECT 'P0-1 applied first: public.guard_profile_insert() present', 'present',
         CASE WHEN to_regprocedure('public.guard_profile_insert()') IS NULL THEN 'missing' ELSE 'present' END
  UNION ALL
  SELECT 'P0-1 applied first: trigger payment_submissions.aa_payment_destination_trg present', 'present',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.payment_submissions') AND t.tgname = 'aa_payment_destination_trg') THEN 'present' ELSE 'absent' END
  UNION ALL
  SELECT e.pr || ' replaces, as on main: ' || e.sig, e.md5, coalesce(md5(pg_get_functiondef(to_regprocedure(e.sig))), 'missing') FROM replaced_fn e
  UNION ALL
  SELECT e.pr || ' EXECUTE before (anon/authenticated/service_role): ' || e.sig, e.grants,
         CASE WHEN to_regprocedure(e.sig) IS NULL THEN 'missing' ELSE
           (CASE WHEN has_function_privilege('anon', to_regprocedure(e.sig), 'EXECUTE') THEN 'yes' ELSE 'no' END) || '/' ||
           (CASE WHEN has_function_privilege('authenticated', to_regprocedure(e.sig), 'EXECUTE') THEN 'yes' ELSE 'no' END) || '/' ||
           (CASE WHEN has_function_privilege('service_role', to_regprocedure(e.sig), 'EXECUTE') THEN 'yes' ELSE 'no' END) END
    FROM exec_before e
  UNION ALL
  SELECT '#300 drops, as on main: policy user_roles / Admins manage roles', '08ac1c4b910ddb9332054f3508fef9d8',
         coalesce((SELECT md5 FROM pol_md5 WHERE name = 'Admins manage roles'), 'missing')
  UNION ALL
  SELECT '#300 keeps: policy user_roles / Users view own roles', 'd5ead4e9087c0b538ee6875646a5e4f4',
         coalesce((SELECT md5 FROM pol_md5 WHERE name = 'Users view own roles'), 'missing')
  UNION ALL
  SELECT '#300 revokes: user_roles write privileges held by authenticated', 'DELETE,INSERT,UPDATE',
         coalesce((SELECT string_agg(p, ',' ORDER BY p) FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) p
                    WHERE has_table_privilege('authenticated', 'public.user_roles', p)), 'none')
  UNION ALL
  SELECT '#330 narrows: team_posts table-level SELECT (anon/authenticated)', 'yes/yes',
         (CASE WHEN has_table_privilege('anon', 'public.team_posts', 'SELECT') THEN 'yes' ELSE 'no' END) || '/' ||
         (CASE WHEN has_table_privilege('authenticated', 'public.team_posts', 'SELECT') THEN 'yes' ELSE 'no' END)
  UNION ALL
  SELECT e.pr || ' not yet present: ' || e.sig, 'missing', CASE WHEN to_regprocedure(e.sig) IS NULL THEN 'missing' ELSE 'present' END FROM not_yet_fn e
  UNION ALL
  SELECT e.pr || ' not yet present: trigger ' || e.tbl || '.' || e.name, 'absent',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass(e.tbl) AND t.tgname = e.name) THEN 'present' ELSE 'absent' END
    FROM not_yet_trg e
  UNION ALL
  SELECT 'prerequisite: ' || e.sig, 'present', CASE WHEN to_regprocedure(e.sig) IS NULL THEN 'missing' ELSE 'present' END FROM needed_fn e
  UNION ALL
  SELECT 'prerequisite: column ' || e.tbl || '.' || e.col, 'present',
         CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass(e.tbl) AND a.attname = e.col AND NOT a.attisdropped) THEN 'present' ELSE 'missing' END
    FROM needed_col e
  UNION ALL
  SELECT 'prerequisite: schema private_sec usable by anon and authenticated', 'yes',
         CASE WHEN to_regnamespace('private_sec') IS NOT NULL AND has_schema_privilege('anon', 'private_sec', 'USAGE')
                   AND has_schema_privilege('authenticated', 'private_sec', 'USAGE') THEN 'yes' ELSE 'no' END
  UNION ALL
  SELECT 'not yet recorded: supabase ledger versions', 'none',
         CASE WHEN EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations s JOIN versions v ON v.v = s.version) THEN 'recorded' ELSE 'none' END
  UNION ALL
  -- (info) What the batch will act on. Counts only.
  SELECT '#300 (info) user_roles rows (the API can no longer write them; the server can)', '(info)',
         (SELECT count(*) FROM public.user_roles)::text
  UNION ALL
  SELECT '#314 (info) stored birthdays under 13 (future self-registration below 13 is refused; existing rows untouched)', '(info)',
         (SELECT count(*) FROM public.profile_birthdays b WHERE b.birthday > (current_date - interval '13 years'))::text
  UNION ALL
  SELECT '#330 (info) tryout/clinic posts with a stored venue (private unless the team is known adult-only)', '(info)',
         (SELECT count(*) FROM public.team_posts p WHERE p.kind IN ('tryout', 'clinic')
            AND (p.location IS NOT NULL OR p.formatted_address IS NOT NULL OR p.place_id IS NOT NULL OR p.lat IS NOT NULL))::text
  UNION ALL
  SELECT '#332 (info) location_denial_events rows the backfill clears (non-adult named / signed-out with user agent)', '(info)',
         (SELECT count(*) FROM public.location_denial_events e WHERE e.user_id IS NOT NULL AND public.age_cohort_of(e.user_id) <> 'adult')::text
         || ' / ' ||
         (SELECT count(*) FROM public.location_denial_events e WHERE e.user_id IS NULL AND e.user_agent IS NOT NULL)::text
  UNION ALL
  SELECT '#332 (info) auth_signin_events rows the backfill clears (non-adult named / signed-out with user agent)', '(info)',
         (SELECT count(*) FROM public.auth_signin_events e WHERE e.user_id IS NOT NULL AND public.age_cohort_of(e.user_id) <> 'adult')::text
         || ' / ' ||
         (SELECT count(*) FROM public.auth_signin_events e WHERE e.user_id IS NULL AND e.user_agent IS NOT NULL)::text)
SELECT check_name, expected, actual, (expected = '(info)' OR actual = expected) AS ok FROM checks;
ROLLBACK;
