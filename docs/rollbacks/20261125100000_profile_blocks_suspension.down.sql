-- ROLLBACK for supabase/migrations/20261125100000_profile_blocks_suspension.sql (open item: blocks and suspension hide a profile).
-- NOT a migration. It puts the two profiles read rules back exactly as 20260907234853 wrote them (visibility only: a blocked
-- person and everyone else read a suspended or blocking account's profile again), drops the six lock triggers on
-- hosted_games, join_requests, game_position_waitlist and payment_submissions (a host can repoint their own waitlist and
-- payment rows, and reopen ended games, requests, waitlist entries and payments, again), drops public.my_blocked_profiles,
-- public.managed_profile_names, private_sec.profile_hidden_from_viewer, private_sec.viewer_block_peers,
-- private_sec.hosted_game_on, private_sec.hosted_game_id_on, private_sec.lock_row_identity and
-- private_sec.lock_closed_relationship, puts public.profile_visibility_of (20260907234853: the truth to any client, visitors
-- included, so anon's EXECUTE is granted back) and public.profile_ages (20261106150000) back, and puts
-- guardian_approve_join_request (20261110120000) and release_expired_payment_holds (20261103140000) back with their "request
-- to join" bodies. Nothing stored is changed: blocks, suspensions, games, requests, waitlist entries, payments and
-- notifications already sent stay as they are.
-- The app keeps working after it: when my_blocked_profiles is missing, the block list (useBlockedUsersList) reads user_blocks
-- and profiles, which the old rules allow again, so names stay; when managed_profile_names is missing, the host's screens fill
-- no extra names: the old rules show blocked and suspended people's rows again, and a private player shows as "Player" on
-- the host's screens again, as before 20261125100000. The app reads profile_visibility_of
-- only with the service role, so its answer there does not change.
-- It stops, changing nothing, unless every object it touches still has the definition 20261125100000 gave it (function
-- bodies; the two profiles rules' USING text, roles, command and permissive flag; the grants on the four functions it keeps;
-- the six triggers) and nothing else calls a function it drops (a later change needs a person to look first), and refuses
-- to run unless the session sets the confirmation first:
--     SET app.confirm_profile_blocks_suspension_rollback = 'yes';
-- Locks. Unlike the migration (SHARE ROW EXCLUSIVE, which readers pass), DROP TRIGGER and ALTER POLICY need ACCESS
-- EXCLUSIVE, which stops reads too, on five busy tables (hosted_games, join_requests, game_position_waitlist,
-- payment_submissions and profiles). Holding one of them while queued for another would stall every read of the first and
-- can deadlock with a request that reads them in the other order. So all five are taken before any change, one table at a
-- time, within one budget for the whole try: 200 ms, or half the server's deadlock_timeout if that is less. Each table's
-- wait is limited to what is left of the budget (lock_timeout applies to each lock on its own, so a single 200 ms setting
-- for five tables would let one try hold the first table for about 800 ms). A try that cannot get all five within the
-- budget gives back what it got and waits a moment before the next one, up to 50 tries. A request queued behind a try
-- therefore waits at most the budget, under half the deadlock check, so the check never fires and nobody is killed as a
-- deadlock victim. Once all five are held the rest takes milliseconds. If no try succeeds it stops with nothing changed.
-- Even so, each try can hold up reads of the tables it already has for up to the budget (200 ms): run it in a quiet moment.
BEGIN;
DO $guard$
DECLARE
  _want CONSTANT text[][] := ARRAY[
    ['public.guardian_approve_join_request(uuid,boolean)', '5a795446acf7c09904daf13eed27e732'],
    ['public.release_expired_payment_holds(text)',          '856c6a3999e1dfaf216e12a2ad998004'],
    ['public.my_blocked_profiles()',                        'ed324c09eb24adf3eac32e253d1699a8'],
    ['private_sec.profile_hidden_from_viewer(uuid)',        '00ce33553258c7a686430b5aed774894'],
    ['private_sec.viewer_block_peers()',                    '05df757b41d46eb16cfdbc94f76a0cb1'],
    ['private_sec.hosted_game_on(timestamptz,timestamptz,text,timestamptz,timestamptz)', 'b3aff56330475087fe148b52843d78ad'],
    ['private_sec.hosted_game_id_on(text)',                 '71a00a703ffb9375cd917bf590d66904'],
    ['private_sec.lock_row_identity()',                     '9204d58bcb421322580ad4fb20c3029c'],
    ['private_sec.lock_closed_relationship()',              '1d5c12896a35da8eef9e483c41b79ddf'],
    ['public.managed_profile_names(uuid[])',                'a5a1dac773ae6ab02938379f07a27916'],
    ['public.profile_visibility_of(uuid)',                  '3640d6706d5dfa5df54de5d1b7e5e2bf'],
    ['public.profile_ages(uuid[])',                         '237a5e359e72caa61df02a24c0cd7b77']];
  -- the functions this rollback drops, and the triggers it drops with them
  _dropped CONSTANT text[] := ARRAY['public.my_blocked_profiles()', 'public.managed_profile_names(uuid[])',
    'private_sec.profile_hidden_from_viewer(uuid)', 'private_sec.viewer_block_peers()',
    'private_sec.hosted_game_on(timestamptz,timestamptz,text,timestamptz,timestamptz)', 'private_sec.hosted_game_id_on(text)',
    'private_sec.lock_row_identity()', 'private_sec.lock_closed_relationship()'];
  _triggers CONSTANT text[] := ARRAY['a0_game_position_waitlist_identity_locked', 'a0_payment_submissions_identity_locked',
    'a1_hosted_games_closed_locked', 'a1_join_requests_closed_locked', 'a1_game_position_waitlist_closed_locked',
    'a1_payment_submissions_closed_locked'];
  -- the grants on the functions this rollback keeps (CREATE OR REPLACE keeps them, so a later GRANT or REVOKE would survive)
  _acls CONSTANT text[][] := ARRAY[
    ['public.guardian_approve_join_request(uuid,boolean)', 'authenticated:EXECUTE,service_role:EXECUTE'],
    ['public.release_expired_payment_holds(text)',          'authenticated:EXECUTE,service_role:EXECUTE'],
    ['public.profile_visibility_of(uuid)',                  'authenticated:EXECUTE,service_role:EXECUTE'],
    ['public.profile_ages(uuid[])',                         'authenticated:EXECUTE,service_role:EXECUTE']];
  -- a SQL or plpgsql body names its callees only as text, which pg_depend does not record
  _callee_re CONSTANT text :=
    '\m(managed_profile_names|my_blocked_profiles|viewer_block_peers|profile_hidden_from_viewer|hosted_game_on|hosted_game_id_on|lock_row_identity|lock_closed_relationship)\M';
  _guarded oid[] := '{}';
  _got text;
  i int;
BEGIN
  IF current_setting('app.confirm_profile_blocks_suspension_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: blocked people and everyone else would read suspended and blocking accounts'' profiles again. Set app.confirm_profile_blocks_suspension_rollback=yes for the session to proceed deliberately.';
  END IF;
  FOR i IN 1 .. array_length(_want, 1) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure(_want[i][1]);
    IF _got IS DISTINCT FROM _want[i][2] THEN
      RAISE EXCEPTION 'Refusing to run: % is not the definition 20261125100000 created (md5 %). A later change needs a person to look first.', _want[i][1], _got;
    END IF;
    _guarded := _guarded || to_regprocedure(_want[i][1])::oid;
  END LOOP;
  FOR i IN 1 .. array_length(_acls, 1) LOOP
    -- only the API roles and PUBLIC: the owner's own entry is whatever the platform made it
    SELECT string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || a.privilege_type || CASE WHEN a.is_grantable THEN '*' ELSE '' END,
                      ',' ORDER BY coalesce(r.rolname, 'PUBLIC'), a.privilege_type)
      INTO _got
      FROM pg_proc p
     CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      LEFT JOIN pg_roles r ON r.oid = a.grantee
     WHERE p.oid = to_regprocedure(_acls[i][1])
       AND (a.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'service_role'));
    IF _got IS DISTINCT FROM _acls[i][2] THEN
      RAISE EXCEPTION 'Refusing to run: the grants on % are not the ones 20261125100000 left (%). A later change needs a person to look first.', _acls[i][1], _got;
    END IF;
  END LOOP;
  -- the two rules' roles, command and permissive flag (ALTER POLICY below resets only USING), then their USING text
  SELECT string_agg(policyname || '|' || roles::text || '|' || permissive || '|' || cmd || '|' || coalesce(with_check, ''),
                    ';' ORDER BY policyname) INTO _got
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'profiles'
     AND policyname IN ('Public profiles viewable by anon', 'Profiles viewable by members');
  IF _got IS DISTINCT FROM 'Profiles viewable by members|{authenticated}|PERMISSIVE|SELECT|;'
                           'Public profiles viewable by anon|{anon}|PERMISSIVE|SELECT|' THEN
    RAISE EXCEPTION 'Refusing to run: the profiles read rules'' roles or kind are not the ones 20261125100000 left (%).', _got;
  END IF;
  SELECT md5(qual) INTO _got FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Public profiles viewable by anon';
  IF _got IS DISTINCT FROM '694c30e96a25db715383c785b0ce060f' THEN
    RAISE EXCEPTION 'Refusing to run: the rule "Public profiles viewable by anon" is not the one 20261125100000 wrote (md5 %).', _got;
  END IF;
  SELECT md5(qual) INTO _got FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Profiles viewable by members';
  IF _got IS DISTINCT FROM '3f9d16da9fd72c3372cd1859a2ecd92b' THEN
    RAISE EXCEPTION 'Refusing to run: the rule "Profiles viewable by members" is not the one 20261125100000 wrote (md5 %).', _got;
  END IF;
  SELECT string_agg(tgname || '=' || md5(pg_get_triggerdef(oid)), ',' ORDER BY tgname) INTO _got
    FROM pg_trigger
   WHERE tgfoid IN ('private_sec.lock_row_identity()'::regprocedure, 'private_sec.lock_closed_relationship()'::regprocedure)
     AND NOT tgisinternal;
  IF _got IS DISTINCT FROM 'a0_game_position_waitlist_identity_locked=5d1d337c620f2b20afbaf0a469f997de,'
                           'a0_payment_submissions_identity_locked=7d37ed8ccd914193ba79799465118b28,'
                           'a1_game_position_waitlist_closed_locked=7490db8941b66ccb87ea21f607690e54,'
                           'a1_hosted_games_closed_locked=3b54bc0af08c4950e7de516b63f4ea4e,'
                           'a1_join_requests_closed_locked=7240b514eba641d3d11cbeeae72e7183,'
                           'a1_payment_submissions_closed_locked=aa15f6c8d8058cafdf99d03821e29aef' THEN
    RAISE EXCEPTION 'Refusing to run: the lock triggers are not the ones 20261125100000 created (%).', _got;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_depend d
              WHERE d.refobjid IN (SELECT to_regprocedure(x) FROM unnest(_dropped) x)
                AND NOT (d.classid = 'pg_policy'::regclass
                         AND d.objid IN (SELECT oid FROM pg_policy WHERE polrelid = 'public.profiles'::regclass
                                           AND polname IN ('Public profiles viewable by anon', 'Profiles viewable by members')))
                AND NOT (d.classid = 'pg_trigger'::regclass
                         AND d.objid IN (SELECT oid FROM pg_trigger WHERE tgname = ANY (_triggers)))
                AND d.deptype <> 'i') THEN
    RAISE EXCEPTION 'Refusing to run: something else now depends on a function 20261125100000 created. A person needs to look first.';
  END IF;
  -- the same for callers pg_depend cannot see: any other function, rule or view whose text names one of them
  SELECT string_agg(x, ', ' ORDER BY x) INTO _got FROM (
    SELECT p.oid::regprocedure::text AS x
      FROM pg_proc p
     WHERE p.prosrc ~ _callee_re
       AND p.oid <> ALL (_guarded)
    UNION ALL
    SELECT format('policy %s on %s.%s', pl.policyname, pl.schemaname, pl.tablename)
      FROM pg_policies pl
     WHERE (coalesce(pl.qual, '') || ' ' || coalesce(pl.with_check, '')) ~ _callee_re
       AND NOT (pl.schemaname = 'public' AND pl.tablename = 'profiles'
                AND pl.policyname IN ('Public profiles viewable by anon', 'Profiles viewable by members'))
    UNION ALL
    SELECT format('view %s.%s', v.schemaname, v.viewname)
      FROM pg_views v
     WHERE v.schemaname NOT IN ('pg_catalog', 'information_schema') AND v.definition ~ _callee_re
    UNION ALL
    SELECT format('trigger %s', t.tgname)
      FROM pg_trigger t
     WHERE NOT t.tgisinternal AND NOT (t.tgname = ANY (_triggers)) AND pg_get_triggerdef(t.oid) ~ _callee_re) c;
  IF _got IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: % still calls a function this rollback drops. A person needs to look first.', _got;
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';

-- all five tables, before any change, within one budget per try; a try that runs out gives back what it got (see Locks above)
DO $locks$
DECLARE
  _budget_ms CONSTANT numeric := least(200, (SELECT setting::numeric FROM pg_settings WHERE name = 'deadlock_timeout') / 2);
  _tables CONSTANT text[] := ARRAY['public.hosted_games', 'public.join_requests', 'public.game_position_waitlist',
                                   'public.payment_submissions', 'public.profiles'];
  _start timestamptz;
  _left numeric;
  _t text;
  _tries int := 0;
BEGIN
  LOOP
    BEGIN
      _start := clock_timestamp();
      FOREACH _t IN ARRAY _tables LOOP
        -- each lock waits only for what is left of this try's budget
        _left := _budget_ms - extract(epoch FROM clock_timestamp() - _start) * 1000;
        IF _left < 1 THEN
          RAISE EXCEPTION 'this try ran out of time' USING ERRCODE = 'lock_not_available';
        END IF;
        PERFORM set_config('lock_timeout', floor(_left)::int || 'ms', true);
        EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE', _t);
      END LOOP;
      PERFORM set_config('lock_timeout', '5s', true);
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      _tries := _tries + 1;
      IF _tries >= 50 THEN
        RAISE EXCEPTION 'Refusing to run: the five tables stayed busy for 50 tries; nothing was changed. Try again in a quieter moment.';
      END IF;
      PERFORM pg_sleep(0.1 + random() * 0.2);
    END;
  END LOOP;
END
$locks$;

DROP TRIGGER a0_game_position_waitlist_identity_locked ON public.game_position_waitlist;
DROP TRIGGER a0_payment_submissions_identity_locked ON public.payment_submissions;
DROP TRIGGER a1_hosted_games_closed_locked ON public.hosted_games;
DROP TRIGGER a1_join_requests_closed_locked ON public.join_requests;
DROP TRIGGER a1_game_position_waitlist_closed_locked ON public.game_position_waitlist;
DROP TRIGGER a1_payment_submissions_closed_locked ON public.payment_submissions;

-- profile_visibility_of as 20260907234853 wrote it (the other grants are kept by CREATE OR REPLACE), and visitors' EXECUTE back
CREATE OR REPLACE FUNCTION public.profile_visibility_of(_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT private_sec.profile_visibility_of(_user);
$$;
-- (revoked and granted again in main's order, so the catalog reads exactly as before the migration)
REVOKE EXECUTE ON FUNCTION public.profile_visibility_of(uuid) FROM authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_visibility_of(uuid) TO anon, authenticated, service_role;

-- profile_ages as 20261106150000 wrote it (grants are kept by CREATE OR REPLACE)
CREATE OR REPLACE FUNCTION public.profile_ages(_ids uuid[])
RETURNS TABLE(id uuid, age integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.user_id,
         date_part('year', age(b.birthday))::int
  FROM public.profile_birthdays b
  WHERE b.user_id = ANY(_ids)
    AND b.birthday IS NOT NULL
    AND public.profile_visibility_of(b.user_id) IN ('public','members')
    AND (
      -- an adult's age follows their visibility setting, as before
      public.age_cohort_of(b.user_id) = 'adult'
      -- the server (service role, workers, migrations) has no auth.uid()
      OR auth.uid() IS NULL
      -- a minor's age: the minor, a verified guardian, or a moderator
      OR b.user_id = auth.uid()
      OR public.is_guardian_of(auth.uid(), b.user_id)
      OR public.is_moderator(auth.uid())
    );
$$;

DROP FUNCTION public.my_blocked_profiles();
DROP FUNCTION public.managed_profile_names(uuid[]);
DROP FUNCTION private_sec.profile_hidden_from_viewer(uuid);
DROP FUNCTION private_sec.lock_row_identity();
DROP FUNCTION private_sec.lock_closed_relationship();
DROP FUNCTION private_sec.hosted_game_id_on(text);
DROP FUNCTION private_sec.hosted_game_on(timestamptz, timestamptz, text, timestamptz, timestamptz);

-- guardian_approve_join_request as 20261110120000 wrote it
CREATE OR REPLACE FUNCTION public.guardian_approve_join_request(_request uuid, _approve boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _row public.join_requests;
  _keep boolean;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _row FROM public.join_requests WHERE id = _request FOR UPDATE;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF NOT public.is_guardian_of(_me, _row.player_id) THEN RAISE EXCEPTION 'NOT_GUARDIAN'; END IF;
  -- Approving needs an eligible guardian. Declining, the protective answer, needs only the link.
  IF _approve AND NOT private_sec.guardian_approver_eligible(_me) THEN RAISE EXCEPTION 'GUARDIAN_NOT_ELIGIBLE'; END IF;
  IF _row.status NOT IN ('pending', 'approved') THEN RAISE EXCEPTION 'REQUEST_NOT_PENDING'; END IF;
  IF EXISTS (SELECT 1 FROM public.game_participants gp
              WHERE gp.game_id = _row.game_id AND gp.user_id = _row.player_id) THEN
    RAISE EXCEPTION 'ALREADY_ON_ROSTER: this child is already in the game; cancel their spot from the game page.';
  END IF;

  IF _approve THEN
    -- Keep an existing approval only while the guardian who gave it still has
    -- authority; a stale one (link ended, guardian no longer eligible) is replaced.
    _keep := _row.guardian_approved_at IS NOT NULL
             AND private_sec.guardian_approval_valid(_row.player_id, _row.guardian_approved_by);
    UPDATE public.join_requests
       SET guardian_approved_at = CASE WHEN _keep THEN guardian_approved_at ELSE now() END,
           guardian_approved_by = CASE WHEN _keep THEN guardian_approved_by ELSE _me END
     WHERE id = _request AND status IN ('pending', 'approved');

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_row.player_id, 'join_request_guardian_approved', 'Your guardian approved this request',
            CASE WHEN _row.status = 'approved'
                 THEN 'Your guardian and the host both said yes. You can take your place now.'
                 ELSE 'Your guardian approved your request to join this game.' END,
            '/games/' || _row.game_id);
  ELSE
    -- join_requests has no 'withdrawn-by-guardian' concept distinct from the
    -- player's own withdrawal; reuse the existing 'rejected' status rather
    -- than widening join_requests_status_chk for a guardian-specific value.
    -- A guardian's no also takes back any approval on the request (another guardian's or their own earlier yes).
    UPDATE public.join_requests
       SET status = 'rejected', reviewed_at = now(), reviewer_notes = 'Declined by guardian',
           guardian_approved_at = NULL, guardian_approved_by = NULL
     WHERE id = _request AND status IN ('pending', 'approved');
  END IF;
END;
$function$;

-- release_expired_payment_holds as 20261103140000 wrote it
CREATE OR REPLACE FUNCTION public.release_expired_payment_holds(_game_id text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  _next uuid;
  _offered uuid[] := '{}';
  _released integer := 0;
BEGIN
  IF _game_id IS NULL AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'A game id is required.' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('ballacity.system_release', 'on', true);

  FOR r IN
    SELECT jr.id, jr.game_id, jr.player_id, jr.host_id, g.title
      FROM public.join_requests jr
      JOIN public.game_payment_settings s ON s.game_id = jr.game_id
                                         AND s.host_id = private_sec.game_payee(s.game_id)
      JOIN public.hosted_games g ON g.id = jr.game_id
     WHERE jr.status = 'approved'
       AND (_game_id IS NULL OR jr.game_id = _game_id)
       AND jr.reviewed_at IS NOT NULL
       AND s.entry_fee > 0
       AND s.payment_hold_minutes IS NOT NULL
       AND jr.reviewed_at + make_interval(mins => s.payment_hold_minutes) <= now()
       AND now() < g.date
       AND g.cancelled_at IS NULL
       AND g.completed_at IS NULL
       AND COALESCE(g.status, '') NOT IN ('cancelled', 'completed', 'in_progress')
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_submissions ps
          WHERE ps.game_id = jr.game_id
            AND ps.player_id = jr.player_id
            AND ps.status IN ('pending', 'verified')
       )
     FOR UPDATE OF jr SKIP LOCKED
  LOOP
    UPDATE public.join_requests
       SET status = 'rejected',
           reviewer_notes = 'Payment window expired — your spot was released.',
           reviewed_at = now()
     WHERE id = r.id
       AND status = 'approved';
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    DELETE FROM public.game_participants
     WHERE game_id = r.game_id
       AND user_id = r.player_id;

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      r.player_id,
      'payment_hold_expired',
      left('Spot released · ' || r.title, 200),
      'Your payment window ran out, so your spot was released. You can request to join again if spots are open.',
      '/games/' || r.game_id
    );

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      r.host_id,
      'payment_hold_expired',
      left('Unpaid spot released · ' || r.title, 200),
      'A player didn''t pay within the hold window, so their spot is open again.',
      '/games/' || r.game_id
    );

    _next := NULL;
    SELECT w.user_id INTO _next
      FROM public.game_position_waitlist w
     WHERE w.game_id = r.game_id
       AND w.status = 'waiting'
       AND w.user_id <> r.player_id
       AND NOT (w.user_id = ANY (_offered))
     ORDER BY w.created_at ASC
     LIMIT 1;
    IF _next IS NOT NULL THEN
      _offered := _offered || _next;
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (
        _next,
        'waitlist_spot_open',
        left('A spot opened up · ' || r.title, 200),
        'You''re next on the waitlist. Grab it before someone else does.',
        '/games/' || r.game_id
      );
    END IF;

    _released := _released + 1;
  END LOOP;

  RETURN _released;
END;
$function$;

-- the read rules as 20260907234853 wrote them (public.profiles is already locked), then the helper only they used
ALTER POLICY "Public profiles viewable by anon" ON public.profiles
  USING (private_sec.profile_visibility_of(id) = 'public');
ALTER POLICY "Profiles viewable by members" ON public.profiles
  USING (id = auth.uid() OR private_sec.profile_visibility_of(id) IN ('public','members'));
DROP FUNCTION private_sec.viewer_block_peers();

COMMIT;
