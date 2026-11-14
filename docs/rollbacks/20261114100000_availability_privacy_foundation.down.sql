-- ROLLBACK for supabase/migrations/20261114100000_availability_privacy_foundation.sql (WP 1.0).
-- NOT a migration. It reopens what the migration closed:
--   * every signed-in account can again read every open availability post, including posts by minors (schedule, city, note) and posts
--     BallaCity hid, by suspended or banned authors, or by someone who blocked the reader;
--   * contact requests and game invitations can again be sent to a minor through a post without the minor-messaging rules, to a post the
--     sender cannot read, and the block guard again answers about pairs of people the caller is not part of;
--   * a minor's new post may again store coordinates, a street address and a note naming a place;
--   * an author can again unhide a post BallaCity hid and reopen one BallaCity or a guardian's revocation closed.
-- It puts back the read policy "Open availabilities visible to authenticated users" exactly as 20260715040319 created it, drops the three
-- triggers and their functions, the visibility helper and the three legacy-data procedures.
-- It KEEPS, on purpose (each is a fix with no privacy cost, and undoing it brings back a failure):
--   * validate_player_availability accepting 'inactive' (without it revoke_parental_consent fails for a child with a post, and any row
--     already set 'inactive' could no longer be edited);
--   * guard_participant_self_update reading public.hosted_games (without it a player cannot change their own position);
--   * private_sec.can_see_minor_name, private_sec.text_discloses_location and private_sec.location_tokens (service role only; the PRIV
--     stack defines them too).
-- No row is written. Posts the migration stripped of coordinates or a note stay stripped.
-- The app change that shipped with the migration (createContactRequest shows the neutral line for MINOR_MESSAGING_BLOCKED) works either way.
-- It stops, changing nothing, if a function or the policy no longer has the definition the migration gave it (md5 of pg_get_functiondef /
-- of the policy expression): a later change needs a person to look first.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_availability_privacy_foundation_rollback = 'yes';
--     (or PGOPTIONS="-c app.confirm_availability_privacy_foundation_rollback=yes")
BEGIN;
DO $guard$
DECLARE
  _want jsonb := '{"private_sec.availability_post_visible(uuid)": "86315c34bfe5784ef57ef58dd39269c4", "public.guard_minor_availability_write()": "1e32774c53ff16db6ce6e290dde21d94", "public.guard_contact_request_minor_recipient()": "bc300b0f90ac86bacb2b433a40cab83e", "public.guard_availability_moderation_fields()": "459c8b306675644b0f9b5eb504951d59", "private_sec.blank_minor_availability_location(integer)": "6256bcdf45d38fc327baf4f8fbd3f5ff", "public.list_minor_availability_notes_with_location_text()": "16bed1cd3e9a76bbacbc45f4d36366b4", "public.moderator_scrub_availability_note(uuid,text)": "1f459fab82cb7c22c28fce253987577b"}'::jsonb;
  _k text;
  _got text;
BEGIN
  IF current_setting('app.confirm_availability_privacy_foundation_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this lets every signed-in account list minors'' availability posts (schedule, city, note) again and reach them through contact requests. Set app.confirm_availability_privacy_foundation_rollback=yes for the session to proceed deliberately.';
  END IF;
  FOR _k IN SELECT jsonb_object_keys(_want) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure(_k);
    IF _got IS DISTINCT FROM _want ->> _k THEN
      RAISE EXCEPTION 'Refusing to run: % is not the definition 20261114100000 created (md5 %, expected %). A later change needs a person to look first.', _k, _got, _want ->> _k;
    END IF;
  END LOOP;
  SELECT md5(pg_get_expr(polqual, polrelid)) INTO _got FROM pg_policy
   WHERE polrelid = 'public.player_availabilities'::regclass AND polname = 'Availability visible to permitted viewers';
  IF _got IS DISTINCT FROM 'f8d6eebe9fc2385f0ac27de4f9e53a4f' THEN
    RAISE EXCEPTION 'Refusing to run: the read policy is not the one 20261114100000 created (md5 %). A later change needs a person to look first.', _got;
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';

DROP POLICY "Availability visible to permitted viewers" ON public.player_availabilities;
CREATE POLICY "Open availabilities visible to authenticated users"
ON public.player_availabilities
FOR SELECT
TO authenticated
USING (status = 'open' OR user_id = auth.uid());

DROP TRIGGER zz_guard_minor_availability_write_trg ON public.player_availabilities;
DROP TRIGGER a1_guard_availability_moderation_fields_trg ON public.player_availabilities;
DROP TRIGGER a1_guard_contact_request_minor_recipient_trg ON public.availability_contact_requests;
DROP FUNCTION public.guard_minor_availability_write();
DROP FUNCTION public.guard_availability_moderation_fields();
DROP FUNCTION public.guard_contact_request_minor_recipient();
DROP FUNCTION private_sec.availability_post_visible(uuid);
DROP FUNCTION private_sec.blank_minor_availability_location(integer);
DROP FUNCTION public.list_minor_availability_notes_with_location_text();
DROP FUNCTION public.moderator_scrub_availability_note(uuid, text);

COMMIT;
