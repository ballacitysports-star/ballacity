-- ROLLBACK for supabase/migrations/20261106170000_follow_requests_respect_blocks.sql (P1-7).
-- NOT a migration. Restores request_follow without the block check, the block cleanup without request removal, and
-- removes the follow-request notification. A blocked person can then file follow requests again. Guarded:
--     PGOPTIONS="-c app.confirm_reopen_follow_request_blocks=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_reopen_follow_request_blocks', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this rollback lets a blocked person file follow requests again. Set app.confirm_reopen_follow_request_blocks=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;
DROP TRIGGER IF EXISTS after_insert_follow_request ON public.follow_requests;
DROP FUNCTION IF EXISTS public.notify_on_follow_request();
CREATE OR REPLACE FUNCTION public.remove_follows_on_block()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.follows
  WHERE (follower_id = NEW.blocker_id AND followee_id = NEW.blocked_id)
     OR (follower_id = NEW.blocked_id AND followee_id = NEW.blocker_id);
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.request_follow(_target uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN';
  END IF;
  IF _target IS NULL OR _target = me
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _target) THEN
    RAISE EXCEPTION 'INVALID_FOLLOW_TARGET';
  END IF;
  IF public.child_features_locked(me) THEN
    RAISE EXCEPTION 'FOLLOW_LOCKED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.follows WHERE follower_id = me AND followee_id = _target) THEN
    RETURN 'following';
  END IF;
  IF public.follow_approval_required(_target) THEN
    INSERT INTO public.follow_requests (requester_id, target_id)
    VALUES (me, _target)
    ON CONFLICT DO NOTHING;
    RETURN 'requested';
  END IF;
  INSERT INTO public.follows (follower_id, followee_id)
  VALUES (me, _target)
  ON CONFLICT DO NOTHING;
  RETURN 'following';
END $function$;
COMMIT;
