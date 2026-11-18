-- ROLLBACK for supabase/migrations/20261119100000_game_invites.sql (WP 2.0).
-- NOT a migration. It removes server-side game invitations: the game_invites table and every invitation in it, the functions
-- game_invite_player, game_invite_players, game_respond_invite and game_cancel_invite and their private_sec helpers, and the
-- read rule that lets an invitee open a private game. It restores validate_availability_contact_request as 20260630201356
-- defined it, which REOPENS the gap the migration closed: an old-style invitation (availability_contact_requests, kind
-- 'invite') can again name any game, and its game details are again whatever the sender's app sends.
-- Join requests that accepted invitations created stay, approved; places taken stay.
-- It stops, changing nothing, if a function no longer has the definition 20261119100000 gave it, and refuses to run unless the
-- session sets the confirmation first; with invitations stored it also needs the second setting:
--     SET app.confirm_game_invites_rollback = 'yes';
--     SET app.confirm_game_invites_drop_rows = 'yes';   -- only when game_invites has rows
BEGIN;
DO $guard$
DECLARE
  _want jsonb := '{
    "public.game_invite_player(text,uuid,uuid,text)": "e7de3208fa391e549f34a95f962c71cd",
    "public.game_invite_players(text,uuid[],text)": "d23b883c899f6c4b6bbe37152eb17dd2",
    "public.game_respond_invite(uuid,boolean)": "2e6ba1b0a026a1366c6687462088d261",
    "public.game_cancel_invite(uuid)": "e41653bd2263b02cbc44b406d59010a5",
    "private_sec.game_open_for_invites(text)": "4afdb22c5a96c90aa84d32bc5f0c0e86",
    "private_sec.game_age_fits(text,uuid)": "007c88f7b02d3847703309941fd07d62",
    "private_sec.has_game_invite(text,uuid)": "61a20f006b31b4da900eb13a665bbde6",
    "private_sec.game_invite_when(text)": "210b0753a3f96b26b7fe3c8d3ce53cad",
    "public.validate_availability_contact_request()": "4a27831fbced9f96b800bd5f5e9a33b3"
  }'::jsonb;
  _k text;
  _got text;
  _rows bigint;
BEGIN
  IF current_setting('app.confirm_game_invites_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this removes game invitations and reopens old-style invitation forgery. Set app.confirm_game_invites_rollback=yes for the session to proceed deliberately.';
  END IF;
  FOR _k IN SELECT jsonb_object_keys(_want) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure(_k);
    IF _got IS DISTINCT FROM _want ->> _k THEN
      RAISE EXCEPTION 'Refusing to run: % is not the definition 20261119100000 created (md5 %, expected %). A later change needs a person to look first.', _k, _got, _want ->> _k;
    END IF;
  END LOOP;
  SELECT count(*) INTO _rows FROM public.game_invites;
  IF _rows > 0 AND current_setting('app.confirm_game_invites_drop_rows', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: game_invites holds % invitation(s), which would be deleted. Set app.confirm_game_invites_drop_rows=yes as well.', _rows;
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS "Private games viewable by invitees" ON public.hosted_games;
DROP FUNCTION public.game_invite_players(text, uuid[], text);
DROP FUNCTION public.game_invite_player(text, uuid, uuid, text);
DROP FUNCTION public.game_respond_invite(uuid, boolean);
DROP FUNCTION public.game_cancel_invite(uuid);
DROP TABLE public.game_invites;
DROP FUNCTION private_sec.has_game_invite(text, uuid);
DROP FUNCTION private_sec.game_invite_when(text);
DROP FUNCTION private_sec.game_age_fits(text, uuid);

-- validate_availability_contact_request as 20260630201356 defined it (it no longer calls game_open_for_invites).
CREATE OR REPLACE FUNCTION public.validate_availability_contact_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _owner uuid;
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
    IF NEW.kind = 'invite' AND (NEW.game_id IS NULL OR length(NEW.game_id) = 0) THEN
      RAISE EXCEPTION 'game_id required for invites.';
    END IF;
    IF NEW.game_id IS NOT NULL AND length(NEW.game_id) > 120 THEN
      RAISE EXCEPTION 'game_id too long.';
    END IF;
    IF NEW.game_title IS NOT NULL AND length(NEW.game_title) > 200 THEN
      RAISE EXCEPTION 'game_title too long.';
    END IF;
    IF NEW.game_location IS NOT NULL AND length(NEW.game_location) > 300 THEN
      RAISE EXCEPTION 'game_location too long.';
    END IF;
    IF NEW.game_sport IS NOT NULL AND length(NEW.game_sport) > 60 THEN
      RAISE EXCEPTION 'game_sport too long.';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.from_user_id <> OLD.from_user_id
       OR NEW.to_user_id <> OLD.to_user_id
       OR NEW.availability_id <> OLD.availability_id
       OR NEW.kind <> OLD.kind
       OR COALESCE(NEW.game_id,'') <> COALESCE(OLD.game_id,'') THEN
      RAISE EXCEPTION 'Identity fields are immutable.' USING ERRCODE = '42501';
    END IF;
    IF NEW.status NOT IN ('pending','accepted','declined','withdrawn') THEN
      RAISE EXCEPTION 'Invalid status: %', NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP FUNCTION private_sec.game_open_for_invites(text);

COMMIT;
