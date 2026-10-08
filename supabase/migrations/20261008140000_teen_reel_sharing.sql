-- Guardian-approved reel sharing for ages 13-15.
--
-- Until now no reel from an account under 16 could ever be shown to anyone else.
-- This adds one more choice to the guardian's existing "Video visibility" control:
--
--   'members'  Reels the teen chooses to post can be seen by signed-in ballaCity
--              members. Never anonymous visitors, never search engines.
--
-- Guardrails, all enforced in the database:
--   * Only the 13-15 band can use it. A guard trigger rejects it for anyone else,
--     and reel_audience() ignores it for anyone else, so it is inert even if a
--     row got it some other way. Under-13 reels stay private to the owner.
--   * Off by default: the default stays 'private', so nothing changes for anyone
--     until a guardian chooses it. Existing values are untouched.
--   * The teen still decides what goes out: a reel must also be posted (it starts
--     as a draft), not hidden, completed, and the account must not be locked.
--   * Setting the control back to 'private' already hides all of the child's
--     reels (existing behaviour in set_child_controls); choosing any other value
--     stops the reels being shown immediately, because reel_audience() only
--     honours 'members'.
--   * Changes land in the family activity trail through the existing
--     log_child_controls_change trigger.
--
-- The 16-17 rule ('members' audience) and the adult rule ('public') are unchanged.
-- Everything except a 13-15 reel whose guardian chose 'members' evaluates exactly
-- as before.

ALTER TABLE public.child_controls
  DROP CONSTRAINT IF EXISTS child_controls_media_visibility_check;
ALTER TABLE public.child_controls
  ADD CONSTRAINT child_controls_media_visibility_check
  CHECK (media_visibility IN ('private', 'guardian', 'teammates', 'members'));

CREATE OR REPLACE FUNCTION public.guard_members_media_visibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.media_visibility = 'members'
     AND public.age_cohort_of(NEW.child_user_id) IS DISTINCT FROM 'teen_13_15' THEN
    RAISE EXCEPTION 'MEMBERS_SHARING_NOT_AVAILABLE'
      USING HINT = 'Sharing reels with members is only available for ages 13 to 15.';
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.guard_members_media_visibility() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_members_media_visibility ON public.child_controls;
CREATE TRIGGER trg_guard_members_media_visibility
BEFORE INSERT OR UPDATE OF media_visibility ON public.child_controls
FOR EACH ROW EXECUTE FUNCTION public.guard_members_media_visibility();

CREATE OR REPLACE FUNCTION public.reel_audience(_reel_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN r.id IS NULL THEN 'none'
    WHEN r.hidden_at IS NOT NULL OR r.status <> 'completed' THEN 'none'
    WHEN r.is_draft THEN 'none'
    WHEN public.age_cohort_of(r.user_id) = 'child_under_13' THEN 'none'
    WHEN public.child_features_locked(r.user_id) THEN 'none'
    -- 13-15: only when the guardian chose 'members', and then only to signed-in members.
    WHEN public.age_cohort_of(r.user_id) = 'teen_13_15' THEN
      CASE WHEN (SELECT c.media_visibility FROM public.child_controls c
                 WHERE c.child_user_id = r.user_id) = 'members'
           THEN 'members' ELSE 'none' END
    WHEN public.age_cohort_of(r.user_id) = 'teen_16_17' THEN 'members'
    ELSE 'public'
  END
  FROM (SELECT * FROM public.highlight_reels WHERE id = _reel_id) r;
$function$;
