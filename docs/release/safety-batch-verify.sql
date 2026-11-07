-- Read-only verify AFTER the four safety migrations are applied (companion to safety-batch-precheck.sql):
--   20261106150000 (#300), 20261106160000 (#314), 20261106210000 (#330), 20261106200000 (#332).
-- Catalog and ledger only, no application data. Every row must have ok = true.
--   psql -X -v ON_ERROR_STOP=1 -f docs/release/safety-batch-verify.sql
-- Expected values are from a replay of main at a23932ac with the four files applied in that order, on postgres:16
-- (2026-11-06). Function md5s are md5(pg_get_functiondef(...)). Trigger md5s are of pg_get_triggerdef with the schema prefix
-- removed. Run it with no search_path set (Lovable's tool and the Management API run the bare SELECT).
-- The ledger check passes only once the four versions have been recorded (Lovable's migration tool does this when it
-- applies a file; a hand-applied file needs its ledger row, as in P0-1 step D).
BEGIN READ ONLY;
SET LOCAL search_path = '';
WITH fn(sig, md5, grants, pr) AS (VALUES
    ('public.profile_ages(uuid[])', '805e65380d661e5ae0b2a84bacae1527', 'no/yes/yes', '#300'),
    ('public.minor_messaging_block(uuid,uuid)', '52f406f804b691e474bccfd8d9805302', 'no/no/yes', '#300'),
    ('public.minor_messaging_block_reason(uuid,uuid)', 'ac590c4a7de3a89bda91a793e4da394f', 'no/no/yes', '#300'),
    ('public.minor_messaging_allowed(uuid,uuid)', '5473c92b6158aa914241646b5697a445', 'no/no/yes', '#300'),
    ('public.minor_messaging_block_me(uuid)', 'fa778b4b33c2d0b5320ec8a4fc0b9d76', 'no/yes/yes', '#300'),
    ('public.guard_user_roles_write()', '7e51c2544d54a503793786eab2bdd974', 'no/no/yes', '#300'),
    ('public.set_my_birthday(date)', 'd1dd94acfe3e8d9bca143ae6817a09a6', 'no/yes/yes', '#314'),
    ('private_sec.team_is_youth(text)', '4d361a8a18ac98afa7cdfad2f81371be', 'no/no/no', '#330'),
    ('private_sec.can_see_post_venue(uuid)', 'afc6eb6a209f082fb7797854479b1925', 'no/no/no', '#330'),
    ('private_sec.post_venue(uuid)', 'a9d9e3d2b5f1fa4f2d996c311110b1a0', 'yes/yes/no', '#330'),
    ('public.team_post_venues(uuid[])', 'a7e10d83322ecf56e0b3b422a0aa6512', 'yes/yes/yes', '#330'),
    ('private_sec.telemetry_subject_is_adult(uuid)', '43f8a7357493fde988e2726814076d52', 'no/no/no', '#332'),
    ('private_sec.anonymise_minor_location_denial()', '349321af05eaaf29833e31d411eddc4c', 'no/no/no', '#332'),
    ('private_sec.anonymise_minor_signin_event()', 'a68ddb911bedaf165a74ecfab3670e59', 'no/no/no', '#332')),
trg(tbl, name, md5, pr) AS (VALUES
    ('public.user_roles', 'aa_guard_user_roles_write_trg', 'd036c6caf2026f3c0d53bd2114b0bb5e', '#300'),
    ('public.location_denial_events', 'aa_anonymise_minor_location_denial', '75951666eef1eb84fc488411354b12cc', '#332'),
    ('public.auth_signin_events', 'aa_anonymise_minor_signin_event', '324d232703524808148f9d11b281c2b8', '#332')),
versions(v) AS (VALUES ('20261106150000'), ('20261106160000'), ('20261106200000'), ('20261106210000')),
checks(check_name, expected, actual) AS (
  SELECT e.pr || ' function: ' || e.sig, e.md5, coalesce(md5(pg_get_functiondef(to_regprocedure(e.sig))), 'missing') FROM fn e
  UNION ALL
  SELECT e.pr || ' EXECUTE (anon/authenticated/service_role): ' || e.sig, e.grants,
         CASE WHEN to_regprocedure(e.sig) IS NULL THEN 'missing' ELSE
           (CASE WHEN has_function_privilege('anon', to_regprocedure(e.sig), 'EXECUTE') THEN 'yes' ELSE 'no' END) || '/' ||
           (CASE WHEN has_function_privilege('authenticated', to_regprocedure(e.sig), 'EXECUTE') THEN 'yes' ELSE 'no' END) || '/' ||
           (CASE WHEN has_function_privilege('service_role', to_regprocedure(e.sig), 'EXECUTE') THEN 'yes' ELSE 'no' END) END
    FROM fn e
  UNION ALL
  SELECT e.pr || ' trigger: ' || e.tbl || '.' || e.name, e.md5,
         coalesce((SELECT md5(regexp_replace(pg_get_triggerdef(t.oid), '\mpublic\.', '', 'g')) FROM pg_trigger t
                    WHERE t.tgrelid = to_regclass(e.tbl) AND t.tgname = e.name), 'missing')
    FROM trg e
  UNION ALL
  SELECT '#300 policy user_roles / Admins manage roles is gone', 'absent',
         CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_roles' AND policyname = 'Admins manage roles') THEN 'present' ELSE 'absent' END
  UNION ALL
  SELECT '#300 user_roles write privileges held by authenticated', 'none',
         coalesce((SELECT string_agg(p, ',' ORDER BY p) FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) p
                    WHERE has_table_privilege('authenticated', 'public.user_roles', p)), 'none')
  UNION ALL
  SELECT '#330 team_posts venue columns readable by anon / authenticated (of 5)', '0/0',
         (SELECT count(*) FILTER (WHERE has_column_privilege('anon', 'public.team_posts', c, 'SELECT'))::text || '/' ||
                 count(*) FILTER (WHERE has_column_privilege('authenticated', 'public.team_posts', c, 'SELECT'))::text
            FROM unnest(ARRAY['location', 'formatted_address', 'place_id', 'lat', 'lng']) c)
  UNION ALL
  SELECT '#330 team_posts other columns still readable by anon (title, kind, event_date)', 'yes',
         CASE WHEN has_column_privilege('anon', 'public.team_posts', 'title', 'SELECT')
                   AND has_column_privilege('anon', 'public.team_posts', 'kind', 'SELECT')
                   AND has_column_privilege('anon', 'public.team_posts', 'event_date', 'SELECT') THEN 'yes' ELSE 'no' END
  UNION ALL
  SELECT '#332 named non-adult rows left with an account id (location_denial_events + auth_signin_events)', '0',
         ((SELECT count(*) FROM public.location_denial_events e WHERE e.user_id IS NOT NULL AND public.age_cohort_of(e.user_id) <> 'adult')
        + (SELECT count(*) FROM public.auth_signin_events e WHERE e.user_id IS NOT NULL AND public.age_cohort_of(e.user_id) <> 'adult'))::text
  UNION ALL
  SELECT '#332 signed-out rows left with a user agent (both tables)', '0',
         ((SELECT count(*) FROM public.location_denial_events e WHERE e.user_id IS NULL AND e.user_agent IS NOT NULL)
        + (SELECT count(*) FROM public.auth_signin_events e WHERE e.user_id IS NULL AND e.user_agent IS NOT NULL))::text
  UNION ALL
  SELECT 'recorded: supabase ledger versions (of 4)', '4',
         (SELECT count(*) FROM supabase_migrations.schema_migrations s JOIN versions v ON v.v = s.version)::text)
SELECT check_name, expected, actual, actual = expected AS ok FROM checks;
ROLLBACK;
