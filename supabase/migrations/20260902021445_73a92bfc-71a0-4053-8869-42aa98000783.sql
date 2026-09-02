-- ============ team roles ============
do $$ begin
  create type public.team_role as enum ('owner','manager','coach','captain','player');
exception when duplicate_object then null; end $$;

-- ============ team_members ============
CREATE TABLE public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.team_role NOT NULL DEFAULT 'player',
  jersey_number text,
  position text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);
CREATE INDEX team_members_team_idx ON public.team_members (team_id);
CREATE INDEX team_members_user_idx ON public.team_members (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members TO authenticated;
GRANT SELECT ON public.team_members TO anon;
GRANT ALL ON public.team_members TO service_role;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

-- ============ team_invites ============
CREATE TABLE public.team_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  invitee_id uuid NOT NULL,
  invited_by uuid NOT NULL,
  role public.team_role NOT NULL DEFAULT 'player',
  message text,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_invites_status_chk CHECK (status IN ('pending','accepted','declined','cancelled','expired')),
  CONSTRAINT team_invites_role_chk CHECK (role <> 'owner')
);
CREATE UNIQUE INDEX team_invites_one_pending_idx
  ON public.team_invites (team_id, invitee_id) WHERE status = 'pending';
CREATE INDEX team_invites_invitee_idx ON public.team_invites (invitee_id, status);
CREATE INDEX team_invites_team_idx ON public.team_invites (team_id, status);

GRANT SELECT, INSERT, UPDATE ON public.team_invites TO authenticated;
GRANT ALL ON public.team_invites TO service_role;
ALTER TABLE public.team_invites ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER team_members_updated_at BEFORE UPDATE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER team_invites_updated_at BEFORE UPDATE ON public.team_invites
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ helpers ============
CREATE OR REPLACE FUNCTION public.team_owner_of(_team text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT owner_id FROM public.teams WHERE id = _team
$$;

CREATE OR REPLACE FUNCTION public.team_role_of(_team text, _user uuid)
RETURNS public.team_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _user IS NULL THEN NULL
    WHEN public.team_owner_of(_team) = _user THEN 'owner'::public.team_role
    ELSE (SELECT role FROM public.team_members WHERE team_id = _team AND user_id = _user)
  END
$$;

CREATE OR REPLACE FUNCTION public.is_team_member(_team text, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.team_role_of(_team, _user) IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION public.is_team_manager(_team text, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.team_role_of(_team, _user) IN ('owner','manager','coach')
$$;

REVOKE EXECUTE ON FUNCTION public.team_owner_of(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_role_of(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_team_member(text, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_team_manager(text, uuid) TO authenticated;

-- ============ team_members policies ============
-- Roster of a visible (non-hidden) team is readable; writes go through RPCs.
CREATE POLICY "team_members_read" ON public.team_members FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND t.hidden_at IS NULL));

CREATE POLICY "team_members_manager_write" ON public.team_members FOR INSERT TO authenticated
  WITH CHECK (public.is_team_manager(team_id, auth.uid()));

CREATE POLICY "team_members_manager_update" ON public.team_members FOR UPDATE TO authenticated
  USING (public.is_team_manager(team_id, auth.uid()) OR user_id = auth.uid())
  WITH CHECK (
    (public.is_team_manager(team_id, auth.uid()) OR user_id = auth.uid())
    AND role <> 'owner'
  );

CREATE POLICY "team_members_delete" ON public.team_members FOR DELETE TO authenticated
  USING (
    (public.is_team_manager(team_id, auth.uid()) OR user_id = auth.uid())
    AND role <> 'owner'
  );

-- ============ team_invites policies ============
CREATE POLICY "team_invites_read" ON public.team_invites FOR SELECT TO authenticated
  USING (invitee_id = auth.uid() OR public.is_team_manager(team_id, auth.uid()));

CREATE POLICY "team_invites_no_direct_insert" ON public.team_invites FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY "team_invites_no_direct_update" ON public.team_invites FOR UPDATE TO authenticated
  USING (false) WITH CHECK (false);

-- ============ owner backfill + sync ============
INSERT INTO public.team_members (team_id, user_id, role)
SELECT t.id, t.owner_id, 'owner'::public.team_role
FROM public.teams t
WHERE t.owner_id IS NOT NULL
ON CONFLICT (team_id, user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.team_owner_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_id IS NOT NULL THEN
    INSERT INTO public.team_members (team_id, user_id, role)
    VALUES (NEW.id, NEW.owner_id, 'owner')
    ON CONFLICT (team_id, user_id) DO UPDATE SET role = 'owner';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.team_owner_membership() FROM anon, authenticated;

CREATE TRIGGER teams_owner_membership AFTER INSERT OR UPDATE OF owner_id ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.team_owner_membership();

-- ============ invite RPCs ============
CREATE OR REPLACE FUNCTION public.team_invite_player(
  _team text, _user uuid, _role public.team_role DEFAULT 'player', _message text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _id uuid;
  _team_name text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.is_team_manager(_team, _me) THEN RAISE EXCEPTION 'NOT_TEAM_MANAGER'; END IF;
  IF _role = 'owner' THEN RAISE EXCEPTION 'OWNER_NOT_INVITABLE'; END IF;
  IF _user = _me THEN RAISE EXCEPTION 'SELF_INVITE'; END IF;
  IF public.is_team_member(_team, _user) THEN RAISE EXCEPTION 'ALREADY_MEMBER'; END IF;
  IF public.blocks_exist_between(_me, _user) THEN RAISE EXCEPTION 'BLOCKED'; END IF;

  SELECT name INTO _team_name FROM public.teams WHERE id = _team;

  UPDATE public.team_invites SET status = 'expired', updated_at = now()
  WHERE team_id = _team AND invitee_id = _user AND status = 'pending' AND expires_at <= now();

  INSERT INTO public.team_invites (team_id, invitee_id, invited_by, role, message)
  VALUES (_team, _user, _me, _role, nullif(btrim(coalesce(_message,'')), ''))
  RETURNING id INTO _id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_user, 'team_invite', 'Team invitation',
          coalesce(_team_name,'A team') || ' invited you to join as ' || _role::text,
          '/teams/' || _team);

  IF public.is_minor(_user) THEN
    PERFORM public.notify_guardians(_user, 'team_invite',
      'Team invitation for your player',
      coalesce(_team_name,'A team') || ' invited your player to join as ' || _role::text,
      '/parent');
  END IF;

  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.team_respond_invite(_invite uuid, _accept boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _row public.team_invites;
  _team_name text;
  _who text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _row FROM public.team_invites WHERE id = _invite;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'INVITE_NOT_FOUND'; END IF;
  IF _row.invitee_id <> _me THEN RAISE EXCEPTION 'NOT_INVITEE'; END IF;
  IF _row.status <> 'pending' THEN RAISE EXCEPTION 'INVITE_NOT_PENDING'; END IF;
  IF _row.expires_at <= now() THEN
    UPDATE public.team_invites SET status = 'expired', updated_at = now() WHERE id = _invite;
    RAISE EXCEPTION 'INVITE_EXPIRED';
  END IF;

  IF _accept AND public.child_features_locked(_me) THEN
    RAISE EXCEPTION 'CHILD_ACTIVITY_LOCKED';
  END IF;

  SELECT name INTO _team_name FROM public.teams WHERE id = _row.team_id;
  SELECT coalesce(display_name, username, 'A player') INTO _who FROM public.profiles WHERE id = _me;

  IF _accept THEN
    INSERT INTO public.team_members (team_id, user_id, role)
    VALUES (_row.team_id, _me, _row.role)
    ON CONFLICT (team_id, user_id) DO UPDATE SET role = excluded.role, updated_at = now();
    UPDATE public.team_invites SET status = 'accepted', responded_at = now(), updated_at = now()
    WHERE id = _invite;
  ELSE
    UPDATE public.team_invites SET status = 'declined', responded_at = now(), updated_at = now()
    WHERE id = _invite;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT m.user_id,
         CASE WHEN _accept THEN 'team_invite_accepted' ELSE 'team_invite_declined' END,
         CASE WHEN _accept THEN 'Invitation accepted' ELSE 'Invitation declined' END,
         _who || CASE WHEN _accept THEN ' joined ' ELSE ' declined the invite to ' END
           || coalesce(_team_name, 'your team'),
         '/teams/' || _row.team_id
  FROM public.team_members m
  WHERE m.team_id = _row.team_id AND m.role IN ('owner','manager','coach') AND m.user_id <> _me;

  RETURN CASE WHEN _accept THEN 'accepted' ELSE 'declined' END;
END $$;

CREATE OR REPLACE FUNCTION public.team_cancel_invite(_invite uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid(); _row public.team_invites;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _row FROM public.team_invites WHERE id = _invite;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'INVITE_NOT_FOUND'; END IF;
  IF NOT public.is_team_manager(_row.team_id, _me) THEN RAISE EXCEPTION 'NOT_TEAM_MANAGER'; END IF;
  IF _row.status <> 'pending' THEN RAISE EXCEPTION 'INVITE_NOT_PENDING'; END IF;
  UPDATE public.team_invites SET status = 'cancelled', responded_at = now(), updated_at = now()
  WHERE id = _invite;
END $$;

CREATE OR REPLACE FUNCTION public.team_remove_member(_team text, _user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF public.team_owner_of(_team) = _user THEN RAISE EXCEPTION 'OWNER_NOT_REMOVABLE'; END IF;
  IF _user <> _me AND NOT public.is_team_manager(_team, _me) THEN
    RAISE EXCEPTION 'NOT_TEAM_MANAGER';
  END IF;
  DELETE FROM public.team_members WHERE team_id = _team AND user_id = _user;
END $$;

CREATE OR REPLACE FUNCTION public.team_set_member_role(_team text, _user uuid, _role public.team_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF _role = 'owner' THEN RAISE EXCEPTION 'OWNER_ROLE_FIXED'; END IF;
  IF public.team_owner_of(_team) = _user THEN RAISE EXCEPTION 'OWNER_ROLE_FIXED'; END IF;
  IF public.team_role_of(_team, _me) NOT IN ('owner','manager') THEN
    RAISE EXCEPTION 'NOT_TEAM_MANAGER';
  END IF;
  UPDATE public.team_members SET role = _role, updated_at = now()
  WHERE team_id = _team AND user_id = _user;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_A_MEMBER'; END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.team_invite_player(text, uuid, public.team_role, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.team_respond_invite(uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.team_cancel_invite(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.team_remove_member(text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.team_set_member_role(text, uuid, public.team_role) FROM anon;
GRANT EXECUTE ON FUNCTION public.team_invite_player(text, uuid, public.team_role, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_respond_invite(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_cancel_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_remove_member(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_set_member_role(text, uuid, public.team_role) TO authenticated;

-- ============ reputation from real activity ============
CREATE OR REPLACE FUNCTION public.player_activity_stats(_user uuid)
RETURNS TABLE(
  games_joined integer,
  games_attended integer,
  no_shows integer,
  games_completed integer,
  hosted_total integer,
  hosted_completed integer,
  hosted_cancelled integer,
  teams_count integer,
  review_count integer,
  review_avg numeric,
  verified_review_count integer,
  first_activity_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH parts AS (
    SELECT gp.attended, g.completed_at, g.cancelled_at, g.date, gp.created_at
    FROM public.game_participants gp
    JOIN public.hosted_games g ON g.id = gp.game_id
    WHERE gp.user_id = _user
  ),
  hosted AS (
    SELECT completed_at, cancelled_at, created_at FROM public.hosted_games WHERE host_id = _user
  ),
  revs AS (
    SELECT rating, verified FROM public.reviews
    WHERE reviewee_kind = 'player' AND reviewee_id = _user::text
      AND NOT flagged AND NOT is_private
  )
  SELECT
    (SELECT count(*) FROM parts WHERE cancelled_at IS NULL)::int,
    (SELECT count(*) FROM parts WHERE attended IS TRUE AND cancelled_at IS NULL)::int,
    (SELECT count(*) FROM parts WHERE attended IS FALSE AND cancelled_at IS NULL)::int,
    (SELECT count(*) FROM parts WHERE cancelled_at IS NULL AND completed_at IS NOT NULL)::int,
    (SELECT count(*) FROM hosted)::int,
    (SELECT count(*) FROM hosted WHERE completed_at IS NOT NULL AND cancelled_at IS NULL)::int,
    (SELECT count(*) FROM hosted WHERE cancelled_at IS NOT NULL)::int,
    (SELECT count(*) FROM public.team_members WHERE user_id = _user)::int,
    (SELECT count(*) FROM revs)::int,
    (SELECT coalesce(avg(rating), 0) FROM revs),
    (SELECT count(*) FROM revs WHERE verified)::int,
    least(
      (SELECT min(created_at) FROM parts),
      (SELECT min(created_at) FROM hosted)
    );
$$;

REVOKE EXECUTE ON FUNCTION public.player_activity_stats(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.player_activity_stats(uuid) TO authenticated;
