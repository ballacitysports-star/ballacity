-- Guardian opt-in: show a minor's level, XP and milestone badges on their public Player Card.
--
-- Off by default for every child. What it can ever show is decided in application
-- code by one allow-list (level, XP bar, milestone badges). Never game dates,
-- venues, streaks, reliability or attendance counts.
--
-- public_xp_enabled() is the single check: the toggle is on, the account is a minor
-- and its child features are not locked. Service-role only.

ALTER TABLE public.child_controls
  ADD COLUMN IF NOT EXISTS public_xp boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.public_xp_enabled(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT c.public_xp FROM public.child_controls c WHERE c.child_user_id = _user), false)
     AND public.age_cohort_of(_user) IN ('child_under_13', 'teen_13_15', 'teen_16_17')
     AND NOT public.child_features_locked(_user);
$$;

REVOKE EXECUTE ON FUNCTION public.public_xp_enabled(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_xp_enabled(uuid) TO service_role;
