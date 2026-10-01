-- A guardian's approval gate for a managed/self-operating minor's team
-- invites and game join requests. Nullable timestamp/uuid columns rather
-- than a new status value: the invite/request stays 'pending' throughout,
-- so nothing that pattern-matches on status strings elsewhere needs to
-- change, and a guardian can act before or after the minor ever sees it.
ALTER TABLE public.team_invites
  ADD COLUMN IF NOT EXISTS guardian_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS guardian_approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.join_requests
  ADD COLUMN IF NOT EXISTS guardian_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS guardian_approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Without these, a guardian's own session can't even see their child's
-- pending item to approve it: team_invites_read/the join_requests policies
-- only ever matched the invitee/player/host/manager, never a guardian.
CREATE POLICY "Guardians view their children's pending team invites"
ON public.team_invites FOR SELECT TO authenticated
USING (public.is_guardian_of(auth.uid(), invitee_id));

CREATE POLICY "Guardians view their children's join requests"
ON public.join_requests FOR SELECT TO authenticated
USING (public.is_guardian_of(auth.uid(), player_id));

CREATE OR REPLACE FUNCTION public.guardian_approve_team_invite(_invite uuid, _approve boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _row public.team_invites;
  _team_name text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _row FROM public.team_invites WHERE id = _invite;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'INVITE_NOT_FOUND'; END IF;
  IF NOT public.is_guardian_of(_me, _row.invitee_id) THEN RAISE EXCEPTION 'NOT_GUARDIAN'; END IF;
  IF _row.status <> 'pending' THEN RAISE EXCEPTION 'INVITE_NOT_PENDING'; END IF;

  IF _approve THEN
    UPDATE public.team_invites
       SET guardian_approved_at = now(), guardian_approved_by = _me, updated_at = now()
     WHERE id = _invite AND status = 'pending';

    SELECT name INTO _team_name FROM public.teams WHERE id = _row.team_id;
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_row.invitee_id, 'team_invite_guardian_approved', 'Your guardian approved this invite',
            'You can now accept the invite to join ' || coalesce(_team_name, 'the team') || '.',
            '/teams/' || _row.team_id);
  ELSE
    UPDATE public.team_invites
       SET status = 'declined', responded_at = now(), updated_at = now()
     WHERE id = _invite AND status = 'pending';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.guardian_approve_join_request(_request uuid, _approve boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _row public.join_requests;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _row FROM public.join_requests WHERE id = _request;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF NOT public.is_guardian_of(_me, _row.player_id) THEN RAISE EXCEPTION 'NOT_GUARDIAN'; END IF;
  IF _row.status <> 'pending' THEN RAISE EXCEPTION 'REQUEST_NOT_PENDING'; END IF;

  IF _approve THEN
    UPDATE public.join_requests
       SET guardian_approved_at = now(), guardian_approved_by = _me
     WHERE id = _request AND status = 'pending';

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_row.player_id, 'join_request_guardian_approved', 'Your guardian approved this request',
            'Your guardian approved your request to join this game.',
            '/games/' || _row.game_id);
  ELSE
    -- join_requests has no 'withdrawn-by-guardian' concept distinct from the
    -- player's own withdrawal; reuse the existing 'rejected' status rather
    -- than widening join_requests_status_chk for a guardian-specific value.
    UPDATE public.join_requests
       SET status = 'rejected', reviewed_at = now(), reviewer_notes = 'Declined by guardian'
     WHERE id = _request AND status = 'pending';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.guardian_approve_team_invite(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guardian_approve_join_request(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardian_approve_team_invite(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardian_approve_join_request(uuid, boolean) TO authenticated;
