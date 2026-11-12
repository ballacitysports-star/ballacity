-- ROLLBACK for supabase/migrations/20261111160000_guarded_minor_open_games.sql (task #71).
-- NOT a migration. It puts back what the migration closed: a minor with an active guardian link can again take a place
-- in a game with no guardian approval whenever no request and no payment for that game exists (a direct join on an
-- open game, including after deleting their own request), and the server can again place such a minor with none.
-- enforce_child_game_participation goes back to its definition before the migration (20261111120000_minor_safety_gates,
-- PR #405's head ad1d3fc1), byte for byte as pg_get_functiondef prints it. Nothing else changed, so nothing else moves.
-- Places taken while the migration was in force are kept.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_guarded_minor_open_games_rollback = 'yes';   (or PGOPTIONS="-c app.confirm_guarded_minor_open_games_rollback=yes")
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_guarded_minor_open_games_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this lets a guarded minor join an open game without their guardian''s approval. Set app.confirm_guarded_minor_open_games_rollback=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

-- The definition in force before the migration (20261111120000_minor_safety_gates), unchanged.
CREATE OR REPLACE FUNCTION public.enforce_child_game_participation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE subject uuid;
BEGIN
  IF TG_TABLE_NAME = 'join_requests' THEN
    subject := NEW.player_id;
  ELSE
    subject := NEW.user_id;
  END IF;
  subject := COALESCE(subject, auth.uid());

  -- A declared age is required whoever writes the row: the player, or the server placing them after a payment. An
  -- unknown age is not "not a minor".
  IF subject IS NOT NULL AND NOT public.age_verified(subject) THEN
    IF subject = auth.uid() THEN
      RAISE EXCEPTION 'AGE_VERIFICATION_REQUIRED: add your date of birth before joining games.';
    END IF;
    RAISE EXCEPTION 'AGE_VERIFICATION_REQUIRED: this player must add their date of birth before joining games.';
  END IF;
  IF subject IS NOT NULL AND NOT public.child_game_participation_allowed(subject) THEN
    RAISE EXCEPTION 'CHILD_GAME_PARTICIPATION_BLOCKED: a parent or guardian must approve this account and allow game participation.';
  END IF;

  -- NEW: per-request guardian approval, game_participants only — the actual
  -- grant of participation. join_requests itself (the pending ask) stays
  -- ungated, so there's something for the guardian to approve in the first
  -- place; the inner EXISTS also means a non-approval-queue game's direct
  -- self-serve join (no join_requests row at all) is untouched by this.
  IF TG_TABLE_NAME = 'game_participants'
     AND subject IS NOT NULL
     AND public.is_minor(subject)
     AND EXISTS (SELECT 1 FROM public.guardian_links WHERE child_user_id = subject AND status = 'active')
     -- A request for this game, or a payment for it (a paid place cannot dodge the gate by deleting the request).
     AND (EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.game_id = NEW.game_id AND jr.player_id = subject)
          OR EXISTS (SELECT 1 FROM public.payment_submissions ps
                      WHERE ps.game_id = NEW.game_id AND ps.player_id = subject))
     AND NOT EXISTS (
       SELECT 1 FROM public.join_requests jr
       WHERE jr.game_id = NEW.game_id AND jr.player_id = subject AND jr.guardian_approved_at IS NOT NULL
         AND jr.status IN ('pending', 'approved')
         AND private_sec.guardian_approval_valid(subject, jr.guardian_approved_by)
     )
  THEN
    RAISE EXCEPTION 'GUARDIAN_APPROVAL_REQUIRED: a parent or guardian must approve this join request first.';
  END IF;

  RETURN NEW;
END $function$

;

COMMIT;
