-- PRIV-2B (part 2): payment responsibility for youth-hosted games, and no minor-host identity through name lookups.
--
-- Policy (owner-confirmed):
--   * A minor cannot collect payments through BallaCity. Nobody who is not a confirmed adult can be the payee of a
--     payment submission, hold payment methods, or hold the payment settings of a paid game.
--   * A paid game with a minor host needs an authorised adult (the approving guardian) or an adult administrator of
--     the approving organization to manage payment. That person is recorded on the hosting approval, and is the only
--     payee for the game.
--   * A guardian/organization approval never overrides a game's age eligibility (unchanged, see the previous migration).
--   * Public game records must not disclose a protected minor's identity. The remaining name lookup that did
--     (visible_avatars, which returned any account's display name to any caller) now hides the name and initials of an
--     account that is not a confirmed adult from viewers who have no relationship to it.
-- Additive. Existing rows are untouched; every rule fires on new writes (INSERT, or UPDATE of the guarded columns).

-- ---------------------------------------------------------------------------------------------
-- 1. Approvals can name a payment manager (the approver, an adult)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.minor_hosting_approvals ADD COLUMN IF NOT EXISTS payment_manager_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DROP FUNCTION IF EXISTS public.grant_minor_hosting_approval(uuid, integer);
DROP FUNCTION IF EXISTS public.grant_org_minor_hosting_approval(uuid, uuid, integer);

CREATE OR REPLACE FUNCTION public.grant_minor_hosting_approval(_minor uuid, _valid_hours integer DEFAULT 168, _manage_payments boolean DEFAULT false)
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
  INSERT INTO public.minor_hosting_approvals (kind, minor_id, approver_id, expires_at, payment_manager_id)
  VALUES ('guardian', _minor, _uid, now() + make_interval(hours => _valid_hours), CASE WHEN _manage_payments THEN _uid END)
  RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.grant_org_minor_hosting_approval(_minor uuid, _org uuid, _valid_hours integer DEFAULT 168, _manage_payments boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF public.age_cohort_of(_uid) IS DISTINCT FROM 'adult' OR NOT public.is_trainer_org_admin(_org, _uid) THEN
    RAISE EXCEPTION 'NOT_ORG_ADMIN: only an adult administrator of this organization can approve hosting.' USING ERRCODE = '42501';
  END IF;
  -- The administrator is not told why a member cannot be approved (age band, membership or an unknown id):
  -- membership is checked first and every refusal is the same, so the call is not an age lookup.
  IF NOT (public.is_org_member(_org, _minor)
          OR EXISTS (SELECT 1 FROM public.trainer_org_members m WHERE m.org_id = _org AND m.user_id = _minor))
     OR public.age_cohort_of(_minor) IS DISTINCT FROM 'teen_16_17' THEN
    RAISE EXCEPTION 'NOT_ELIGIBLE: this member cannot be approved for hosting.' USING ERRCODE = '42501';
  END IF;
  IF _valid_hours IS NULL OR _valid_hours < 1 OR _valid_hours > 720 THEN
    RAISE EXCEPTION 'INVALID_DURATION' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.minor_hosting_approvals (kind, minor_id, approver_id, org_id, expires_at, payment_manager_id)
  VALUES ('organization', _minor, _uid, _org, now() + make_interval(hours => _valid_hours), CASE WHEN _manage_payments THEN _uid END)
  RETURNING id INTO _id;
  RETURN _id;
END $$;

REVOKE ALL ON FUNCTION public.grant_minor_hosting_approval(uuid, integer, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.grant_org_minor_hosting_approval(uuid, uuid, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_minor_hosting_approval(uuid, integer, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.grant_org_minor_hosting_approval(uuid, uuid, integer, boolean) TO authenticated, service_role;

-- The adult who currently manages payment for a game hosted by a non-adult, or NULL.  Valid only while the approval
-- stands (not revoked) and the manager is still an adult guardian of the host / adult administrator of the organization.
CREATE OR REPLACE FUNCTION private_sec.minor_game_payment_manager(_game_id text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT a.payment_manager_id
    FROM public.hosted_games g
    JOIN public.minor_hosting_approvals a ON a.id = g.hosting_approval_id
   WHERE g.id = _game_id
     AND a.status = 'used' AND a.game_id = g.id
     AND a.payment_manager_id IS NOT NULL
     AND public.age_cohort_of(a.payment_manager_id) = 'adult'
     AND CASE a.kind
           WHEN 'guardian' THEN public.is_guardian_of(a.payment_manager_id, a.minor_id)
           ELSE public.is_trainer_org_admin(a.org_id, a.payment_manager_id)
         END
$$;
REVOKE ALL ON FUNCTION private_sec.minor_game_payment_manager(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.minor_game_payment_manager(text) TO service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. A paid game with a minor host needs an adult payment manager
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_minor_game_price()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a public.minor_hosting_approvals%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(NEW.price, 0) <= 0 THEN RETURN NEW; END IF;
  IF public.age_cohort_of(NEW.host_id) = 'adult' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.price IS NOT DISTINCT FROM OLD.price AND NEW.host_id IS NOT DISTINCT FROM OLD.host_id THEN
    RETURN NEW;                                    -- an existing paid game stays as it is
  END IF;
  SELECT * INTO a FROM public.minor_hosting_approvals WHERE id = NEW.hosting_approval_id;
  IF NOT FOUND OR a.payment_manager_id IS NULL OR a.status NOT IN ('active', 'used') THEN
    RAISE EXCEPTION 'MINOR_HOST_PAYMENT_MANAGER_REQUIRED: a paid game hosted by a minor needs a guardian or organization administrator to manage payment.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_minor_game_price() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_minor_game_price() TO service_role;
DROP TRIGGER IF EXISTS yz_minor_game_price_trg ON public.hosted_games;
CREATE TRIGGER yz_minor_game_price_trg BEFORE INSERT OR UPDATE OF price, host_id, hosting_approval_id
  ON public.hosted_games FOR EACH ROW EXECUTE FUNCTION public.enforce_minor_game_price();

-- Payment settings that charge money: held by an adult; for a minor-hosted game, by that game's payment manager.
CREATE OR REPLACE FUNCTION public.enforce_minor_payment_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _game_host uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NOT (COALESCE(NEW.entry_fee, 0) > 0 OR NEW.payment_mode = 'ballacity_processed') THEN RETURN NEW; END IF;
  IF public.age_cohort_of(NEW.host_id) IS DISTINCT FROM 'adult' THEN
    RAISE EXCEPTION 'MINOR_CANNOT_COLLECT_PAYMENTS: only an adult can collect payment for a game.' USING ERRCODE = '42501';
  END IF;
  SELECT host_id INTO _game_host FROM public.hosted_games WHERE id = NEW.game_id;
  IF _game_host IS NOT NULL AND public.age_cohort_of(_game_host) IS DISTINCT FROM 'adult'
     AND NEW.host_id IS DISTINCT FROM private_sec.minor_game_payment_manager(NEW.game_id) THEN
    RAISE EXCEPTION 'MINOR_HOST_PAYMENT_MANAGER_REQUIRED: payment for this game must be managed by its approving guardian or organization administrator.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_minor_payment_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_minor_payment_settings() TO service_role;
DROP TRIGGER IF EXISTS y_minor_payment_settings_trg ON public.game_payment_settings;
CREATE TRIGGER y_minor_payment_settings_trg BEFORE INSERT OR UPDATE ON public.game_payment_settings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_minor_payment_settings();

-- Who may write the payment settings of a game: its host, or, for a game hosted by a minor, its payment manager.
-- The INSERT/UPDATE policies only checked host_id = auth.uid(), so any signed-in account could add a settings row to
-- someone else's game, and the payment flow treats the latest row for a game as the host's (so players could be
-- directed to pay that account). Closed here for both cases.
CREATE OR REPLACE FUNCTION private_sec.can_manage_game_payment_settings(_game_id text, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT _user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.hosted_games g WHERE g.id = _game_id AND g.host_id = _user)
    OR private_sec.minor_game_payment_manager(_game_id) = _user)
$$;
REVOKE ALL ON FUNCTION private_sec.can_manage_game_payment_settings(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.can_manage_game_payment_settings(text, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Hosts manage own game payment settings (insert)" ON public.game_payment_settings;
CREATE POLICY "Hosts manage own game payment settings (insert)" ON public.game_payment_settings
  FOR INSERT TO authenticated
  WITH CHECK (host_id = auth.uid() AND private_sec.can_manage_game_payment_settings(game_id, auth.uid()));
DROP POLICY IF EXISTS "Hosts manage own game payment settings (update)" ON public.game_payment_settings;
CREATE POLICY "Hosts manage own game payment settings (update)" ON public.game_payment_settings
  FOR UPDATE TO authenticated
  USING (host_id = auth.uid())
  WITH CHECK (host_id = auth.uid() AND private_sec.can_manage_game_payment_settings(game_id, auth.uid()));

-- A new payment submission can only name an adult payee, and for a minor-hosted game only its payment manager.
-- (Existing submissions keep moving through their states: the rule is on INSERT.)
CREATE OR REPLACE FUNCTION public.enforce_game_payment_cohort()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _game_host uuid;
BEGIN
  IF NEW.player_id IS NOT NULL AND NOT public.game_payments_allowed(NEW.player_id) THEN
    RAISE EXCEPTION 'PAYMENTS_NOT_AVAILABLE: payment coordination is not available for this account yet.';
  END IF;
  IF NEW.host_id IS NOT NULL AND NOT public.game_payments_allowed(NEW.host_id) THEN
    RAISE EXCEPTION 'PAYMENTS_NOT_AVAILABLE: payment coordination is not available for this host account yet.';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.host_id IS NOT NULL THEN
    IF public.age_cohort_of(NEW.host_id) IS DISTINCT FROM 'adult' THEN
      RAISE EXCEPTION 'MINOR_CANNOT_COLLECT_PAYMENTS: only an adult can collect payment for a game.' USING ERRCODE = '42501';
    END IF;
    SELECT host_id INTO _game_host FROM public.hosted_games WHERE id = NEW.game_id;
    IF _game_host IS NOT NULL AND public.age_cohort_of(_game_host) IS DISTINCT FROM 'adult'
       AND NEW.host_id IS DISTINCT FROM private_sec.minor_game_payment_manager(NEW.game_id) THEN
      RAISE EXCEPTION 'MINOR_HOST_PAYMENT_MANAGER_REQUIRED: payment for this game must go to its approving guardian or organization administrator.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Payment methods and PayPal accounts are payee records: a non-adult cannot create or enable one.
CREATE OR REPLACE FUNCTION public.enforce_adult_payee_records()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'host_payment_methods' AND TG_OP = 'UPDATE' THEN
    IF NEW.is_enabled IS NOT TRUE THEN
      RETURN NEW;                                  -- switching one off is always allowed
    END IF;
  END IF;
  IF public.age_cohort_of(NEW.host_id) IS DISTINCT FROM 'adult' THEN
    RAISE EXCEPTION 'MINOR_CANNOT_COLLECT_PAYMENTS: only an adult can set up payment collection.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_adult_payee_records() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_adult_payee_records() TO service_role;
DROP TRIGGER IF EXISTS y_adult_payee_trg ON public.host_payment_methods;
CREATE TRIGGER y_adult_payee_trg BEFORE INSERT OR UPDATE ON public.host_payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.enforce_adult_payee_records();
DROP TRIGGER IF EXISTS y_adult_payee_trg ON public.host_paypal_accounts;
CREATE TRIGGER y_adult_payee_trg BEFORE INSERT OR UPDATE ON public.host_paypal_accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_adult_payee_records();

-- Payment handles of an account that is not a confirmed adult are never shown to anyone (pre-existing rows included).
CREATE OR REPLACE FUNCTION public.get_game_host_payment_methods(_host_id uuid, _game_id text)
 RETURNS TABLE(id uuid, host_id uuid, payment_type text, label text, username text, payment_url text, contact_info text, instructions text, is_enabled boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _settings public.game_payment_settings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF public.age_cohort_of(_host_id) IS DISTINCT FROM 'adult' THEN RETURN; END IF;

  SELECT * INTO _settings FROM public.game_payment_settings gps
   WHERE gps.game_id = _game_id AND gps.host_id = _host_id
   ORDER BY gps.created_at DESC LIMIT 1;
  IF _settings.id IS NULL THEN RETURN; END IF;

  RETURN QUERY
    SELECT hpm.id, hpm.host_id, hpm.payment_type, hpm.label, hpm.username, hpm.payment_url, hpm.contact_info, hpm.instructions, hpm.is_enabled
    FROM public.host_payment_methods hpm
    WHERE hpm.host_id = _host_id
      AND hpm.is_enabled = true
      AND (COALESCE(array_length(_settings.accepted_method_ids, 1), 0) = 0 OR hpm.id = ANY(_settings.accepted_method_ids));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_host_payment_methods(_host_id uuid)
 RETURNS TABLE(id uuid, host_id uuid, payment_type text, label text, username text, payment_url text, contact_info text, instructions text, is_enabled boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF public.age_cohort_of(_host_id) IS DISTINCT FROM 'adult' THEN RETURN; END IF;

  IF auth.uid() = _host_id
     OR EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.host_id = _host_id AND jr.player_id = auth.uid() AND jr.status = 'approved')
     OR EXISTS (SELECT 1 FROM public.payment_submissions ps WHERE ps.host_id = _host_id AND ps.player_id = auth.uid())
     OR EXISTS (SELECT 1 FROM public.game_participants gp JOIN public.hosted_games hg ON hg.id = gp.game_id
                 WHERE hg.host_id = _host_id AND gp.user_id = auth.uid())
  THEN
    RETURN QUERY
      SELECT hpm.id, hpm.host_id, hpm.payment_type, hpm.label, hpm.username, hpm.payment_url, hpm.contact_info, hpm.instructions, hpm.is_enabled
      FROM public.host_payment_methods hpm
      WHERE hpm.host_id = _host_id AND hpm.is_enabled = true;
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------------------------
-- 3. Name lookups: a non-adult account's name and initials are shown only to people connected to them
-- ---------------------------------------------------------------------------------------------
-- visible_avatars(ids) returned display_name and initials for any id to any caller, so a 16-17 year old host's id
-- (which is part of the public game row) could be turned into a name. Adults are unchanged. For an account that is
-- not a confirmed adult, name and initials are returned only to a person who has a real reason to know them:
-- see private_sec.can_see_minor_name. Anyone else gets NULL (the app shows a neutral placeholder), so a relationship
-- this list misses fails safe (a placeholder) rather than leaking a name.
CREATE OR REPLACE FUNCTION private_sec.can_see_minor_name(_viewer uuid, _subject uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT _viewer IS NOT NULL AND (
       _viewer = _subject
    OR public.is_guardian_of(_viewer, _subject)
    OR public.shares_game_or_chat(_viewer, _subject)
    OR public.shares_team(_viewer, _subject)
    OR public.has_role(_viewer, 'admin') OR public.has_role(_viewer, 'superadmin') OR public.has_role(_viewer, 'moderator')
    -- the host (or payment manager) dealing with this person's request, waitlist place or payment
    OR EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.player_id = _subject AND jr.host_id = _viewer)
    OR EXISTS (SELECT 1 FROM public.game_position_waitlist w JOIN public.hosted_games g ON g.id = w.game_id
                WHERE w.user_id = _subject AND g.host_id = _viewer)
    OR EXISTS (SELECT 1 FROM public.payment_submissions ps WHERE ps.player_id = _subject AND ps.host_id = _viewer)
    -- a team's staff dealing with an invitation or tryout sign-up
    OR EXISTS (SELECT 1 FROM public.team_invites i WHERE i.invitee_id = _subject
                AND (i.invited_by = _viewer OR public.is_team_manager(i.team_id, _viewer)))
    OR EXISTS (SELECT 1 FROM public.tryout_rsvps r WHERE r.user_id = _subject AND public.is_team_manager(r.team_id, _viewer))
    -- an organization's administrators dealing with a member or a request to join
    OR EXISTS (SELECT 1 FROM public.org_members m WHERE m.user_id = _subject AND public.is_trainer_org_admin(m.org_id, _viewer))
    OR EXISTS (SELECT 1 FROM public.org_member_requests q WHERE q.user_id = _subject AND public.is_trainer_org_admin(q.org_id, _viewer))
    OR EXISTS (SELECT 1 FROM public.trainer_org_members m WHERE m.user_id = _subject AND public.is_trainer_org_admin(m.org_id, _viewer))
    -- someone the person has accepted as a follower
    OR EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = _viewer AND f.followee_id = _subject)
  )
$$;
REVOKE ALL ON FUNCTION private_sec.can_see_minor_name(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.can_see_minor_name(uuid, uuid) TO service_role;  -- called only from visible_avatars (definer); not an oracle for third parties

CREATE OR REPLACE FUNCTION private_sec.visible_avatars(_ids uuid[])
 RETURNS TABLE(id uuid, display_name text, avatar_initials text, avatar_url text, avatar_visibility text, avatar_hidden boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH base AS (
    SELECT p.*,
           (public.age_cohort_of(p.id) = 'adult'
            OR p.id = auth.uid()
            OR private_sec.can_see_minor_name(auth.uid(), p.id)
            OR (auth.uid() IS NOT NULL AND private_sec.profile_visibility_of(p.id) IN ('public', 'members'))
            OR private_sec.profile_visibility_of(p.id) = 'public') AS name_ok
      FROM public.profiles p
     WHERE p.id = ANY(_ids)
       AND p.suspended_at IS NULL
  )
  SELECT
    b.id,
    CASE WHEN b.name_ok THEN b.display_name END,
    CASE WHEN b.name_ok THEN b.avatar_initials END,
    CASE
      WHEN coalesce(b.avatar_url, b.avatar_url_private) IS NULL THEN NULL
      WHEN b.id = auth.uid() THEN coalesce(b.avatar_url, b.avatar_url_private)
      WHEN b.avatar_visibility = 'public' THEN coalesce(b.avatar_url, b.avatar_url_private)
      WHEN b.avatar_visibility = 'members' AND auth.uid() IS NOT NULL
        THEN coalesce(b.avatar_url, b.avatar_url_private)
      WHEN b.avatar_visibility = 'game_members'
        AND auth.uid() IS NOT NULL
        AND public.shares_game_or_chat(auth.uid(), b.id)
        THEN coalesce(b.avatar_url, b.avatar_url_private)
      ELSE NULL
    END AS avatar_url,
    b.avatar_visibility,
    (
      coalesce(b.avatar_url, b.avatar_url_private) IS NOT NULL
      AND NOT (
        b.id = auth.uid()
        OR b.avatar_visibility = 'public'
        OR (b.avatar_visibility = 'members' AND auth.uid() IS NOT NULL)
        OR (
          b.avatar_visibility = 'game_members'
          AND auth.uid() IS NOT NULL
          AND public.shares_game_or_chat(auth.uid(), b.id)
        )
      )
    ) AS avatar_hidden
  FROM base b;
$function$;
