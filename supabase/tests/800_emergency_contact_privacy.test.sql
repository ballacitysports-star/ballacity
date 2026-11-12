-- A guardian's emergency contact (drizzle/migrations/0007_guardian_emergency_contact.sql) is theirs alone:
--   * the three profiles columns are never readable by signed-out visitors or signed-in users, not even by
--     the guardian themselves through the table (no SELECT, no filter or RETURNING oracle);
--   * get_my_emergency_contact() returns the caller's own row only and takes no argument, so it cannot be
--     pointed at someone else; signed-out visitors cannot call it;
--   * a signed-in user may UPDATE the columns (GuardianProfileCard saves through profiles.update), but row
--     level security limits that to their own row: nobody overwrites another person's contact;
--   * nothing else exposes the columns: no other function names them; no function signed-out visitors or
--     signed-in users can call takes or returns a profiles row, or hands one out whole (to_jsonb(p), p.*,
--     p::text, SELECT * FROM profiles and the like); no trigger on profiles copies NEW or OLD whole; no view
--     reads profiles at all; no publication carries the columns. The sweep reads function source, so it is a
--     tripwire for the usual forms, not a proof.
-- Out of scope: the service role reads every column, so server code can still hand the contact out (today
-- superadminUserDetail selects * from profiles for superadmins; the admin screen does not show it).
-- Salvaged from the stale PR #26; the feature itself is on main.
BEGIN;

SELECT t.person('parent', 41), t.person('teen', 14), t.person('coach', 35), t.person('teammate', 24),
       t.person('stranger', 30);
SELECT t.guardian('parent', 'teen');
SELECT t.team('squad', 'coach');
SELECT t.member('squad', 'teen', 'player');
SELECT t.member('squad', 'teammate', 'player');
-- The guardian's profile is public and the child's is open to members, so the other signed-in users can see
-- both rows: a refused overwrite below is the update rule at work, not the row being hidden from them (a
-- 14-year-old's profile is private by default, which would hide it from their own guardian).
INSERT INTO public.privacy_preferences (user_id, profile_visibility) VALUES (t.id('parent'), 'public')
ON CONFLICT (user_id) DO UPDATE SET profile_visibility = 'public';
INSERT INTO public.privacy_preferences (user_id, profile_visibility) VALUES (t.id('teen'), 'members')
ON CONFLICT (user_id) DO UPDATE SET profile_visibility = 'members';

-- ---- column privileges -------------------------------------------------------------------------------------
CREATE TEMP TABLE ec_col (col text);
INSERT INTO ec_col VALUES ('emergency_contact_name'), ('emergency_contact_phone'), ('emergency_contact_relationship');

SELECT t.ok((SELECT NOT bool_or(has_column_privilege('anon', 'public.profiles', col, 'SELECT')) FROM ec_col),
  'signed-out visitors cannot read any emergency contact column');
SELECT t.ok((SELECT NOT bool_or(has_column_privilege('anon', 'public.profiles', col, 'INSERT')) FROM ec_col),
  'signed-out visitors cannot insert one');
SELECT t.ok((SELECT NOT bool_or(has_column_privilege('anon', 'public.profiles', col, 'UPDATE')) FROM ec_col),
  'signed-out visitors cannot update one');
SELECT t.ok((SELECT NOT bool_or(has_column_privilege('authenticated', 'public.profiles', col, 'SELECT')) FROM ec_col),
  'signed-in users cannot read any emergency contact column, not even their own');
-- Main's grant: authenticated has table-level INSERT and UPDATE on profiles, which covers these columns.
-- GuardianProfileCard saves with profiles.update(...).eq('id', me), so UPDATE is needed; row level security
-- ("Users can update own profile", auth.uid() = id) is what keeps it to the caller's own row, checked below.
SELECT t.ok((SELECT bool_and(has_column_privilege('authenticated', 'public.profiles', col, 'UPDATE')) FROM ec_col),
  'main grants signed-in users UPDATE on the columns (the card saves through profiles.update)');
SELECT t.ok((SELECT bool_and(has_column_privilege('authenticated', 'public.profiles', col, 'INSERT')) FROM ec_col),
  'main grants signed-in users INSERT on the columns (table-level grant; own row only by RLS)');

-- ---- the guardian saves and reads their own ----------------------------------------------------------------
SELECT t.as_user(t.id('parent'));
SELECT t.eq(t.changed(format($$UPDATE public.profiles SET emergency_contact_name = 'Sam Doe',
    emergency_contact_phone = '555-0100', emergency_contact_relationship = 'spouse' WHERE id = %L$$, t.id('parent'))), 1,
  'a guardian saves their own emergency contact');
SELECT t.eq((SELECT contact_name || '|' || contact_phone || '|' || relationship FROM public.get_my_emergency_contact()),
  'Sam Doe|555-0100|spouse', 'get_my_emergency_contact returns it to them');
SELECT t.eq((SELECT count(*)::int FROM public.get_my_emergency_contact()), 1, 'one row: their own');
SELECT t.throws(format('SELECT emergency_contact_phone FROM public.profiles WHERE id = %L', t.id('parent')),
  'permission denied', 'even the guardian cannot read the column through the table');
SELECT t.reset();

-- ---- nobody else gets it -----------------------------------------------------------------------------------
SELECT t.as_user(t.id('teen'));
SELECT t.eq((SELECT count(*)::int FROM public.get_my_emergency_contact()), 1, 'the child gets one row');
SELECT t.ok((SELECT bool_and(contact_name IS NULL AND contact_phone IS NULL AND relationship IS NULL)
  FROM public.get_my_emergency_contact()), 'the child gets their own empty values, not their guardian''s');
SELECT t.reset();

SELECT t.as_user(t.id('coach'));
SELECT t.eq((SELECT count(*)::int FROM public.get_my_emergency_contact()), 1, 'the child''s coach gets one row');
SELECT t.ok((SELECT bool_and(contact_name IS NULL AND contact_phone IS NULL AND relationship IS NULL)
  FROM public.get_my_emergency_contact()), 'the coach gets their own empty values, never the guardian''s');
SELECT t.throws(format('SELECT emergency_contact_phone FROM public.profiles WHERE id = %L', t.id('parent')),
  'permission denied', 'the coach cannot read the column through the table');
SELECT t.reset();

SELECT t.as_user(t.id('teammate'));
SELECT t.eq((SELECT count(*)::int FROM public.get_my_emergency_contact()), 1, 'a teammate gets one row');
SELECT t.ok((SELECT bool_and(contact_name IS NULL AND contact_phone IS NULL AND relationship IS NULL)
  FROM public.get_my_emergency_contact()), 'a teammate gets their own empty values, never the guardian''s');
SELECT t.reset();

SELECT t.as_user(t.id('stranger'));
SELECT t.eq((SELECT count(*)::int FROM public.get_my_emergency_contact()), 1, 'a stranger gets one row');
SELECT t.ok((SELECT bool_and(contact_name IS NULL AND contact_phone IS NULL AND relationship IS NULL)
  FROM public.get_my_emergency_contact()), 'a stranger gets their own empty values, never the guardian''s');
-- No oracle: filtering on the column, returning it, or copying it into a column one can read all need SELECT.
SELECT t.throws($$SELECT id FROM public.profiles WHERE emergency_contact_phone LIKE '555%'$$,
  'permission denied', 'a stranger cannot filter profiles by an emergency contact');
SELECT t.throws(format('UPDATE public.profiles SET bio = bio WHERE id = %L RETURNING emergency_contact_phone', t.id('stranger')),
  'permission denied', 'nor read one back through UPDATE ... RETURNING');
SELECT t.throws(format('UPDATE public.profiles SET bio = emergency_contact_phone WHERE id = %L', t.id('stranger')),
  'permission denied', 'nor copy one into a readable column');
SELECT t.reset();

-- The function has no argument, so there is no way to ask for another user's row.
SELECT t.eq((SELECT count(*)::int FROM pg_proc WHERE proname = 'get_my_emergency_contact'), 1,
  'get_my_emergency_contact has a single definition');
SELECT t.eq((SELECT pronargs::int FROM pg_proc WHERE oid = 'public.get_my_emergency_contact()'::regprocedure), 0,
  'and it takes no argument');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT * FROM public.get_my_emergency_contact(%L::uuid)', t.id('parent')),
  'does not exist', 'a signed-in user cannot call it for someone else');
SELECT t.reset();

SELECT t.ok(NOT has_function_privilege('anon', 'public.get_my_emergency_contact()', 'EXECUTE'),
  'signed-out visitors have no EXECUTE on get_my_emergency_contact');
SELECT t.as_anon();
SELECT t.throws('SELECT * FROM public.get_my_emergency_contact()', 'permission denied',
  'signed-out visitors cannot call it');
SELECT t.eq(t.count('SELECT emergency_contact_phone FROM public.profiles'), 0,
  'signed-out visitors cannot read the column through the table');
SELECT t.reset();

-- ---- nobody overwrites another person's contact ------------------------------------------------------------
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.profiles WHERE id = %L', t.id('parent'))), 1,
  'a stranger can see the guardian''s (public) profile row');
SELECT t.eq(t.changed(format($$UPDATE public.profiles SET emergency_contact_phone = '000' WHERE id = %L$$, t.id('parent'))), 0,
  'a stranger cannot overwrite a guardian''s emergency contact');
SELECT t.reset();
SELECT t.as_user(t.id('coach'));
SELECT t.eq(t.changed(format($$UPDATE public.profiles SET emergency_contact_phone = '000' WHERE id = %L$$, t.id('parent'))), 0,
  'nor can the child''s coach');
SELECT t.reset();
SELECT t.as_user(t.id('teen'));
SELECT t.eq(t.changed(format($$UPDATE public.profiles SET emergency_contact_phone = '000' WHERE id = %L$$, t.id('parent'))), 0,
  'nor the child');
SELECT t.reset();
SELECT t.as_user(t.id('parent'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.profiles WHERE id = %L', t.id('teen'))), 1,
  'the guardian can see the child''s profile row');
SELECT t.eq(t.changed(format($$UPDATE public.profiles SET emergency_contact_phone = '000' WHERE id = %L$$, t.id('teen'))), 0,
  'and the guardian cannot write one onto the child''s profile');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.eq(t.changed(format($$UPDATE public.profiles SET emergency_contact_phone = '000' WHERE id = %L$$, t.id('parent'))), 0,
  'nor a signed-out visitor');
SELECT t.reset();
SELECT t.eq((SELECT emergency_contact_phone FROM public.profiles WHERE id = t.id('parent')), '555-0100',
  'the guardian''s emergency contact is unchanged');
SELECT t.ok((SELECT emergency_contact_phone IS NULL FROM public.profiles WHERE id = t.id('teen')),
  'and nothing was written onto the child''s profile');

-- ---- nothing else exposes the columns ----------------------------------------------------------------------
-- Any other function that names the columns needs a reason here (and its own test) before it is added.
SELECT t.eq((SELECT array_agg(n.nspname || '.' || p.proname ORDER BY n.nspname, p.proname)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosrc ILIKE '%emergency_contact%'
    AND n.nspname NOT IN ('pg_catalog', 'information_schema', 't')),
  ARRAY['public.get_my_emergency_contact'],
  'get_my_emergency_contact is the only function that mentions the emergency contact columns');
-- A function returning whole profiles rows would carry the columns without naming them.
SELECT t.eq((SELECT count(*)::int FROM pg_proc p
  WHERE (p.prorettype = 'public.profiles'::regtype
         OR 'public.profiles'::regtype = ANY (COALESCE(p.proallargtypes, p.proargtypes::oid[])))
    AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0, 'no function signed-in users or visitors can call returns or takes a whole profiles row');
-- Nor hands one out whole from inside: to_jsonb(p), row_to_json(p), jsonb_agg(p), p.*, p::text, SELECT * FROM
-- profiles, profiles%ROWTYPE or RETURNING * would carry the columns without naming them. Each alias the source
-- gives profiles is checked (a keyword caught as an alias is harmless). A new function listed here needs to
-- leave the emergency contact out, and a reason here, before it is allowed.
SELECT t.eq((
  WITH fn AS (
    SELECT p.oid, n.nspname || '.' || p.proname AS name, p.prosrc
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 't')
      AND p.prosrc ~* '\mprofiles\M'
      AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ), alias AS (
    SELECT fn.oid, lower(COALESCE(m[2], 'profiles')) AS a
    FROM fn, regexp_matches(fn.prosrc, '\mprofiles\M(\s+(?:as\s+)?(\w+))?', 'gi') m
  )
  SELECT COALESCE(array_agg(DISTINCT fn.name), '{}') FROM fn
  WHERE fn.prosrc ~* '\mselect\s+\*\s+(into\s+\w+\s+)?from\s+(public\.)?profiles\M'
     OR fn.prosrc ~* '\mprofiles\s*%\s*rowtype'
     OR fn.prosrc ~* '\mprofiles\M[^;]*\mreturning\s+\*'
     OR EXISTS (SELECT 1 FROM alias WHERE alias.oid = fn.oid AND (
          fn.prosrc ~* ('\m(to_jsonb|to_json|row_to_json|jsonb_agg|json_agg|array_agg|hstore)\s*\(\s*' || alias.a || '\s*[,)]')
       OR fn.prosrc ~* ('\m' || alias.a || '\.\*')
       OR fn.prosrc ~* ('\m' || alias.a || '\s*::')
       OR fn.prosrc ~* ('\(\s*' || alias.a || '\s*\)\s*::')))),
  '{}'::text[], 'no function signed-in users or visitors can call hands out a whole profiles row');
SELECT t.eq((SELECT COALESCE(array_agg(tg.tgname::text ORDER BY tg.tgname), '{}')
  FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
  WHERE tg.tgrelid = 'public.profiles'::regclass AND NOT tg.tgisinternal
    AND p.prosrc ~* '\m(to_jsonb|to_json|row_to_json|hstore)\s*\(\s*(new|old)\s*\)|\m(new|old)\s*::|\m(new|old)\.\*|\(\s*(new|old)\s*\)\s*::'),
  '{}'::text[], 'no trigger on profiles copies a whole row (NEW or OLD) anywhere');
-- A view records a dependency only on the columns it names, and to_jsonb(p) names just id, so a per-column check
-- would miss a whole-row view. None may read profiles at all; a new one needs a reason here.
SELECT t.eq((SELECT COALESCE(array_agg(DISTINCT c.oid::regclass::text), '{}')
  FROM pg_depend d
  JOIN pg_rewrite r ON r.oid = d.objid AND d.classid = 'pg_rewrite'::regclass
  JOIN pg_class c ON c.oid = r.ev_class
  WHERE d.refobjid = 'public.profiles'::regclass AND c.oid <> 'public.profiles'::regclass),
  '{}'::text[], 'no view or materialized view reads profiles');
SELECT t.eq((SELECT count(*)::int FROM pg_publication_tables
  WHERE schemaname = 'public' AND tablename = 'profiles'
    AND (attnames IS NULL OR attnames && ARRAY['emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship']::name[])),
  0, 'no publication (realtime) carries the emergency contact columns');

ROLLBACK;
