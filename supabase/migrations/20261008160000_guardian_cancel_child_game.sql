-- A guardian can cancel their child's game spot.
--
-- Until now only the player could drop a game spot (RLS lets a player delete
-- their own rows), so a parent had no way to cancel for their child. This adds
-- a guardian-checked function that removes the child's request/spot, and makes
-- the late-cancellation and refund triggers treat a guardian cancelling for
-- their child exactly like the child cancelling for themselves. Tryouts already
-- support this through cancel_tryout_rsvp(_on_behalf_of).

-- Is the signed-in user the player, or the player's verified guardian?
CREATE OR REPLACE FUNCTION public.is_self_or_guardian(_player uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND (auth.uid() = _player OR public.is_guardian_of(auth.uid(), _player));
$$;
REVOKE ALL ON FUNCTION public.is_self_or_guardian(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_self_or_guardian(uuid) TO authenticated;

-- Late-cancellation tracking: a guardian cancelling for the child counts.
CREATE OR REPLACE FUNCTION public.track_late_game_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
  _g record;
  _who text;
  _mins integer;
BEGIN
  IF TG_TABLE_NAME = 'game_participants' THEN
    _uid := OLD.user_id;
  ELSE
    IF OLD.status <> 'approved' THEN RETURN OLD; END IF;
    _uid := OLD.player_id;
  END IF;

  IF NOT public.is_self_or_guardian(_uid) THEN RETURN OLD; END IF;
  IF COALESCE(current_setting('ballacity.system_release', true), '') = 'on' THEN RETURN OLD; END IF;

  SELECT id, title, date, host_id, cancel_cutoff_min, cancelled_at, completed_at
    INTO _g FROM public.hosted_games WHERE id = OLD.game_id;
  IF _g.id IS NULL OR _g.cancelled_at IS NOT NULL OR _g.completed_at IS NOT NULL THEN
    RETURN OLD;
  END IF;

  IF public.record_late_cancellation(_uid, 'game', _g.id::text, NULL, _g.host_id, _g.title,
                                     _g.date, _g.cancel_cutoff_min)
     AND _g.host_id IS NOT NULL AND _g.host_id <> _uid THEN
    SELECT display_name INTO _who FROM public.profiles WHERE id = _uid;
    _mins := GREATEST(0, floor(extract(epoch FROM (_g.date - now())) / 60)::int);
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      _g.host_id,
      'participant_left_late',
      left(COALESCE(_who, 'A player') || ' cancelled late · ' || _g.title, 200),
      'Dropped ' || public.minutes_phrase(_mins) || ' before start (your cutoff is ' ||
        public.minutes_phrase(_g.cancel_cutoff_min) || '). Their spot is open again.',
      '/games/' || _g.id
    );
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.track_late_game_cancel() FROM PUBLIC, anon, authenticated;

-- Refund settlement: same rule.
CREATE OR REPLACE FUNCTION public.settle_on_player_leave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
BEGIN
  IF TG_TABLE_NAME = 'game_participants' THEN
    _uid := OLD.user_id;
  ELSE
    IF OLD.status <> 'approved' THEN RETURN OLD; END IF;
    _uid := OLD.player_id;
  END IF;
  IF NOT public.is_self_or_guardian(_uid) THEN RETURN OLD; END IF;
  IF COALESCE(current_setting('ballacity.system_release', true), '') = 'on' THEN RETURN OLD; END IF;
  PERFORM public.settle_paid_spot(OLD.game_id, _uid, 'player_cancelled');
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_on_player_leave() FROM PUBLIC, anon, authenticated;

-- The cancellation itself. Anything the child holds for this game goes: an
-- unreviewed payment claim, the request (pending or approved), the roster spot.
-- A verified payment is kept and settled by the trigger above.
CREATE OR REPLACE FUNCTION public.guardian_cancel_child_game(_child uuid, _game text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g record;
  _had_spot boolean;
  _had_request boolean;
  _was_late boolean;
  _who text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_guardian_of(auth.uid(), _child) THEN
    RAISE EXCEPTION 'You can only cancel for a child linked to your account.' USING ERRCODE = '42501';
  END IF;

  SELECT id, title, date, host_id, cancelled_at, completed_at INTO g
    FROM public.hosted_games WHERE id = _game;
  IF g.id IS NULL THEN RAISE EXCEPTION 'Game not found.' USING ERRCODE = 'P0001'; END IF;
  IF g.cancelled_at IS NOT NULL OR g.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This game is no longer on.' USING ERRCODE = 'P0001';
  END IF;
  IF now() >= g.date THEN
    RAISE EXCEPTION 'This game has already started.' USING ERRCODE = 'P0001';
  END IF;

  _had_spot := EXISTS (SELECT 1 FROM public.game_participants WHERE game_id = _game AND user_id = _child)
            OR EXISTS (SELECT 1 FROM public.join_requests WHERE game_id = _game AND player_id = _child AND status = 'approved');
  _had_request := EXISTS (SELECT 1 FROM public.join_requests WHERE game_id = _game AND player_id = _child);
  IF NOT _had_spot AND NOT _had_request THEN RETURN 'nothing'; END IF;

  DELETE FROM public.payment_submissions
   WHERE game_id = _game AND player_id = _child AND status = 'pending';
  DELETE FROM public.join_requests WHERE game_id = _game AND player_id = _child;
  DELETE FROM public.game_participants WHERE game_id = _game AND user_id = _child;

  IF _had_spot AND g.host_id IS NOT NULL AND g.host_id <> _child THEN
    _was_late := EXISTS (
      SELECT 1 FROM public.late_cancellations
       WHERE user_id = _child AND kind = 'game' AND ref_id = _game AND created_at >= now() - interval '1 minute');
    -- A late cancel already sent the host its own notice.
    IF NOT _was_late THEN
      SELECT display_name INTO _who FROM public.profiles WHERE id = _child;
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (
        g.host_id, 'participant_left',
        left(COALESCE(_who, 'A player') || ' left ' || g.title, 200),
        'Their parent or guardian cancelled for them. Their spot is open again.',
        '/games/' || g.id
      );
    END IF;
  END IF;
  RETURN CASE WHEN _had_spot THEN 'cancelled' ELSE 'withdrawn' END;
END;
$$;
REVOKE ALL ON FUNCTION public.guardian_cancel_child_game(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardian_cancel_child_game(uuid, text) TO authenticated;
