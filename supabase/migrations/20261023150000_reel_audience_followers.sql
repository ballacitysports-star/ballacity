-- Who can watch a posted reel now follows the account, Instagram-style, with age floors.
--
-- Every account has a reel audience (privacy_preferences.reel_audience):
--   public     anyone, signed in or not, and the public Highlights feed
--   followers  only people the account has approved as followers
--   private    only the account itself
--
--   18+        chooses any of the three. Existing accounts stay 'public'.
--   16-17      never public. Defaults to 'private'; may choose 'followers'. An adult
--              follower must also share a team with them, and their verified guardian
--              can always watch.
--   13-15      locked to 'private'. Their reels follow the guardian and approved-team
--              rules in teen_reel_viewer_access(); nobody else, followers included.
--   under 13   locked to 'private'. Family only, as before.
--
-- This replaces the old 'members' audience, under which every signed-in user could
-- watch a 16-17 reel. Existing 16-17 accounts move to 'private'.
--
-- One function answers "may this person watch this reel?": reel_visible_to(). The
-- table's read policy, the feed readers and the comment and reaction policies all
-- call it, so the rule cannot differ between them. A viewer is refused if they are
-- under 13, locked, or suspended, whatever they follow.

-- 1. The setting, with the age floors ---------------------------------------------------

ALTER TABLE public.privacy_preferences
  ADD COLUMN IF NOT EXISTS reel_audience text NOT NULL DEFAULT 'public'
  CONSTRAINT privacy_preferences_reel_audience_check
  CHECK (reel_audience IN ('public','followers','private'));

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
  IF cohort IN ('child_under_13','teen_13_15') THEN
    NEW.reel_audience := 'private';
  END IF;
  IF cohort = 'teen_16_17' AND NEW.reel_audience = 'public' THEN
    NEW.reel_audience := 'private';
  END IF;
  IF cohort = 'child_under_13' THEN
    NEW.profile_visibility := 'private';
    NEW.marketing_emails := false;
    NEW.ai_training_opt_in := false;
  END IF;
  RETURN NEW;
END $$;

-- Apply the floors to every existing minor.
UPDATE public.privacy_preferences
SET reel_audience = 'private'
WHERE reel_audience <> 'private'
  AND public.age_cohort_of(user_id) IN ('child_under_13','teen_13_15');

UPDATE public.privacy_preferences
SET reel_audience = 'private'
WHERE reel_audience = 'public'
  AND public.age_cohort_of(user_id) = 'teen_16_17';

-- 2. The audience of a reel ----------------------------------------------------------------
-- 'public', 'followers', 'private' or 'none'. 'none' is a reel nobody gets through this
-- path at all: a draft, a hold, an unfinished reel, a family clip, or a child's reel.

CREATE OR REPLACE FUNCTION public.reel_audience(_reel_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT CASE
      WHEN r.hidden_at IS NOT NULL OR r.status <> 'completed' THEN 'none'
      WHEN r.is_draft THEN 'none'
      WHEN r.subject_child_id IS NOT NULL THEN 'none'
      WHEN public.age_cohort_of(r.user_id) = 'child_under_13' THEN 'none'
      WHEN public.child_features_locked(r.user_id) THEN 'none'
      WHEN public.age_cohort_of(r.user_id) = 'teen_13_15' THEN 'none'
      WHEN public.age_cohort_of(r.user_id) = 'teen_16_17'
        THEN CASE WHEN r.setting = 'followers' THEN 'followers' ELSE 'private' END
      ELSE r.setting
    END
    FROM (
      SELECT hr.hidden_at, hr.status, hr.is_draft, hr.subject_child_id, hr.user_id,
             COALESCE(pp.reel_audience, 'public') AS setting
      FROM public.highlight_reels hr
      LEFT JOIN public.privacy_preferences pp ON pp.user_id = hr.user_id
      WHERE hr.id = _reel_id
    ) r
  ), 'none');
$function$;

-- 3. May this person watch this reel? ---------------------------------------------------------
-- `_viewer` is NULL for a signed-out visitor. Internal: the readers below and the
-- policies call it; it is not exposed to the API roles.

CREATE OR REPLACE FUNCTION public.reel_visible_to(_reel_id uuid, _viewer uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  aud text := public.reel_audience(_reel_id);
  owner uuid;
  owner_cohort text;
  viewer_cohort text;
BEGIN
  IF aud = 'public' THEN
    RETURN true;
  END IF;
  IF aud NOT IN ('followers','private') OR _viewer IS NULL THEN
    RETURN false;
  END IF;

  SELECT user_id INTO owner FROM public.highlight_reels WHERE id = _reel_id;
  IF owner IS NULL THEN
    RETURN false;
  END IF;
  IF _viewer = owner THEN
    RETURN true;
  END IF;

  owner_cohort := public.age_cohort_of(owner);
  -- A minor's verified guardian can watch what the minor posts.
  IF owner_cohort = 'teen_16_17' AND public.is_guardian_of(_viewer, owner) THEN
    RETURN true;
  END IF;
  IF aud = 'private' THEN
    RETURN false;
  END IF;

  -- 'followers': an approved follower who is in good standing.
  viewer_cohort := public.age_cohort_of(_viewer);
  IF viewer_cohort = 'child_under_13'
     OR public.child_features_locked(_viewer)
     OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _viewer AND p.suspended_at IS NOT NULL) THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.follows f WHERE f.follower_id = _viewer AND f.followee_id = owner
  ) THEN
    RETURN false;
  END IF;

  -- An adult following a 16-17 account also needs a connection: a shared team.
  IF owner_cohort = 'teen_16_17'
     AND viewer_cohort NOT IN ('child_under_13','teen_13_15','teen_16_17')
     AND NOT public.shares_team(_viewer, owner) THEN
    RETURN false;
  END IF;
  RETURN true;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.reel_visible_to(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reel_visible_to(uuid, uuid) TO service_role;

-- 4. Direct reads of the table (the "Anyone can view visible completed reels" policy) --------

CREATE OR REPLACE FUNCTION private_sec.reel_publicly_visible(_reel_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.reel_visible_to(_reel_id, auth.uid());
$$;

-- 5. The Highlights feed, its sport chips, and a person's reel list ---------------------------
-- They now take the viewer, not a signed-in flag, so a follower sees what they follow.

DROP FUNCTION IF EXISTS public.public_reel_feed_ids(timestamptz, text, int, boolean);
DROP FUNCTION IF EXISTS public.public_reel_feed_sports(boolean);
DROP FUNCTION IF EXISTS public.public_user_reel_ids(uuid, int, boolean);

CREATE FUNCTION public.public_reel_feed_ids(
  _cursor timestamptz DEFAULT NULL,
  _sport text DEFAULT NULL,
  _limit int DEFAULT 8,
  _viewer uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, created_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT r.id, r.created_at
  FROM public.highlight_reels r
  WHERE r.status = 'completed'
    AND r.hidden_at IS NULL
    AND (_sport IS NULL OR r.ai_sport = _sport)
    AND (_cursor IS NULL OR r.created_at < _cursor)
    AND public.reel_visible_to(r.id, _viewer)
  ORDER BY r.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(_limit, 8), 1), 50);
$function$;

CREATE FUNCTION public.public_reel_feed_sports(_viewer uuid DEFAULT NULL)
RETURNS TABLE (sport text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT DISTINCT r.ai_sport
  FROM public.highlight_reels r
  WHERE r.status = 'completed'
    AND r.hidden_at IS NULL
    AND r.ai_sport IS NOT NULL
    AND public.reel_visible_to(r.id, _viewer)
  ORDER BY 1;
$function$;

CREATE FUNCTION public.public_user_reel_ids(
  _user_id uuid,
  _limit int DEFAULT 12,
  _viewer uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, created_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT r.id, r.created_at
  FROM public.highlight_reels r
  WHERE r.user_id = _user_id
    AND r.status = 'completed'
    AND r.hidden_at IS NULL
    AND public.reel_visible_to(r.id, _viewer)
  ORDER BY r.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(_limit, 12), 1), 50);
$function$;

REVOKE EXECUTE ON FUNCTION public.public_reel_feed_ids(timestamptz, text, int, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.public_reel_feed_sports(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.public_user_reel_ids(uuid, int, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_reel_feed_ids(timestamptz, text, int, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.public_reel_feed_sports(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.public_user_reel_ids(uuid, int, uuid) TO service_role;

-- 6. Comments and reactions follow the reel ------------------------------------------------------
-- A thread on a followers-only or private reel is only readable, and only writable, by
-- someone who can watch the reel. Other reels are unchanged.

CREATE OR REPLACE FUNCTION private_sec.reel_thread_allowed(_subject_type text, _subject_id text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid;
BEGIN
  IF _subject_type IS DISTINCT FROM 'highlight_reel' THEN
    RETURN true;
  END IF;
  BEGIN
    rid := _subject_id::uuid;
  EXCEPTION WHEN others THEN
    RETURN true;
  END;
  IF public.reel_audience(rid) NOT IN ('followers','private') THEN
    RETURN true;
  END IF;
  RETURN public.reel_visible_to(rid, auth.uid());
END $$;

REVOKE ALL ON FUNCTION private_sec.reel_thread_allowed(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.reel_thread_allowed(text, text) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS post_comments_reel_audience_read ON public.post_comments;
CREATE POLICY post_comments_reel_audience_read ON public.post_comments
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (private_sec.reel_thread_allowed(subject_type, subject_id));

DROP POLICY IF EXISTS post_comments_reel_audience_write ON public.post_comments;
CREATE POLICY post_comments_reel_audience_write ON public.post_comments
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (private_sec.reel_thread_allowed(subject_type, subject_id));

DROP POLICY IF EXISTS post_reactions_reel_audience_read ON public.post_reactions;
CREATE POLICY post_reactions_reel_audience_read ON public.post_reactions
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (private_sec.reel_thread_allowed(subject_type, subject_id));

DROP POLICY IF EXISTS post_reactions_reel_audience_write ON public.post_reactions;
CREATE POLICY post_reactions_reel_audience_write ON public.post_reactions
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (private_sec.reel_thread_allowed(subject_type, subject_id));
