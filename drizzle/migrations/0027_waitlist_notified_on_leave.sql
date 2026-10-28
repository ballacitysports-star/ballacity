-- Tell the waitlist when a spot opens.
--
-- The game page promises it: "the roster is full — join the waitlist to get the
-- next opening". But the only thing that ever notified a waiting player was the
-- sweep that releases an unpaid, expired spot hold. A player leaving, a late
-- cancel, or the host removing someone opened a seat and told nobody, so the
-- waitlist only worked if people kept refreshing the page.
--
-- When a roster row is deleted and a seat is genuinely open to new players, the
-- player who has waited longest (preferring the position that just opened) is
-- told once. Several seats opening close together go to different players: nobody
-- is told twice about the same game within half an hour. Nothing is held for them;
-- the seat goes to whoever takes it, as it always has.

CREATE OR REPLACE FUNCTION public.notify_waitlist_on_spot_open()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g record;
  _taken int;
  _next uuid;
BEGIN
  -- An unpaid spot hold being released tells the waitlist itself.
  IF COALESCE(current_setting('ballacity.system_release', true), '') = 'on' THEN
    RETURN OLD;
  END IF;

  SELECT id, title, date, max_players, joins_closed, signup_cutoff_min,
         cancelled_at, completed_at, status
    INTO g
  FROM public.hosted_games WHERE id = OLD.game_id;

  -- The game itself is going away, or is not taking players any more.
  IF NOT FOUND THEN RETURN OLD; END IF;
  IF g.cancelled_at IS NOT NULL OR g.completed_at IS NOT NULL
     OR COALESCE(g.status, '') IN ('cancelled', 'completed') THEN
    RETURN OLD;
  END IF;
  IF g.joins_closed OR now() >= g.date THEN RETURN OLD; END IF;
  IF COALESCE(g.signup_cutoff_min, 0) > 0
     AND now() >= g.date - make_interval(mins => g.signup_cutoff_min) THEN
    RETURN OLD;
  END IF;

  SELECT COUNT(*) INTO _taken FROM public.game_participants WHERE game_id = OLD.game_id;
  IF _taken >= GREATEST(g.max_players, 1) THEN RETURN OLD; END IF;

  SELECT w.user_id INTO _next
    FROM public.game_position_waitlist w
   WHERE w.game_id = OLD.game_id
     AND w.status = 'waiting'
     AND w.user_id <> OLD.user_id
     AND NOT EXISTS (SELECT 1 FROM public.game_participants gp
                      WHERE gp.game_id = w.game_id AND gp.user_id = w.user_id)
     AND NOT EXISTS (SELECT 1 FROM public.notifications n
                      WHERE n.user_id = w.user_id
                        AND n.type = 'waitlist_spot_open'
                        AND n.link = '/games/' || OLD.game_id
                        AND n.created_at > now() - interval '30 minutes')
   ORDER BY (w.position IS NOT DISTINCT FROM OLD.position) DESC, w.created_at ASC
   LIMIT 1;
  IF _next IS NULL THEN RETURN OLD; END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (
    _next,
    'waitlist_spot_open',
    left('A spot opened up · ' || g.title, 200),
    'You''re next on the waitlist. Grab it before someone else does.',
    '/games/' || OLD.game_id
  );
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_waitlist_on_spot_open() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS game_participants_notify_waitlist ON public.game_participants;
CREATE TRIGGER game_participants_notify_waitlist
AFTER DELETE ON public.game_participants
FOR EACH ROW EXECUTE FUNCTION public.notify_waitlist_on_spot_open();
