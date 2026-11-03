-- ROLLBACK for supabase/migrations/20261104120000_minor_host_payments_and_identity.sql (PRIV-2B part 2).
-- NOT a migration. It re-opens: minors collecting payment (payee records, payment settings, payment submissions
-- naming a minor), paid minor-hosted games without an adult payment manager, and name lookups of non-adult accounts
-- by strangers. It refuses to run without typed confirmation:
--     PGOPTIONS="-c app.confirm_reopen_minor_payments=yes" psql ... -f <this file>
-- Payment-manager assignments recorded on approvals are kept (the column is not dropped).
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_reopen_minor_payments', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: set app.confirm_reopen_minor_payments=yes for the session.';
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS yz_minor_game_price_trg ON public.hosted_games;
DROP TRIGGER IF EXISTS y_minor_payment_settings_trg ON public.game_payment_settings;
DROP TRIGGER IF EXISTS y_adult_payee_trg ON public.host_payment_methods;
DROP TRIGGER IF EXISTS y_adult_payee_trg ON public.host_paypal_accounts;
DROP FUNCTION IF EXISTS public.enforce_minor_game_price();
DROP FUNCTION IF EXISTS public.enforce_minor_payment_settings();
DROP FUNCTION IF EXISTS public.enforce_adult_payee_records();

CREATE OR REPLACE FUNCTION public.enforce_game_payment_cohort()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.player_id IS NOT NULL AND NOT public.game_payments_allowed(NEW.player_id) THEN
    RAISE EXCEPTION 'PAYMENTS_NOT_AVAILABLE: payment coordination is not available for this account yet.';
  END IF;
  IF NEW.host_id IS NOT NULL AND NOT public.game_payments_allowed(NEW.host_id) THEN
    RAISE EXCEPTION 'PAYMENTS_NOT_AVAILABLE: payment coordination is not available for this host account yet.';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.get_game_host_payment_methods(_host_id uuid, _game_id text)
 RETURNS TABLE(id uuid, host_id uuid, payment_type text, label text, username text, payment_url text, contact_info text, instructions text, is_enabled boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _settings public.game_payment_settings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  SELECT * INTO _settings FROM public.game_payment_settings gps
   WHERE gps.game_id = _game_id AND gps.host_id = _host_id ORDER BY gps.created_at DESC LIMIT 1;
  IF _settings.id IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT hpm.id, hpm.host_id, hpm.payment_type, hpm.label, hpm.username, hpm.payment_url, hpm.contact_info, hpm.instructions, hpm.is_enabled
    FROM public.host_payment_methods hpm
    WHERE hpm.host_id = _host_id AND hpm.is_enabled = true
      AND (COALESCE(array_length(_settings.accepted_method_ids, 1), 0) = 0 OR hpm.id = ANY(_settings.accepted_method_ids));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_host_payment_methods(_host_id uuid)
 RETURNS TABLE(id uuid, host_id uuid, payment_type text, label text, username text, payment_url text, contact_info text, instructions text, is_enabled boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF auth.uid() = _host_id
     OR EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.host_id = _host_id AND jr.player_id = auth.uid() AND jr.status = 'approved')
     OR EXISTS (SELECT 1 FROM public.payment_submissions ps WHERE ps.host_id = _host_id AND ps.player_id = auth.uid())
     OR EXISTS (SELECT 1 FROM public.game_participants gp JOIN public.hosted_games hg ON hg.id = gp.game_id
                 WHERE hg.host_id = _host_id AND gp.user_id = auth.uid())
  THEN
    RETURN QUERY
      SELECT hpm.id, hpm.host_id, hpm.payment_type, hpm.label, hpm.username, hpm.payment_url, hpm.contact_info, hpm.instructions, hpm.is_enabled
      FROM public.host_payment_methods hpm WHERE hpm.host_id = _host_id AND hpm.is_enabled = true;
  END IF;
END;
$function$;

-- Previous visible_avatars (names for every account).
CREATE OR REPLACE FUNCTION private_sec.visible_avatars(_ids uuid[])
 RETURNS TABLE(id uuid, display_name text, avatar_initials text, avatar_url text, avatar_visibility text, avatar_hidden boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT
    p.id, p.display_name, p.avatar_initials,
    CASE
      WHEN coalesce(p.avatar_url, p.avatar_url_private) IS NULL THEN NULL
      WHEN p.id = auth.uid() THEN coalesce(p.avatar_url, p.avatar_url_private)
      WHEN p.avatar_visibility = 'public' THEN coalesce(p.avatar_url, p.avatar_url_private)
      WHEN p.avatar_visibility = 'members' AND auth.uid() IS NOT NULL THEN coalesce(p.avatar_url, p.avatar_url_private)
      WHEN p.avatar_visibility = 'game_members' AND auth.uid() IS NOT NULL AND public.shares_game_or_chat(auth.uid(), p.id)
        THEN coalesce(p.avatar_url, p.avatar_url_private)
      ELSE NULL
    END AS avatar_url,
    p.avatar_visibility,
    (
      coalesce(p.avatar_url, p.avatar_url_private) IS NOT NULL
      AND NOT (
        p.id = auth.uid() OR p.avatar_visibility = 'public'
        OR (p.avatar_visibility = 'members' AND auth.uid() IS NOT NULL)
        OR (p.avatar_visibility = 'game_members' AND auth.uid() IS NOT NULL AND public.shares_game_or_chat(auth.uid(), p.id))
      )
    ) AS avatar_hidden
  FROM public.profiles p
  WHERE p.id = ANY(_ids) AND p.suspended_at IS NULL;
$function$;

-- Approval functions without the payment-manager parameter (an approval that named a manager keeps it).
DROP FUNCTION IF EXISTS public.grant_minor_hosting_approval(uuid, integer, boolean);
DROP FUNCTION IF EXISTS public.grant_org_minor_hosting_approval(uuid, uuid, integer, boolean);
DROP POLICY IF EXISTS "Hosts manage own game payment settings (insert)" ON public.game_payment_settings;
CREATE POLICY "Hosts manage own game payment settings (insert)" ON public.game_payment_settings
  FOR INSERT TO authenticated WITH CHECK (host_id = auth.uid());
DROP POLICY IF EXISTS "Hosts manage own game payment settings (update)" ON public.game_payment_settings;
CREATE POLICY "Hosts manage own game payment settings (update)" ON public.game_payment_settings
  FOR UPDATE TO authenticated USING (host_id = auth.uid()) WITH CHECK (host_id = auth.uid());
DROP FUNCTION IF EXISTS private_sec.can_manage_game_payment_settings(text, uuid);
DROP FUNCTION IF EXISTS private_sec.minor_game_payment_manager(text);
DROP FUNCTION IF EXISTS private_sec.can_see_minor_name(uuid, uuid);

-- The two-argument approval functions of 20261104110000.
CREATE OR REPLACE FUNCTION public.grant_minor_hosting_approval(_minor uuid, _valid_hours integer DEFAULT 168)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF public.age_cohort_of(_uid) IS DISTINCT FROM 'adult' OR NOT public.is_guardian_of(_uid, _minor) THEN
    RAISE EXCEPTION 'NOT_GUARDIAN: only an adult, verified guardian of this player can approve hosting.' USING ERRCODE = '42501';
  END IF;
  IF public.age_cohort_of(_minor) IS DISTINCT FROM 'teen_16_17' THEN
    RAISE EXCEPTION 'NOT_ELIGIBLE: hosting can only be approved for a 16 or 17 year old.' USING ERRCODE = '42501';
  END IF;
  IF _valid_hours IS NULL OR _valid_hours < 1 OR _valid_hours > 720 THEN
    RAISE EXCEPTION 'INVALID_DURATION' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.minor_hosting_approvals (kind, minor_id, approver_id, expires_at)
  VALUES ('guardian', _minor, _uid, now() + make_interval(hours => _valid_hours))
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- An adult administrator of an organization approves a 16-17 year old member to run a game under it.
CREATE OR REPLACE FUNCTION public.grant_org_minor_hosting_approval(_minor uuid, _org uuid, _valid_hours integer DEFAULT 168)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF public.age_cohort_of(_uid) IS DISTINCT FROM 'adult' OR NOT public.is_trainer_org_admin(_org, _uid) THEN
    RAISE EXCEPTION 'NOT_ORG_ADMIN: only an adult administrator of this organization can approve hosting.' USING ERRCODE = '42501';
  END IF;
  IF public.age_cohort_of(_minor) IS DISTINCT FROM 'teen_16_17' THEN
    RAISE EXCEPTION 'NOT_ELIGIBLE: hosting can only be approved for a 16 or 17 year old.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_org_member(_org, _minor)
          OR EXISTS (SELECT 1 FROM public.trainer_org_members m WHERE m.org_id = _org AND m.user_id = _minor)) THEN
    RAISE EXCEPTION 'NOT_MEMBER: the player is not a member of this organization.' USING ERRCODE = '42501';
  END IF;
  IF _valid_hours IS NULL OR _valid_hours < 1 OR _valid_hours > 720 THEN
    RAISE EXCEPTION 'INVALID_DURATION' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.minor_hosting_approvals (kind, minor_id, approver_id, org_id, expires_at)
  VALUES ('organization', _minor, _uid, _org, now() + make_interval(hours => _valid_hours))
  RETURNING id INTO _id;
  RETURN _id;
END $$;

REVOKE ALL ON FUNCTION public.grant_minor_hosting_approval(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.grant_org_minor_hosting_approval(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_minor_hosting_approval(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.grant_org_minor_hosting_approval(uuid, uuid, integer) TO authenticated, service_role;
COMMIT;
