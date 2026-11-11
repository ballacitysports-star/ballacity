-- P1-7 (Phase 0 audit, 2026-11-06): follow requests respect blocks, and someone is told when a request arrives.
--
-- 1. request_follow never looked at user_blocks. The block guard (prevent_follow_when_blocked) sits on follows
--    only, so when the target needs approval a blocked person could keep filing follow requests that the person who
--    blocked them would see in their requests list. request_follow now refuses when a block exists in either
--    direction, before anything is written. The error is FOLLOW_BLOCKED; the app shows the same neutral "That
--    account isn't available" it shows for a missing account, so the blocked person is not told about the block.
--
-- 2. Blocking removed follows between the two people but left pending follow requests in place. The block cleanup
--    now removes requests in both directions as well.
--
-- 3. A new follow request created no notification, so it waited unseen until someone opened the requests list.
--    The person who can answer it is now told: the account itself when it manages its own followers (adults and
--    16-17 year olds, see can_manage_followers), otherwise the minor's verified guardians and managing guardian
--    (notify_guardians_of). A repeated request that inserts nothing notifies nobody.
--
-- No row is changed. Grants on request_follow are unchanged (authenticated and service role).
-- ROLLBACK: docs/rollbacks/20261106170000_follow_requests_respect_blocks.down.sql. TEST: supabase/tests/520_follow_request_blocks.test.sql.

SET lock_timeout = '5s';

-- ============================================================ 1. no requests across a block
CREATE OR REPLACE FUNCTION public.request_follow(_target uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  IF public.blocks_exist_between(me, _target) THEN
    RAISE EXCEPTION 'FOLLOW_BLOCKED';
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

-- ============================================================ 2. a block also clears pending requests
CREATE OR REPLACE FUNCTION public.remove_follows_on_block()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.follows
  WHERE (follower_id = NEW.blocker_id AND followee_id = NEW.blocked_id)
     OR (follower_id = NEW.blocked_id AND followee_id = NEW.blocker_id);
  DELETE FROM public.follow_requests
  WHERE (requester_id = NEW.blocker_id AND target_id = NEW.blocked_id)
     OR (requester_id = NEW.blocked_id AND target_id = NEW.blocker_id);
  RETURN NEW;
END;
$function$;

-- ============================================================ 3. tell whoever can answer
CREATE OR REPLACE FUNCTION public.notify_on_follow_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _requester text;
  _target text;
BEGIN
  SELECT COALESCE(display_name, 'Someone') INTO _requester FROM public.profiles WHERE id = NEW.requester_id;
  _requester := COALESCE(_requester, 'Someone');

  IF public.can_manage_followers(NEW.target_id, NEW.target_id) THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (NEW.target_id, 'follow_request', _requester || ' asked to follow you', NULL, '/account/follow-requests');
  ELSE
    SELECT COALESCE(display_name, 'your child') INTO _target FROM public.profiles WHERE id = NEW.target_id;
    PERFORM public.notify_guardians_of(
      NEW.target_id,
      'follow_request',
      _requester || ' asked to follow ' || COALESCE(_target, 'your child'),
      'You approve or decline it in the Parent Center.',
      '/parent'
    );
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_on_follow_request() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_on_follow_request() TO service_role;

DROP TRIGGER IF EXISTS after_insert_follow_request ON public.follow_requests;
CREATE TRIGGER after_insert_follow_request
AFTER INSERT ON public.follow_requests
FOR EACH ROW EXECUTE FUNCTION public.notify_on_follow_request();
