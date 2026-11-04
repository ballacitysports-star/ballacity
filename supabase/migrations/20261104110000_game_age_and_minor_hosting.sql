-- PRIV-2B: strict game age eligibility, adult-only hosting, and authorised hosting by 16-17 year olds.
--
-- Policy (owner-confirmed):
--   1. Under-18 accounts (and accounts of unknown age) never host, or take part in, a game that is
--      declared 18+.  A host's approval can no longer override a game's age range.
--   2. A 16-17 year old may host a youth-inclusive game only with an explicit, recorded approval from
--      (a) an active, verified guardian of that teen, or (b) an adult administrator of the
--      organization the game is run under.  The approval is bound to that one game.
--   3. A guardian or organization approval never overrides the game's own age eligibility.
--   4. A game with no enforced adult-only restriction is youth-inclusive.
--   5. A minor host's name, username, avatar and rating never go into the public host snapshot.
--   6. Under-16 accounts keep today's rule (they cannot host: block_child_hosting).
--   7. Nothing existing is rewritten, cancelled or deleted.  Every rule below fires on new
--      INSERT / selected UPDATE columns only.
--
-- Additive.  No data is removed or rewritten.  Rollback: docs/rollbacks/20261104110000_game_age_and_minor_hosting.down.sql

-- ---------------------------------------------------------------------------------------------
-- 1. One definition of "may this player take part in this game by age"
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private_sec.player_meets_game_age(_game_id text, _player uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  g record;
  bday date;
  player_age integer;
BEGIN
  SELECT min_age, max_age, host_id INTO g FROM public.hosted_games WHERE id = _game_id;
  IF NOT FOUND THEN RETURN true; END IF;
  IF g.min_age IS NULL AND g.max_age IS NULL THEN RETURN true; END IF;
  IF g.host_id = _player THEN RETURN true; END IF;

  SELECT birthday INTO bday FROM public.profile_birthdays WHERE user_id = _player;
  IF bday IS NULL THEN RETURN false; END IF;
  player_age := date_part('year', age(bday))::int;

  IF g.min_age IS NOT NULL AND player_age < g.min_age THEN RETURN false; END IF;
  IF g.max_age IS NOT NULL AND player_age > g.max_age THEN RETURN false; END IF;
  IF public.game_age_range_is_adult_only(g.min_age, g.max_age)
     AND public.age_cohort_of(_player) IS DISTINCT FROM 'adult' THEN
    RETURN false;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION private_sec.player_meets_game_age(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.player_meets_game_age(text, uuid) TO service_role;

-- Joining the roster: the "approved join request" override is gone.
CREATE OR REPLACE FUNCTION public.enforce_game_age_requirement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT private_sec.player_meets_game_age(NEW.game_id, NEW.user_id) THEN
    RAISE EXCEPTION 'AGE_NOT_ELIGIBLE: this game has an age requirement you do not meet.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- Asking to join is refused up front, so there is never a request for a host to approve.
CREATE OR REPLACE FUNCTION public.enforce_join_request_age()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NOT private_sec.player_meets_game_age(NEW.game_id, NEW.player_id) THEN
    RAISE EXCEPTION 'AGE_NOT_ELIGIBLE: this game has an age requirement you do not meet.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_join_request_age() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_join_request_age() TO service_role;
DROP TRIGGER IF EXISTS aa_enforce_join_request_age_trg ON public.join_requests;
CREATE TRIGGER aa_enforce_join_request_age_trg BEFORE INSERT ON public.join_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_join_request_age();

-- ---------------------------------------------------------------------------------------------
-- 2. Approvals for 16-17 year old hosts
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.minor_hosting_approvals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('guardian', 'organization')),
  minor_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  approver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id      uuid REFERENCES public.trainer_orgs(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'revoked', 'expired')),
  game_id     text REFERENCES public.hosted_games(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  used_at     timestamptz,
  revoked_at  timestamptz,
  revoked_by  uuid,
  CONSTRAINT minor_hosting_approvals_org_chk CHECK ((kind = 'organization') = (org_id IS NOT NULL)),
  CONSTRAINT minor_hosting_approvals_ttl_chk CHECK (expires_at <= created_at + interval '31 days')
);
CREATE INDEX IF NOT EXISTS minor_hosting_approvals_minor_idx ON public.minor_hosting_approvals (minor_id);
CREATE INDEX IF NOT EXISTS minor_hosting_approvals_game_idx ON public.minor_hosting_approvals (game_id) WHERE game_id IS NOT NULL;
ALTER TABLE public.minor_hosting_approvals ENABLE ROW LEVEL SECURITY;

-- Readable by the teen, the approver and any active, verified guardian of the teen.  No client writes.
DROP POLICY IF EXISTS "Parties read hosting approvals" ON public.minor_hosting_approvals;
CREATE POLICY "Parties read hosting approvals" ON public.minor_hosting_approvals
  FOR SELECT TO authenticated
  USING (minor_id = auth.uid() OR approver_id = auth.uid() OR public.is_guardian_of(auth.uid(), minor_id));
REVOKE ALL ON public.minor_hosting_approvals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.minor_hosting_approvals TO authenticated;
GRANT ALL ON public.minor_hosting_approvals TO service_role;

ALTER TABLE public.hosted_games
  ADD COLUMN IF NOT EXISTS hosting_approval_id uuid REFERENCES public.minor_hosting_approvals(id) ON DELETE SET NULL;

-- Guardian grants a one-game hosting approval to their 16-17 year old.
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

-- The approver, or an active guardian of the teen, withdraws an approval.  A game already created
-- under it is NOT cancelled or deleted; its roster is closed to new joins so a person can review it.
CREATE OR REPLACE FUNCTION public.revoke_minor_hosting_approval(_approval uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); a public.minor_hosting_approvals%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.minor_hosting_approvals WHERE id = _approval FOR UPDATE;
  IF NOT FOUND OR NOT (a.approver_id = _uid OR public.is_guardian_of(_uid, a.minor_id)) THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = '42501';
  END IF;
  IF a.status = 'revoked' THEN RETURN; END IF;
  UPDATE public.minor_hosting_approvals
     SET status = 'revoked', revoked_at = now(), revoked_by = _uid WHERE id = _approval;
  IF a.game_id IS NOT NULL THEN
    UPDATE public.hosted_games SET joins_closed = true WHERE id = a.game_id AND cancelled_at IS NULL;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.grant_minor_hosting_approval(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.grant_org_minor_hosting_approval(uuid, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_minor_hosting_approval(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_minor_hosting_approval(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.grant_org_minor_hosting_approval(uuid, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_minor_hosting_approval(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. Hosting enforcement (fires after the older guards, so it sees their final values)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_minor_hosting_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _cohort text;
  a public.minor_hosting_approvals%ROWTYPE;
BEGIN
  -- Server/maintenance writes carry no end user.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  _cohort := public.age_cohort_of(NEW.host_id);

  -- (1)/(3) Adult-only games always need a confirmed adult host; no approval changes that.
  IF public.game_age_range_is_adult_only(NEW.min_age, NEW.max_age) AND _cohort IS DISTINCT FROM 'adult' THEN
    RAISE EXCEPTION 'ADULT_HOST_REQUIRED: a game for ages 18 and over must be hosted by an adult.' USING ERRCODE = '42501';
  END IF;

  IF _cohort = 'adult' THEN
    NEW.hosting_approval_id := CASE WHEN TG_OP = 'UPDATE' THEN OLD.hosting_approval_id ELSE NULL END;
    RETURN NEW;
  END IF;

  -- Only a change of host, or a new game, needs a (new) approval; editing an existing game does not.
  IF TG_OP = 'UPDATE' AND NEW.host_id IS NOT DISTINCT FROM OLD.host_id THEN
    NEW.hosting_approval_id := OLD.hosting_approval_id;
    RETURN NEW;
  END IF;

  IF _cohort IS DISTINCT FROM 'teen_16_17' THEN
    RAISE EXCEPTION 'CHILD_CANNOT_HOST: an adult must host games that include children.' USING ERRCODE = '42501';
  END IF;

  IF NEW.hosting_approval_id IS NULL THEN
    RAISE EXCEPTION 'MINOR_HOST_APPROVAL_REQUIRED: a guardian or an organization administrator must approve this game.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO a FROM public.minor_hosting_approvals WHERE id = NEW.hosting_approval_id FOR UPDATE;
  IF NOT FOUND OR a.minor_id <> NEW.host_id OR a.status <> 'active' OR a.expires_at <= now() OR a.game_id IS NOT NULL THEN
    RAISE EXCEPTION 'MINOR_HOST_APPROVAL_INVALID: the approval is missing, used, expired or revoked.' USING ERRCODE = '42501';
  END IF;

  IF a.kind = 'guardian' THEN
    -- The guardian must still be an adult, active and verified, right now.
    IF public.age_cohort_of(a.approver_id) IS DISTINCT FROM 'adult' OR NOT public.is_guardian_of(a.approver_id, NEW.host_id) THEN
      RAISE EXCEPTION 'MINOR_HOST_APPROVAL_INVALID: the guardian approval is no longer valid.' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF public.age_cohort_of(a.approver_id) IS DISTINCT FROM 'adult'
       OR NOT public.is_trainer_org_admin(a.org_id, a.approver_id)
       OR NEW.org_id IS DISTINCT FROM a.org_id THEN
      RAISE EXCEPTION 'MINOR_HOST_APPROVAL_INVALID: the organization approval does not apply to this game.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_minor_hosting_rules() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_minor_hosting_rules() TO service_role;
DROP TRIGGER IF EXISTS y_minor_hosting_rules_trg ON public.hosted_games;
CREATE TRIGGER y_minor_hosting_rules_trg BEFORE INSERT OR UPDATE OF host_id, min_age, max_age, hosting_approval_id
  ON public.hosted_games FOR EACH ROW EXECUTE FUNCTION public.enforce_minor_hosting_rules();

-- The approval is bound to the game once the game row exists.
CREATE OR REPLACE FUNCTION public.bind_minor_hosting_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.hosting_approval_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.hosting_approval_id IS DISTINCT FROM OLD.hosting_approval_id) THEN
    UPDATE public.minor_hosting_approvals
       SET status = 'used', game_id = NEW.id, used_at = now()
     WHERE id = NEW.hosting_approval_id AND status = 'active' AND game_id IS NULL;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.bind_minor_hosting_approval() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bind_minor_hosting_approval() TO service_role;
DROP TRIGGER IF EXISTS y_bind_minor_hosting_approval_trg ON public.hosted_games;
CREATE TRIGGER y_bind_minor_hosting_approval_trg AFTER INSERT OR UPDATE OF hosting_approval_id
  ON public.hosted_games FOR EACH ROW EXECUTE FUNCTION public.bind_minor_hosting_approval();

-- Host identity: for a host who is not a confirmed adult the snapshot is neutral (no name, username,
-- avatar or rating); a game run by a team or organization shows that organizer instead.
CREATE OR REPLACE FUNCTION public.neutralize_minor_host_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF public.age_cohort_of(NEW.host_id) IS DISTINCT FROM 'adult' THEN
    NEW.host_snapshot := jsonb_build_object(
      'name', COALESCE((SELECT t.name FROM public.teams t WHERE t.id = NEW.team_id),
                       (SELECT o.name FROM public.trainer_orgs o WHERE o.id = NEW.org_id),
                       'Youth host'),
      'neutral', true);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.neutralize_minor_host_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.neutralize_minor_host_snapshot() TO service_role;
DROP TRIGGER IF EXISTS yy_neutral_host_snapshot_trg ON public.hosted_games;
CREATE TRIGGER yy_neutral_host_snapshot_trg BEFORE INSERT OR UPDATE OF host_id, host_snapshot, team_id, org_id
  ON public.hosted_games FOR EACH ROW EXECUTE FUNCTION public.neutralize_minor_host_snapshot();
