-- ROLLBACK for supabase/migrations/20261126100000_profiles_respect_blocks_and_suspension.sql
-- (docs/privacy/profile-blocks-and-suspension.md).
-- NOT a migration. It puts back the two profile read rules exactly as 20260907234853 left them and drops the two
-- functions the migration added, public.my_blocked_profiles() and private_sec.my_block_partners():
--   "Profiles viewable by members":     id = auth.uid() OR profile_visibility_of(id) IN ('public','members')
--   "Public profiles viewable by anon": profile_visibility_of(id) = 'public'
-- REOPENS THE GAP: a person blocked either way reads the other's profile again, and a suspended account's profile is
-- readable on /players/:id again (while the player card hides it, which tells people it is suspended).
-- Nothing is written to or deleted from any table.
-- Effect on the app that shipped with the migration: the blocked-accounts list calls my_blocked_profiles and falls back
-- to reading profiles directly when the function is missing (the old behaviour), so nothing fails. The player card's
-- block check is in the app and stays until the app is rolled back too.
-- It stops, changing nothing, if a rule or a function no longer has the definition 20261126100000 gave it (a later
-- change needs a person to look first), and refuses to run unless the session sets the confirmation first:
--     SET app.confirm_profiles_blocks_rollback = 'yes';
--     (or PGOPTIONS="-c app.confirm_profiles_blocks_rollback=yes")
BEGIN;
DO $guard$
DECLARE
  _want jsonb := '{
    "Profiles viewable by members": "4ed0e8044bc96291b5ddcb0ccfe23513",
    "Public profiles viewable by anon": "b5fe1cd727eb293916024c64d662ab31"
  }'::jsonb;
  _k text;
  _got text;
  _want_fn text;
BEGIN
  IF current_setting('app.confirm_profiles_blocks_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this lets blocked people read each other''s profiles again and shows suspended profiles again. Set app.confirm_profiles_blocks_rollback=yes for the session to proceed deliberately.';
  END IF;
  FOR _k IN SELECT jsonb_object_keys(_want) LOOP
    SELECT md5(pg_get_expr(polqual, polrelid)) INTO _got
      FROM pg_policy WHERE polrelid = 'public.profiles'::regclass AND polname = _k;
    IF _got IS DISTINCT FROM _want ->> _k THEN
      RAISE EXCEPTION 'Refusing to run: the rule "%" on profiles is not the one 20261126100000 created (md5 %, expected %). A later change needs a person to look first.', _k, _got, _want ->> _k;
    END IF;
  END LOOP;
  FOR _k, _want_fn IN VALUES ('public.my_blocked_profiles()', '67d2f9351df21f6d3f0faba34e9585fc'),
                             ('private_sec.my_block_partners()', 'ff577052c02dc611126abb48bd722954') LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure(_k);
    IF _got IS DISTINCT FROM _want_fn THEN
      RAISE EXCEPTION 'Refusing to run: % is not the definition 20261126100000 created (md5 %, expected %).', _k, _got, _want_fn;
    END IF;
  END LOOP;
END
$guard$;

SET LOCAL lock_timeout = '5s';

DROP POLICY "Profiles viewable by members" ON public.profiles;
CREATE POLICY "Profiles viewable by members"
ON public.profiles FOR SELECT TO authenticated
USING (id = auth.uid() OR private_sec.profile_visibility_of(id) IN ('public','members'));

DROP POLICY "Public profiles viewable by anon" ON public.profiles;
CREATE POLICY "Public profiles viewable by anon"
ON public.profiles FOR SELECT TO anon
USING (private_sec.profile_visibility_of(id) = 'public');

DROP FUNCTION public.my_blocked_profiles();
DROP FUNCTION private_sec.my_block_partners();

COMMIT;
