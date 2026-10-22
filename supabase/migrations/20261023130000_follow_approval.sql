-- Private accounts: following can require the account owner's approval.
--
-- `follows` keeps meaning "approved followers", so everything that reads it (counts,
-- lists, feeds) is unchanged. A follow that needs approval waits in `follow_requests`
-- until it is approved (it moves into `follows`) or declined (it is deleted).
--
-- Who needs to approve:
--   * An adult, if they turn on `privacy_preferences.require_follow_approval`.
--   * Every minor (under 13, 13-15, 16-17), always. The setting is forced on by
--     enforce_minor_privacy_floor and by follow_approval_required(), so a minor
--     cannot turn it off.
-- Who may answer a request for an account (can_manage_followers):
--   * The account itself, unless it is under 16.
--   * A verified guardian, for any minor. Under 16, ONLY a guardian: the child cannot
--     approve their own followers.
--
-- Everything is decided here, not in the app. Nobody can write `follows` or
-- `follow_requests` directly any more: following, answering a request, removing a
-- follower and withdrawing a request are the functions below, each of which checks
-- who is calling.
--
-- Existing followers of a minor are moved back to pending requests, so a guardian
-- reviews each one. Existing followers of adults are untouched.

-- 1. The setting, forced on for every minor ------------------------------------------

ALTER TABLE public.privacy_preferences
  ADD COLUMN IF NOT EXISTS require_follow_approval boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.enforce_minor_privacy_floor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cohort text;
BEGIN
  cohort := public.age_cohort_of(NEW.user_id);
  IF cohort IN ('child_under_13','teen_13_15','teen_16_17') THEN
    IF NEW.location_precision = 'exact' THEN NEW.location_precision := 'city'; END IF;
    IF NEW.profile_visibility = 'public' THEN NEW.profile_visibility := 'members'; END IF;
    NEW.require_follow_approval := true;
  END IF;
  IF cohort = 'child_under_13' THEN
    NEW.profile_visibility := 'private';
    NEW.marketing_emails := false;
    NEW.ai_training_opt_in := false;
  END IF;
  RETURN NEW;
END $$;

-- Re-run the floor over every existing minor's row.
UPDATE public.privacy_preferences
SET require_follow_approval = true
WHERE public.age_cohort_of(user_id) IN ('child_under_13','teen_13_15','teen_16_17');

-- 2. Pending requests -----------------------------------------------------------------

CREATE TABLE public.follow_requests (
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, target_id),
  CHECK (requester_id <> target_id)
);

CREATE INDEX follow_requests_target_idx ON public.follow_requests (target_id, created_at DESC);

ALTER TABLE public.follow_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.follow_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.follow_requests TO authenticated;
GRANT ALL ON public.follow_requests TO service_role;

-- A request is visible to the person who sent it, the account it is for, and that
-- account's verified guardian. Nobody else, and nobody writes it directly.
CREATE POLICY follow_requests_parties_read ON public.follow_requests
  FOR SELECT TO authenticated
  USING (
    requester_id = auth.uid()
    OR target_id = auth.uid()
    OR public.is_guardian_of(auth.uid(), target_id)
  );

-- 3. Following goes through the functions below, never a direct insert ---------------

REVOKE INSERT, UPDATE ON public.follows FROM PUBLIC, anon, authenticated;

-- 4. The rules ------------------------------------------------------------------------

-- Whether following this account needs approval. Internal: callers learn it only by
-- trying to follow (request_follow), which is how a private account behaves anywhere.
CREATE OR REPLACE FUNCTION public.follow_approval_required(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.age_cohort_of(_user) IN ('child_under_13','teen_13_15','teen_16_17')
      OR COALESCE(
           (SELECT pp.require_follow_approval FROM public.privacy_preferences pp WHERE pp.user_id = _user),
           false);
$$;

-- Who may approve, decline or remove followers for `_target`.
CREATE OR REPLACE FUNCTION public.can_manage_followers(_actor uuid, _target uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _actor IS NOT NULL AND _target IS NOT NULL AND (
    (_actor = _target AND public.age_cohort_of(_target) NOT IN ('child_under_13','teen_13_15'))
    OR public.is_guardian_of(_actor, _target)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.follow_approval_required(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.can_manage_followers(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.follow_approval_required(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_followers(uuid, uuid) TO service_role;

-- 5. Following, requesting, answering, removing, withdrawing -----------------------

-- Follow an account, or ask to when it needs approval. Returns 'following' or 'requested'.
CREATE OR REPLACE FUNCTION public.request_follow(_target uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
END $$;

-- Approve or decline a request for `_target`. A guardian's answer is written to the
-- family audit log.
CREATE OR REPLACE FUNCTION public.respond_follow_request(_requester uuid, _target uuid, _approve boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE me uuid := auth.uid();
        removed integer;
BEGIN
  IF NOT public.can_manage_followers(me, _target) THEN
    RAISE EXCEPTION 'FOLLOW_NOT_ALLOWED';
  END IF;

  DELETE FROM public.follow_requests WHERE requester_id = _requester AND target_id = _target;
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed = 0 THEN
    RAISE EXCEPTION 'NO_SUCH_FOLLOW_REQUEST';
  END IF;

  IF _approve THEN
    INSERT INTO public.follows (follower_id, followee_id)
    VALUES (_requester, _target)
    ON CONFLICT DO NOTHING;
  END IF;

  IF me <> _target THEN
    INSERT INTO public.family_audit_log (actor_user_id, child_user_id, action, context)
    VALUES (me, _target,
            CASE WHEN _approve THEN 'follow_request.approved' ELSE 'follow_request.declined' END,
            jsonb_build_object('requester_id', _requester));
  END IF;
  RETURN CASE WHEN _approve THEN 'approved' ELSE 'declined' END;
END $$;

-- Remove someone who follows `_target`, and any request they still have open.
CREATE OR REPLACE FUNCTION public.remove_follower(_target uuid, _follower uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE me uuid := auth.uid();
        removed integer;
BEGIN
  IF NOT public.can_manage_followers(me, _target) THEN
    RAISE EXCEPTION 'FOLLOW_NOT_ALLOWED';
  END IF;
  DELETE FROM public.follows WHERE follower_id = _follower AND followee_id = _target;
  GET DIAGNOSTICS removed = ROW_COUNT;
  DELETE FROM public.follow_requests WHERE requester_id = _follower AND target_id = _target;
  IF removed > 0 AND me <> _target THEN
    INSERT INTO public.family_audit_log (actor_user_id, child_user_id, action, context)
    VALUES (me, _target, 'follower.removed', jsonb_build_object('follower_id', _follower));
  END IF;
  RETURN removed > 0;
END $$;

-- Withdraw your own request.
CREATE OR REPLACE FUNCTION public.cancel_follow_request(_target uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE removed integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN';
  END IF;
  DELETE FROM public.follow_requests WHERE requester_id = auth.uid() AND target_id = _target;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed > 0;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'request_follow(uuid)',
    'respond_follow_request(uuid, uuid, boolean)',
    'remove_follower(uuid, uuid)',
    'cancel_follow_request(uuid)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- 6. Turning approval off lets everyone who is waiting in ------------------------------

CREATE OR REPLACE FUNCTION public.accept_pending_when_public()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Minors never reach here with the setting off: the floor forces it back on.
  IF NOT public.follow_approval_required(NEW.user_id) THEN
    INSERT INTO public.follows (follower_id, followee_id, created_at)
    SELECT requester_id, target_id, now()
    FROM public.follow_requests WHERE target_id = NEW.user_id
    ON CONFLICT DO NOTHING;
    DELETE FROM public.follow_requests WHERE target_id = NEW.user_id;
  END IF;
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION public.accept_pending_when_public() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_accept_pending_when_public ON public.privacy_preferences;
CREATE TRIGGER trg_accept_pending_when_public
AFTER UPDATE OF require_follow_approval ON public.privacy_preferences
FOR EACH ROW
WHEN (OLD.require_follow_approval AND NOT NEW.require_follow_approval)
EXECUTE FUNCTION public.accept_pending_when_public();

-- 7. One-time reset: existing followers of a minor wait for a guardian's approval ------

WITH moved AS (
  DELETE FROM public.follows f
  WHERE public.age_cohort_of(f.followee_id) IN ('child_under_13','teen_13_15','teen_16_17')
  RETURNING f.follower_id, f.followee_id, f.created_at
)
INSERT INTO public.follow_requests (requester_id, target_id, created_at)
SELECT follower_id, followee_id, created_at FROM moved
ON CONFLICT DO NOTHING;
