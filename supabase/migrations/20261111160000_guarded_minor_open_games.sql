-- Guarded minors on open games (task #71, from #397's review), built on 20261111120000_minor_safety_gates (PR #405).
--
-- A minor with an active guardian link needs that guardian's approval of a request for a game before taking a place in
-- it (enforce_child_game_participation, #389). The check only ran when a request or a payment for the game already
-- existed. On a game without a host approval queue (game_payment_settings.requires_approval false: an "open" game) the
-- app wrote the place directly, with no request, so:
--   - on a free open game a guarded 16-17-year-old (and a 13-15 or under-13 with a guardian) took a place with no
--     guardian approval at all, and a 16-17's guardian was not even told. A child who had asked could also delete
--     their own request and then join directly, which put them back outside the check;
--   - on a paid open game the payment gate (enforce_guardian_before_payment) refused them, rightly, because no
--     approved request existed, and the app never created one, so the guardian had nothing to approve.
--
-- Now a guarded minor's place in any game needs a request for that game that is pending or approved and carries a
-- valid approval from a current guardian (private_sec.guardian_approval_valid), whoever writes the row: the player, or
-- the server placing them after a payment. The request does not need the host's answer on an open game: the app sends
-- the request to the guardian only, and the host gate (enforce_game_join_gate) keeps asking for the host's approval
-- only where requires_approval is set, as before.
--
-- Unchanged: the rules for adults and for 16-17-year-olds with no active guardian link; every host, payment, cohort,
-- age, block and capacity rule; join requests themselves (still the ask the guardian answers); queue games (a request
-- always exists there, so the check already applied); places already taken (the trigger runs before INSERT only).
-- Only the "a request or payment exists" condition is removed. Everything here tightens.
-- Rollback: docs/rollbacks/20261111160000_guarded_minor_open_games.down.sql (guarded).

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

  -- Per-game guardian approval, game_participants only (the actual grant of a place). join_requests itself (the
  -- pending ask) stays ungated, so there is something for the guardian to approve. Every game, open or with a host
  -- queue: a minor with an active guardian link takes a place only on a request for this game that a current guardian
  -- approved. With no request at all (an open game's direct join, or after deleting the request) the place is refused.
  IF TG_TABLE_NAME = 'game_participants'
     AND subject IS NOT NULL
     AND public.is_minor(subject)
     AND EXISTS (SELECT 1 FROM public.guardian_links WHERE child_user_id = subject AND status = 'active')
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
END $function$;
