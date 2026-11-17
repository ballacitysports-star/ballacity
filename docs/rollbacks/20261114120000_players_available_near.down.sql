-- ROLLBACK for supabase/migrations/20261114120000_players_available_near.sql (WP 1.3).
-- NOT a migration. It removes the server-side "players available near me" search and its helpers. It reopens nothing: the search
-- only ever returned rows the table's read policy already allowed. An app that calls listPlayersAvailableNear gets an error after
-- this (the Players tab does not call it yet). Coordinates the app saved with posts stay, under the same location-privacy rules.
-- It drops public.players_available_near, private_sec.availability_windows, private_sec.availability_tiers, private_sec.safe_timezone
-- and the index player_availabilities_open_lat_lng_idx. No row is written.
-- It stops, changing nothing, if a function no longer has the definition 20261114120000 gave it (a later change needs a person to look
-- first), and refuses to run unless the session sets the confirmation first:
--     SET app.confirm_players_available_near_rollback = 'yes';
BEGIN;
DO $guard$
DECLARE
  _want jsonb := '{"public.players_available_near(double precision,double precision,double precision,text,timestamptz,timestamptz,text,text[],boolean,text,integer,integer)": "2c7d65f2ca559f5b624db437dd9614d7", "private_sec.availability_windows(jsonb,text,date,date,timestamptz,timestamptz)": "2d405f6038947168aa462db1c2c72d70", "private_sec.availability_tiers(jsonb,text,text[],text)": "30f5ae3528e03848e69e6c8e06d6437b", "private_sec.safe_timezone(text)": "8ea44fd520f780426ca6a21e05a96b7c"}'::jsonb;
  _k text;
  _got text;
BEGIN
  IF current_setting('app.confirm_players_available_near_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this removes the Find Players search. Set app.confirm_players_available_near_rollback=yes for the session to proceed deliberately.';
  END IF;
  FOR _k IN SELECT jsonb_object_keys(_want) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure(_k);
    IF _got IS DISTINCT FROM _want ->> _k THEN
      RAISE EXCEPTION 'Refusing to run: % is not the definition 20261114120000 created (md5 %, expected %). A later change needs a person to look first.', _k, _got, _want ->> _k;
    END IF;
  END LOOP;
END
$guard$;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION public.players_available_near(double precision, double precision, double precision, text, timestamptz, timestamptz, text, text[], boolean, text, integer, integer);
DROP FUNCTION private_sec.availability_windows(jsonb, text, date, date, timestamptz, timestamptz);
DROP FUNCTION private_sec.availability_tiers(jsonb, text, text[], text);
DROP FUNCTION private_sec.safe_timezone(text);
DROP INDEX public.player_availabilities_open_lat_lng_idx;

COMMIT;
