-- A minor's game request needs two answers: the host's and the guardian's. They
-- answer independently, so either can come first.
--
-- guardian_approve_join_request only accepted a request that was still 'pending'.
-- Once the host approved first (a host sees "New request to join" at once; a
-- guardian opens the Parent Center later) the request was 'approved', the
-- guardian's answer was refused with REQUEST_NOT_PENDING, the Parent Center no
-- longer listed it, and the roster gate keeps waiting for a guardian approval
-- that can no longer be given. The child was stuck for good.
--
-- A guardian can now answer a request that is pending or already approved by
-- the host, until the child is actually on the roster. After that the spot is
-- cancelled with guardian_cancel_child_game, not by declining a request that has
-- already been acted on.

CREATE OR REPLACE FUNCTION public.guardian_approve_join_request(_request uuid, _approve boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _row public.join_requests;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _row FROM public.join_requests WHERE id = _request FOR UPDATE;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF NOT public.is_guardian_of(_me, _row.player_id) THEN RAISE EXCEPTION 'NOT_GUARDIAN'; END IF;
  IF _row.status NOT IN ('pending', 'approved') THEN RAISE EXCEPTION 'REQUEST_NOT_PENDING'; END IF;
  IF EXISTS (SELECT 1 FROM public.game_participants gp
              WHERE gp.game_id = _row.game_id AND gp.user_id = _row.player_id) THEN
    RAISE EXCEPTION 'ALREADY_ON_ROSTER: this child is already in the game; cancel their spot from the game page.';
  END IF;

  IF _approve THEN
    UPDATE public.join_requests
       SET guardian_approved_at = COALESCE(guardian_approved_at, now()),
           guardian_approved_by = COALESCE(guardian_approved_by, _me)
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
    UPDATE public.join_requests
       SET status = 'rejected', reviewed_at = now(), reviewer_notes = 'Declined by guardian'
     WHERE id = _request AND status IN ('pending', 'approved');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.guardian_approve_join_request(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardian_approve_join_request(uuid, boolean) TO authenticated;
