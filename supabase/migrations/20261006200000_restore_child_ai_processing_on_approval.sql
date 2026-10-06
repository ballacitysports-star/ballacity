-- When a guardian turns AI analysis ON for a child, give the child's own
-- "AI video & highlight processing" switch back.
--
-- Background: while the guardian control is off, trg_clamp_ai_processing_for_minors
-- (and reclamp_ai_on_controls_change) force the child's own
-- privacy_preferences.ai_processing to false. Turning the guardian control on
-- never undid that, so ai_analysis_allowed() kept returning false (it needs both
-- the guardian control and the child's own switch) even though the parent had
-- approved, and the child was told a parent must allow AI.
--
-- This only restores ai_processing, which defaults to true. ai_training_opt_in is
-- a separate consent and stays false. It acts only when the guardian control
-- actually changes from not-on to on (or the controls row is created already on),
-- so re-saving the same value later does not override a deliberate choice by the
-- child. Existing rows are NOT backfilled: a switch that is off today cannot be
-- told apart from one the child turned off on purpose.
CREATE OR REPLACE FUNCTION public.reclamp_ai_on_controls_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE was_on boolean;
BEGIN
  IF NEW.ai_analysis IS DISTINCT FROM true THEN
    UPDATE public.privacy_preferences
       SET ai_processing = false, ai_training_opt_in = false
     WHERE user_id = NEW.child_user_id
       AND (ai_processing IS DISTINCT FROM false OR ai_training_opt_in IS DISTINCT FROM false);
  ELSE
    IF TG_OP = 'UPDATE' THEN
      was_on := (OLD.ai_analysis IS NOT DISTINCT FROM true);
    ELSE
      was_on := false;
    END IF;
    IF NOT was_on THEN
      UPDATE public.privacy_preferences
         SET ai_processing = true
       WHERE user_id = NEW.child_user_id
         AND ai_processing IS DISTINCT FROM true;
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.reclamp_ai_on_controls_change() FROM PUBLIC, anon, authenticated;
