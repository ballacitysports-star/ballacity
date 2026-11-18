-- WP 2.0 (availability-first, Phase 2): a game invitation the server stands behind.
--
-- WHY. Today an invitation is a row in availability_contact_requests with kind = 'invite', and the server checks nothing about
-- the game: not that game_id exists, not that the sender hosts it, not that it is upcoming or has space. The title, time and
-- place shown to the player (game_title, game_starts_at, game_location, the message header) and the notification are all
-- written by the sender's app, so they can name someone else's game or one that does not exist. Accepting only flips a status;
-- the player then sends an ordinary join request the host must approve again. A private game cannot even be opened by the
-- player it was offered to.
--
-- WHAT.
-- 1. public.game_invites: one row per invitation (game, host, invitee, the availability post it answered, status). Clients read
--    their own rows (invitee, host, the invitee's guardian) and change them only through the functions below.
-- 2. public.game_invite_player(_game, _invitee, _availability, _message): the host invites one player. The server checks:
--      - the caller hosts the game, and it is upcoming, not cancelled, completed, hidden or closed to joins, before its signup
--        cutoff, and has a free place;
--      - the player is not the host and has no place or approved request already;
--      - the host can see one of the player's open availability posts (the read policy's rule: blocks either way, suspended
--        accounts, minors and unknown ages); the player's "allow invites" setting; the messaging rules for minors; a minor
--        whose guardian has not allowed games; the game's age range (an unknown age does not fit a game that has one);
--      - at most 50 pending invitations per game and 100 invitations per host per day; not again within 7 days of a decline.
--    Every refusal about the player is the one neutral INVITE_NOT_AVAILABLE, so it says nothing about their age, settings or
--    blocks. A second invitation while one is pending returns the pending one. The notification is written here from the real
--    game; a minor's guardians are told too.
-- 3. public.game_invite_players(_game, _invitees[], _message): up to 30 at once; returns how many were invited and why the rest
--    were not.
-- 4. public.game_respond_invite(_invite, _accept): the invitee answers. Accepting (owner decision 2026-11-18) approves their
--    place request at once: a join request is created if there is none (every insert check still applies: declared age, a
--    guardian's permission for games, the host's blocks) and set to approved. The roster, payment and per-game guardian approval
--    then follow exactly as for any approved player. A game that has closed meanwhile marks the invitation expired; a full one
--    leaves it pending. The host is told.
-- 5. public.game_cancel_invite(_invite): the host withdraws a pending invitation.
-- 6. A pending or accepted invitation lets the invitee open that one private game (owner decision 2026-11-18).
-- 7. The old path, availability_contact_requests with kind = 'invite', now requires that the sender hosts an open game named by
--    game_id, and copies its title, time, sport and place from the game instead of trusting the sender; those fields and the
--    message can no longer be rewritten afterwards.
--
-- Rollback: docs/rollbacks/20261119100000_game_invites.down.sql.

-- 1. The table ----------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.game_invites (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         text NOT NULL REFERENCES public.hosted_games(id) ON DELETE CASCADE,
  host_id         uuid NOT NULL,
  invitee_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  availability_id uuid REFERENCES public.player_availabilities(id) ON DELETE SET NULL,
  message         text CHECK (message IS NULL OR length(message) <= 500),
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  join_request_id uuid REFERENCES public.join_requests(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  responded_at    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS game_invites_one_pending_idx ON public.game_invites (game_id, invitee_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS game_invites_invitee_idx ON public.game_invites (invitee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS game_invites_host_idx ON public.game_invites (host_id, created_at DESC);
ALTER TABLE public.game_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.game_invites FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.game_invites TO authenticated;
GRANT ALL ON TABLE public.game_invites TO service_role;
COMMENT ON TABLE public.game_invites IS
  'WP 2.0: invitations to a game, written only by game_invite_player / game_respond_invite / game_cancel_invite.';

DROP POLICY IF EXISTS "Invitee, host and guardian read game invites" ON public.game_invites;
CREATE POLICY "Invitee, host and guardian read game invites" ON public.game_invites
  FOR SELECT TO authenticated
  USING (
    invitee_id = auth.uid()
    OR host_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.hosted_games g WHERE g.id = game_invites.game_id AND g.host_id = auth.uid())
    OR private_sec.is_guardian_of(auth.uid(), invitee_id)
  );

-- 2. Helpers ----------------------------------------------------------------------------------------------------------------------
-- Whether a game takes invitations now: upcoming, listed, open to joins, before its signup cutoff.
CREATE OR REPLACE FUNCTION private_sec.game_open_for_invites(_game text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.hosted_games g
     WHERE g.id = _game
       AND g.cancelled_at IS NULL AND g.completed_at IS NULL
       AND COALESCE(g.status, '') NOT IN ('completed', 'in_progress', 'cancelled')
       AND g.hidden_at IS NULL AND g.moderator_hidden_at IS NULL AND g.org_hidden_at IS NULL
       AND NOT g.joins_closed
       AND now() < g.date
       AND (COALESCE(g.signup_cutoff_min, 0) <= 0 OR now() < g.date - make_interval(mins => g.signup_cutoff_min))
  )
$$;
REVOKE ALL ON FUNCTION private_sec.game_open_for_invites(text) FROM PUBLIC, anon, authenticated;

-- Whether a player's age fits a game's range. A game without a range fits everyone; an unknown age fits no range.
CREATE OR REPLACE FUNCTION private_sec.game_age_fits(_game text, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT CASE
           WHEN g.min_age IS NULL AND g.max_age IS NULL THEN true
           WHEN b.birthday IS NULL THEN false
           ELSE (g.min_age IS NULL OR date_part('year', age(b.birthday))::int >= g.min_age)
            AND (g.max_age IS NULL OR date_part('year', age(b.birthday))::int <= g.max_age)
         END
    FROM public.hosted_games g
    LEFT JOIN public.profile_birthdays b ON b.user_id = _user
   WHERE g.id = _game
$$;
REVOKE ALL ON FUNCTION private_sec.game_age_fits(text, uuid) FROM PUBLIC, anon, authenticated;

-- A pending or accepted invitation to a game (for the private-game read rule).
CREATE OR REPLACE FUNCTION private_sec.has_game_invite(_game text, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT _user IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.game_invites i
     WHERE i.game_id = _game AND i.invitee_id = _user AND i.status IN ('pending', 'accepted'))
$$;
REVOKE ALL ON FUNCTION private_sec.has_game_invite(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.has_game_invite(text, uuid) TO authenticated, service_role;

-- "Basketball · Sat, Nov 22 at 6:30 PM", in the game's timezone.
CREATE OR REPLACE FUNCTION private_sec.game_invite_when(_game text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT g.sport || ' · ' || to_char(g.date AT TIME ZONE private_sec.safe_timezone(g.timezone), 'Dy, Mon FMDD "at" FMHH12:MI AM')
    FROM public.hosted_games g WHERE g.id = _game
$$;
REVOKE ALL ON FUNCTION private_sec.game_invite_when(text) FROM PUBLIC, anon, authenticated;

-- 3. Invite one player -----------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_invite_player(
  _game text, _invitee uuid, _availability uuid DEFAULT NULL, _message text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _me      uuid := auth.uid();
  _g       record;
  _post    uuid;
  _mode    text;
  _block   text;
  _id      uuid;
  _msg     text := NULLIF(btrim(COALESCE(_message, '')), '');
  _when    text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  SELECT id, host_id, title, date INTO _g FROM public.hosted_games WHERE id = _game FOR NO KEY UPDATE;
  IF _g.id IS NULL OR _g.host_id IS DISTINCT FROM _me THEN
    RAISE EXCEPTION 'NOT_GAME_HOST: only the game''s host can invite players to it.' USING ERRCODE = '42501';
  END IF;
  IF _invitee IS NULL OR _invitee = _me THEN RAISE EXCEPTION 'SELF_INVITE'; END IF;
  IF _msg IS NOT NULL AND length(_msg) > 500 THEN RAISE EXCEPTION 'Message too long (max 500 characters).'; END IF;
  IF NOT private_sec.game_open_for_invites(_game) THEN
    RAISE EXCEPTION 'GAME_NOT_OPEN: this game is not taking players now.';
  END IF;
  IF (SELECT count(*) FROM public.game_participants p WHERE p.game_id = _game)
     >= (SELECT max_players FROM public.hosted_games WHERE id = _game) THEN
    RAISE EXCEPTION 'GAME_FULL: this game has no free places.';
  END IF;
  IF private_sec.is_game_participant(_game, _invitee)
     OR EXISTS (SELECT 1 FROM public.join_requests jr
                 WHERE jr.game_id = _game AND jr.player_id = _invitee AND jr.status = 'approved') THEN
    RAISE EXCEPTION 'ALREADY_IN_GAME: this player already has a place.';
  END IF;

  -- A pending invitation answers a second one (no second notification).
  SELECT id INTO _id FROM public.game_invites WHERE game_id = _game AND invitee_id = _invitee AND status = 'pending';
  IF _id IS NOT NULL THEN RETURN _id; END IF;

  -- The player: one of their open posts the host can see (blocks either way, suspended accounts, minors and unknown ages
  -- under the read policy's rule), their invitation setting, the messaging rules for minors, a guardian's permission for
  -- games, the game's age range. One answer for all of them.
  SELECT a.id INTO _post
    FROM public.player_availabilities a
   WHERE a.user_id = _invitee
     AND (_availability IS NULL OR a.id = _availability)
     AND a.status = 'open' AND a.hidden_at IS NULL
     AND COALESCE(private_sec.availability_expires_at(a.time_slots, a.timezone, a.starts_on, a.ends_on, a.last_confirmed_at) > now(), true)
     AND private_sec.availability_post_visible(a.user_id)
   ORDER BY (a.id = _availability) DESC NULLS LAST, a.created_at DESC
   LIMIT 1;
  _mode := COALESCE(public.privacy_text(_invitee, 'allow_invites'), 'everyone');
  _block := public.minor_messaging_block(_me, _invitee);
  IF _block LIKE '%:self' THEN
    RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED:%', _block USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _post IS NULL
     OR _mode = 'nobody'
     OR (_mode = 'shared' AND NOT public.shares_game_or_chat(_me, _invitee))
     OR _block IS NOT NULL
     OR (private_sec.is_minor(_invitee) AND NOT private_sec.child_game_participation_allowed(_invitee))
     OR NOT COALESCE(private_sec.game_age_fits(_game, _invitee), false) THEN
    RAISE EXCEPTION 'INVITE_NOT_AVAILABLE: this player can''t be invited to this game.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (SELECT 1 FROM public.game_invites
              WHERE game_id = _game AND invitee_id = _invitee AND status = 'declined'
                AND responded_at > now() - interval '7 days') THEN
    RAISE EXCEPTION 'INVITE_DECLINED_RECENTLY: this player declined an invitation to this game in the last 7 days.';
  END IF;
  IF (SELECT count(*) FROM public.game_invites WHERE game_id = _game AND status = 'pending') >= 50 THEN
    RAISE EXCEPTION 'INVITE_LIMIT: a game can have at most 50 invitations waiting for an answer.';
  END IF;
  IF (SELECT count(*) FROM public.game_invites WHERE host_id = _me AND created_at > now() - interval '1 day') >= 100 THEN
    RAISE EXCEPTION 'INVITE_LIMIT: at most 100 invitations a day.';
  END IF;

  INSERT INTO public.game_invites (game_id, host_id, invitee_id, availability_id, message)
  VALUES (_game, _me, _invitee, _post, _msg)
  RETURNING id INTO _id;

  _when := private_sec.game_invite_when(_game);
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_invitee, 'game_invite', left('You''re invited to ' || _g.title, 200), _when,
          '/games/' || _game || '?invite=1&from=' || _me || '&inv=' || _id
            || '&exp=' || floor(extract(epoch FROM _g.date) * 1000)::bigint);
  IF private_sec.is_minor(_invitee) THEN
    PERFORM public.notify_guardians(_invitee, 'game_invite', 'Game invitation for your player',
                                    left(_g.title || ' · ' || COALESCE(_when, ''), 300), '/parent');
  END IF;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.game_invite_player(text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.game_invite_player(text, uuid, uuid, text) TO authenticated;

-- 4. Invite several -------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_invite_players(_game text, _invitees uuid[], _message text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _u       uuid;
  _invited integer := 0;
  _code    text;
  _skipped jsonb := '{}'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF COALESCE(array_length(_invitees, 1), 0) > 30 THEN RAISE EXCEPTION 'INVITE_LIMIT: at most 30 players at once.'; END IF;
  FOREACH _u IN ARRAY COALESCE(_invitees, '{}'::uuid[]) LOOP
    BEGIN
      PERFORM public.game_invite_player(_game, _u, NULL, _message);
      _invited := _invited + 1;
    EXCEPTION WHEN OTHERS THEN
      _code := split_part(SQLERRM, ':', 1);
      IF _code IN ('NOT_GAME_HOST', 'GAME_NOT_OPEN', 'AUTH_REQUIRED') THEN RAISE; END IF;
      _skipped := jsonb_set(_skipped, ARRAY[_code], to_jsonb(COALESCE((_skipped ->> _code)::int, 0) + 1));
    END;
  END LOOP;
  RETURN jsonb_build_object('invited', _invited, 'skipped', _skipped);
END $$;
REVOKE ALL ON FUNCTION public.game_invite_players(text, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.game_invite_players(text, uuid[], text) TO authenticated;

-- 5. Answer ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_respond_invite(_invite uuid, _accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _me   uuid := auth.uid();
  _i    record;
  _g    record;
  _jr   record;
  _jrid uuid;
  _name text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  SELECT * INTO _i FROM public.game_invites WHERE id = _invite AND invitee_id = _me FOR UPDATE;
  IF _i.id IS NULL THEN RAISE EXCEPTION 'INVITE_NOT_FOUND'; END IF;
  IF _i.status <> 'pending' THEN RETURN jsonb_build_object('status', _i.status, 'join_request_id', _i.join_request_id); END IF;

  IF NOT _accept THEN
    UPDATE public.game_invites SET status = 'declined', responded_at = now(), updated_at = now() WHERE id = _invite;
    RETURN jsonb_build_object('status', 'declined');
  END IF;

  SELECT id, host_id, title, max_players INTO _g FROM public.hosted_games WHERE id = _i.game_id FOR NO KEY UPDATE;
  IF NOT private_sec.game_open_for_invites(_i.game_id) OR _g.host_id IS DISTINCT FROM _i.host_id THEN
    UPDATE public.game_invites SET status = 'expired', responded_at = now(), updated_at = now() WHERE id = _invite;
    RETURN jsonb_build_object('status', 'expired');
  END IF;
  IF (SELECT count(*) FROM public.game_participants p WHERE p.game_id = _i.game_id) >= _g.max_players THEN
    RETURN jsonb_build_object('status', 'full');
  END IF;
  IF NOT COALESCE(private_sec.game_age_fits(_i.game_id, _me), false) THEN
    RAISE EXCEPTION 'INVITE_NOT_AVAILABLE: this invitation can''t be accepted.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The place request: created as the player (every insert check applies), then approved, as the host would.
  SELECT id, status INTO _jr FROM public.join_requests WHERE game_id = _i.game_id AND player_id = _me FOR UPDATE;
  IF _jr.id IS NULL THEN
    INSERT INTO public.join_requests (game_id, host_id, player_id, message, idempotency_key)
    VALUES (_i.game_id, _g.host_id, _me, 'Accepted the host''s invitation', 'invite:' || _invite)
    RETURNING id INTO _jrid;
  ELSE
    _jrid := _jr.id;
  END IF;
  UPDATE public.join_requests
     SET status = 'approved', reviewed_at = now(), reviewer_notes = 'Invited by the host'
   WHERE id = _jrid AND status <> 'approved';

  UPDATE public.game_invites
     SET status = 'accepted', responded_at = now(), updated_at = now(), join_request_id = _jrid
   WHERE id = _invite;

  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'A player') INTO _name FROM public.profiles p WHERE p.id = _me;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_g.host_id, 'game_invite_accepted', left(COALESCE(_name, 'A player') || ' accepted your invitation', 200),
          left(_g.title, 300), '/games/' || _i.game_id);
  RETURN jsonb_build_object('status', 'accepted', 'join_request_id', _jrid);
END $$;
REVOKE ALL ON FUNCTION public.game_respond_invite(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.game_respond_invite(uuid, boolean) TO authenticated;

-- 6. Withdraw ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_cancel_invite(_invite uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _me uuid := auth.uid();
  _n  integer;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  UPDATE public.game_invites i
     SET status = 'cancelled', updated_at = now()
   WHERE i.id = _invite AND i.status = 'pending'
     AND (i.host_id = _me OR EXISTS (SELECT 1 FROM public.hosted_games g WHERE g.id = i.game_id AND g.host_id = _me));
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n = 0 THEN RAISE EXCEPTION 'INVITE_NOT_FOUND'; END IF;
  RETURN 'cancelled';
END $$;
REVOKE ALL ON FUNCTION public.game_cancel_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.game_cancel_invite(uuid) TO authenticated;

-- 7. A private game, for the player invited to it --------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Private games viewable by invitees" ON public.hosted_games;
CREATE POLICY "Private games viewable by invitees" ON public.hosted_games
  FOR SELECT TO authenticated
  USING (is_private = true AND private_sec.has_game_invite(id, auth.uid()));

-- 8. The old path: a contact request of kind 'invite' -----------------------------------------------------------------------------
-- 20260630201356's definition, with two changes: an invitation must name an open game the sender hosts, and its details are
-- taken from the game; on UPDATE the message and the game details are fixed too.
CREATE OR REPLACE FUNCTION public.validate_availability_contact_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _owner uuid;
  _g record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Must be signed in.' USING ERRCODE = '28000';
    END IF;
    IF NEW.from_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'from_user_id must match the signed-in user.' USING ERRCODE = '42501';
    END IF;
    IF NEW.from_user_id = NEW.to_user_id THEN
      RAISE EXCEPTION 'Cannot contact yourself.';
    END IF;
    SELECT user_id INTO _owner FROM public.player_availabilities
      WHERE id = NEW.availability_id;
    IF _owner IS NULL OR _owner <> NEW.to_user_id THEN
      RAISE EXCEPTION 'to_user_id does not match the availability owner.' USING ERRCODE = '42501';
    END IF;
    IF NEW.message IS NOT NULL AND length(NEW.message) > 500 THEN
      RAISE EXCEPTION 'Message too long (max 500 characters).';
    END IF;
    IF NEW.kind IS NULL OR NEW.kind NOT IN ('contact','invite') THEN
      RAISE EXCEPTION 'Invalid kind: %', NEW.kind;
    END IF;
    IF NEW.kind = 'invite' THEN
      IF NEW.game_id IS NULL OR length(NEW.game_id) = 0 THEN
        RAISE EXCEPTION 'game_id required for invites.';
      END IF;
      SELECT id, host_id, title, date, sport, location INTO _g FROM public.hosted_games WHERE id = NEW.game_id;
      IF _g.id IS NULL OR _g.host_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'NOT_GAME_HOST: only the game''s host can invite players to it.' USING ERRCODE = '42501';
      END IF;
      IF NOT private_sec.game_open_for_invites(NEW.game_id) THEN
        RAISE EXCEPTION 'GAME_NOT_OPEN: this game is not taking players now.';
      END IF;
      NEW.game_title := left(_g.title, 200);
      NEW.game_starts_at := _g.date;
      NEW.game_sport := left(_g.sport, 60);
      NEW.game_location := left(_g.location, 300);
    ELSE
      NEW.game_id := NULL;
      NEW.game_title := NULL;
      NEW.game_starts_at := NULL;
      NEW.game_sport := NULL;
      NEW.game_location := NULL;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.from_user_id <> OLD.from_user_id
       OR NEW.to_user_id <> OLD.to_user_id
       OR NEW.availability_id <> OLD.availability_id
       OR NEW.kind <> OLD.kind
       OR COALESCE(NEW.game_id,'') <> COALESCE(OLD.game_id,'') THEN
      RAISE EXCEPTION 'Identity fields are immutable.' USING ERRCODE = '42501';
    END IF;
    IF NEW.message IS DISTINCT FROM OLD.message
       OR NEW.game_title IS DISTINCT FROM OLD.game_title
       OR NEW.game_starts_at IS DISTINCT FROM OLD.game_starts_at
       OR NEW.game_sport IS DISTINCT FROM OLD.game_sport
       OR NEW.game_location IS DISTINCT FROM OLD.game_location THEN
      RAISE EXCEPTION 'The message and game details of a request cannot be changed.' USING ERRCODE = '42501';
    END IF;
    IF NEW.status NOT IN ('pending','accepted','declined','withdrawn') THEN
      RAISE EXCEPTION 'Invalid status: %', NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
