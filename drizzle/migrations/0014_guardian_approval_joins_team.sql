CREATE OR REPLACE FUNCTION public.guardian_approve_team_invite(_invite uuid, _approve boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _row public.team_invites;
  _team_name text;
  _who text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _row FROM public.team_invites WHERE id = _invite;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'INVITE_NOT_FOUND'; END IF;
  IF NOT public.is_guardian_of(_me, _row.invitee_id) THEN RAISE EXCEPTION 'NOT_GUARDIAN'; END IF;
  IF _row.status <> 'pending' THEN RAISE EXCEPTION 'INVITE_NOT_PENDING'; END IF;

  IF NOT _approve THEN
    UPDATE public.team_invites
       SET status = 'declined', responded_at = now(), updated_at = now()
     WHERE id = _invite AND status = 'pending';
    RETURN;
  END IF;

  IF _row.expires_at <= now() THEN
    UPDATE public.team_invites SET status = 'expired', updated_at = now() WHERE id = _invite;
    RAISE EXCEPTION 'INVITE_EXPIRED';
  END IF;
  IF public.child_features_locked(_row.invitee_id) THEN
    RAISE EXCEPTION 'CHILD_ACTIVITY_LOCKED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.team_waivers w
    WHERE w.team_id = _row.team_id AND w.published
      AND NOT EXISTS (
        SELECT 1 FROM public.team_waiver_signatures s
        WHERE s.waiver_id = w.id AND s.signer_user_id = _row.invitee_id
      )
  ) THEN
    RAISE EXCEPTION 'WAIVER_REQUIRED: this team requires a signed waiver before you can join.';
  END IF;

  INSERT INTO public.team_members (team_id, user_id, role)
  VALUES (_row.team_id, _row.invitee_id, _row.role)
  ON CONFLICT (team_id, user_id) DO UPDATE SET role = excluded.role, updated_at = now();

  UPDATE public.team_invites
     SET guardian_approved_at = now(), guardian_approved_by = _me,
         status = 'accepted', responded_at = now(), updated_at = now()
   WHERE id = _invite AND status = 'pending';

  SELECT name INTO _team_name FROM public.teams WHERE id = _row.team_id;
  SELECT coalesce(display_name, username, 'A player') INTO _who FROM public.profiles WHERE id = _row.invitee_id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_row.invitee_id, 'team_invite_guardian_approved', 'You joined ' || coalesce(_team_name, 'the team'),
          'Your parent or guardian approved your invite.', '/teams/' || _row.team_id);

  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT m.user_id, 'team_invite_accepted', 'Invitation accepted',
         _who || ' joined ' || coalesce(_team_name, 'your team') || ' (guardian approved)',
         '/teams/' || _row.team_id
  FROM public.team_members m
  WHERE m.team_id = _row.team_id AND m.role IN ('owner','manager','coach') AND m.user_id <> _row.invitee_id;
END;
$function$;