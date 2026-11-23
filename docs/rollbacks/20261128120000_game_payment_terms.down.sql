-- ROLLBACK for supabase/migrations/20261128120000_game_payment_terms.sql (docs/paid-path-gates.md section 6 (c); owner
-- instruction 2026-11-21).
-- NOT a migration. It drops public.get_game_payment_terms(text), and puts public.get_game_host_payment_methods back,
-- byte for byte, as 20261119200000 left it (md5(pg_get_functiondef) ea525f29aa2da2aca39d9a797ce8a11e). CREATE OR REPLACE
-- keeps its owner and grants. No row is written or removed.
-- What it reopens: a signed-in caller the claim rules refuse (outside the game's age range, a full roster, closed joining,
-- a cancelled or ended game, a guardian's "Can join games" switch, the host's block) and who is not the payee, not on the
-- roster and has no claim in, receives the host's payment handles from get_game_host_payment_methods again, on a game
-- they can see. The pay page never draws them for that caller.
-- Effect on the app that shipped with the migration: none that breaks. The page asks for the terms and, when the call
-- fails (the function is gone), shows what it showed before the change: the game's price and no deadline, no accepted
-- methods and no "host approves first" line for a viewer who cannot read the settings row; nothing is invented and no error
-- text is shown. The page keeps working with or without this rollback.
-- It stops, changing nothing, if either function no longer has the definition the migration gave it (a later migration
-- changed it): a person needs to look first.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_game_payment_terms_rollback = 'yes';
--     (or PGOPTIONS="-c app.confirm_game_payment_terms_rollback=yes")
BEGIN;
DO $guard$
DECLARE
  _want jsonb := '{"public.get_game_payment_terms(text)": "84f7d766aa961f2230750a4e05b150a8", "public.get_game_host_payment_methods(uuid, text)": "5472b48285447dd3db44cc0e77fb796a"}'::jsonb;
  _k text;
  _got text;
BEGIN
  IF current_setting('app.confirm_game_payment_terms_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this removes the payment terms a new player reads before approval (the app falls back to the price alone) and shows the host''s payment handles again to a signed-in caller the pay page refuses (age range, full game, closed, blocked, a guardian''s switch). Set app.confirm_game_payment_terms_rollback=yes for the session to proceed deliberately.';
  END IF;
  FOR _k IN SELECT jsonb_object_keys(_want) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure(_k);
    IF _got IS DISTINCT FROM _want ->> _k THEN
      RAISE EXCEPTION 'Refusing to run: % is not the definition 20261128120000 created (md5 %, expected %). A later change needs a person to look first.', _k, _got, _want ->> _k;
    END IF;
  END LOOP;
END
$guard$;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION public.get_game_payment_terms(text);

-- The definition in force before the migration, unchanged.
CREATE OR REPLACE FUNCTION public.get_game_host_payment_methods(_host_id uuid, _game_id text)
 RETURNS TABLE(id uuid, host_id uuid, payment_type text, label text, username text, payment_url text, contact_info text, instructions text, is_enabled boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _settings public.game_payment_settings%ROWTYPE;
  _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN
    RETURN;
  END IF;
  -- Only the game's payee has payment methods to show for it.
  IF _host_id IS DISTINCT FROM private_sec.game_payee(_game_id) THEN
    RETURN;
  END IF;
  -- Only to a caller who may coordinate payments (not under 16, an unknown age or a consent-locked account): the
  -- manual claim would be refused anyway, and the handles invite paying first. The payee sees their own.
  IF _me IS DISTINCT FROM _host_id AND NOT public.game_payments_allowed(_me) THEN
    RETURN;
  END IF;
  -- Only a confirmed adult's handles are shown: not a 16-17-year-old's, not an unknown age's (the payee sees their own).
  IF _me IS DISTINCT FROM _host_id AND public.age_cohort_of(_host_id) IS DISTINCT FROM 'adult' THEN
    RETURN;
  END IF;
  -- Only to someone involved in the game (the payee, an approved requester, a payer, a participant: the rule of the
  -- payment settings row), or who can see it (the hosted_games read policies for a signed-in account).
  IF NOT private_sec.can_read_game_payment_settings(_game_id, _host_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.hosted_games g
        WHERE g.id = _game_id
          AND ((g.is_private = false AND g.hidden_at IS NULL)
               OR g.host_id = _me
               OR ((g.is_private = true OR g.moderator_hidden_at IS NULL)
                   AND (public.is_game_participant(g.id, _me)
                        OR EXISTS (SELECT 1 FROM public.join_requests jr
                                    WHERE jr.game_id = g.id AND jr.player_id = _me))))) THEN
    RETURN;
  END IF;

  SELECT *
  INTO _settings
  FROM public.game_payment_settings gps
  WHERE gps.game_id = _game_id
    AND gps.host_id = _host_id
  ORDER BY gps.created_at DESC
  LIMIT 1;

  IF _settings.id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT hpm.id, hpm.host_id, hpm.payment_type, hpm.label, hpm.username, hpm.payment_url, hpm.contact_info, hpm.instructions, hpm.is_enabled
    FROM public.host_payment_methods hpm
    WHERE hpm.host_id = _host_id
      AND hpm.is_enabled = true
      AND (
        COALESCE(array_length(_settings.accepted_method_ids, 1), 0) = 0
        OR hpm.id = ANY(_settings.accepted_method_ids)
      );
END;
$function$;

COMMIT;
