-- Hotfix: close four write paths that are live in production (audit 2026-11-04, findings A-F1, B-F1, B-F3, B-F4).
--
--   1. A team manager could UPDATE a member row's user_id/team_id and so put any person, including a minor, on their
--      roster without an invitation. That made shares_team true, which opens the minor's real name and content to the
--      manager. API roles may no longer change who or which team a row is about. (Facility memberships were already
--      protected by trg_guard_trainer_org_member_identity.)
--   2. A player could write refund_status / refund_amount / refund_* on their own payment claim (insert or pending update)
--      and so have the host told "refund owed $9999". Only the refund engine (definer functions, service role) writes them.
--   3. A review written or edited directly through the API skipped the AI screening in submitReview. Such a write is now
--      held (flagged) until the server releases it after screening (public.release_review_screening, service role only).
--      A flag the integrity rules set is never cleared by the release. Gym reviews are unchanged (they are not screened).
--      A held review is not shown to its subject either (private reviews), and its author cannot clear the hold
--      themselves, even with moderator rights (independent pre-review, 2026-11-05).
--   4. A moderator could rewrite a report directly (details, reporter, and reviewed_by set to another moderator), with no
--      audit row. A direct moderator update may now change only the review fields; reviewed_by and reviewed_at always
--      record the moderator making the change and when (any review-field change, notes included), and every such change
--      is written to admin_audit_log. (The app's server path, service role,
--      writes its own audit and is unaffected.)
--
-- Versioned before the privacy release range (20261103100000) so it can ship to production on its own. The checks use
-- current_user, which is the API role for a direct statement and the owner inside SECURITY DEFINER code.

-- ------------------------------------------------------------------------------------------------- 1. member identity
CREATE OR REPLACE FUNCTION public.lock_member_row_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
DECLARE
  _i int;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  FOR _i IN 0 .. TG_NARGS - 1 LOOP
    IF (to_jsonb(NEW) -> TG_ARGV[_i]) IS DISTINCT FROM (to_jsonb(OLD) -> TG_ARGV[_i]) THEN
      RAISE EXCEPTION 'MEMBER_IDENTITY_FIXED: a membership cannot be moved to another person or team; remove it and invite instead.'
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.lock_member_row_identity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_member_row_identity() TO anon, authenticated, service_role;

DROP TRIGGER IF EXISTS a0_team_members_identity_locked ON public.team_members;
CREATE TRIGGER a0_team_members_identity_locked BEFORE UPDATE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.lock_member_row_identity('user_id', 'team_id');

-- trainer_org_members already has this protection (trg_guard_trainer_org_member_identity, 20261027160000).

-- ------------------------------------------------------------------------------------------------- 2. refund fields
CREATE OR REPLACE FUNCTION public.lock_payment_refund_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
DECLARE
  _cols constant text[] := ARRAY['refund_status', 'refund_pct', 'refund_amount', 'refund_reason', 'refund_settled_at', 'refunded_at'];
  _c text;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  FOREACH _c IN ARRAY _cols LOOP
    IF (TG_OP = 'INSERT' AND jsonb_typeof(to_jsonb(NEW) -> _c) IS DISTINCT FROM 'null')
       OR (TG_OP = 'UPDATE' AND (to_jsonb(NEW) -> _c) IS DISTINCT FROM (to_jsonb(OLD) -> _c)) THEN
      RAISE EXCEPTION 'PAYMENT_FIELD_FORBIDDEN: refund details are set by BallaCity, not by the player or host.'
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.lock_payment_refund_fields() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_payment_refund_fields() TO anon, authenticated, service_role;

DROP TRIGGER IF EXISTS a00_payment_refund_fields_locked ON public.payment_submissions;
CREATE TRIGGER a00_payment_refund_fields_locked BEFORE INSERT OR UPDATE ON public.payment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.lock_payment_refund_fields();

-- ------------------------------------------------------------------------------------------------- 3. review screening
-- One row per review held for screening. keep_flagged records that the review was already flagged by the integrity
-- rules (or was flagged before an edit), so releasing the screening hold never clears that flag.
CREATE TABLE IF NOT EXISTS private_sec.review_screening_holds (
  review_id uuid PRIMARY KEY,
  keep_flagged boolean NOT NULL,
  held_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE private_sec.review_screening_holds FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private_sec.record_review_hold(_review_id uuid, _keep_flagged boolean)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  INSERT INTO private_sec.review_screening_holds (review_id, keep_flagged) VALUES (_review_id, _keep_flagged)
  ON CONFLICT (review_id) DO UPDATE SET keep_flagged = private_sec.review_screening_holds.keep_flagged OR EXCLUDED.keep_flagged,
                                        held_at = now();
$function$;
REVOKE ALL ON FUNCTION private_sec.record_review_hold(uuid, boolean) FROM PUBLIC, anon;
-- Called from the invoker trigger below in the API role's context; private_sec is not exposed through the API.
GRANT EXECUTE ON FUNCTION private_sec.record_review_hold(uuid, boolean) TO authenticated;

-- Fires after the integrity trigger (name order), so NEW.flagged already holds the integrity verdict.
CREATE OR REPLACE FUNCTION public.hold_review_for_screening()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
DECLARE
  _ignore constant text[] := ARRAY['flagged', 'helpful_count', 'is_private', 'verified', 'updated_at'];
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR NEW.reviewee_kind = 'gym' THEN
    RETURN NEW;
  END IF;
  -- Moderators pass the integrity trigger's author lock, so without this a moderator could hold-release their own review.
  IF TG_OP = 'UPDATE' AND OLD.flagged AND NOT NEW.flagged AND NEW.reviewer_id = auth.uid()
     AND private_sec.review_is_held(NEW.id) THEN
    RAISE EXCEPTION 'REVIEW_HELD_FOR_SCREENING: your review is published after screening.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM private_sec.record_review_hold(NEW.id, COALESCE(NEW.flagged, false));
    NEW.flagged := true;
  ELSIF (to_jsonb(NEW) - _ignore) IS DISTINCT FROM (to_jsonb(OLD) - _ignore) THEN
    -- the author changed what the review says: hidden until screened again
    PERFORM private_sec.record_review_hold(NEW.id, COALESCE(OLD.flagged, false));
    NEW.flagged := true;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.hold_review_for_screening() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hold_review_for_screening() TO anon, authenticated, service_role;

DROP TRIGGER IF EXISTS zz_reviews_hold_for_screening ON public.reviews;
CREATE TRIGGER zz_reviews_hold_for_screening BEFORE INSERT OR UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.hold_review_for_screening();

-- The INSERT policy requires flagged = false; a review held by the trigger above is the one exception.
CREATE OR REPLACE FUNCTION private_sec.review_is_held(_review_id uuid)
 RETURNS boolean
 LANGUAGE sql
 VOLATILE  -- must see the hold row the BEFORE trigger wrote in this same statement (a STABLE function would not)
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (SELECT 1 FROM private_sec.review_screening_holds h WHERE h.review_id = _review_id)
$function$;
REVOKE ALL ON FUNCTION private_sec.review_is_held(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.review_is_held(uuid) TO authenticated;

DROP POLICY IF EXISTS "Users can write reviews as themselves" ON public.reviews;
CREATE POLICY "Users can write reviews as themselves" ON public.reviews FOR INSERT TO authenticated
  WITH CHECK (reviewer_id = auth.uid() AND (flagged = false OR private_sec.review_is_held(id)));

-- The subject of a private review sees it only once it is visible (not flagged, so not held for screening either). The
-- policy is otherwise unchanged (20260915225632).
DROP POLICY IF EXISTS "Reviewees view their private reviews" ON public.reviews;
CREATE POLICY "Reviewees view their private reviews" ON public.reviews FOR SELECT TO authenticated
  USING (
    is_private = true
    AND flagged = false
    AND reviewee_id = (auth.uid())::text
    AND reviewee_kind NOT IN ('gym', 'team', 'org', 'trainer_org')
  );

-- The server calls this after the AI screening cleared the text, passing the exact title and body it screened. The
-- review becomes visible only if its stored text is still exactly that: an edit made between screening and release
-- (or any other text) keeps it held. Returns true when the review became visible.
DROP FUNCTION IF EXISTS public.release_review_screening(uuid);
CREATE OR REPLACE FUNCTION public.release_review_screening(_review_id uuid, _screened_title text, _screened_body text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _keep boolean;
  _r public.reviews;
BEGIN
  SELECT * INTO _r FROM public.reviews WHERE id = _review_id FOR UPDATE;
  IF NOT FOUND
     OR _r.title IS DISTINCT FROM _screened_title
     OR _r.body IS DISTINCT FROM _screened_body THEN
    RETURN false;                                   -- not what was screened: stays held
  END IF;
  DELETE FROM private_sec.review_screening_holds WHERE review_id = _review_id RETURNING keep_flagged INTO _keep;
  IF NOT FOUND OR _keep THEN
    RETURN false;
  END IF;
  PERFORM set_config('app.review_system', '1', true);
  UPDATE public.reviews SET flagged = false WHERE id = _review_id;
  PERFORM set_config('app.review_system', '', true);
  RETURN FOUND;
END $function$;
REVOKE ALL ON FUNCTION public.release_review_screening(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_review_screening(uuid, text, text) TO service_role;

-- ------------------------------------------------------------------------------------------------- 4. report rewrites
CREATE OR REPLACE FUNCTION private_sec.audit_report_change(_before jsonb, _after jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, before, after)
  VALUES (auth.uid(), 'report_updated_directly', 'user_report', _after ->> 'id', _before, _after);
$function$;
REVOKE ALL ON FUNCTION private_sec.audit_report_change(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.audit_report_change(jsonb, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_report_moderation_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
DECLARE
  _review constant text[] := ARRAY['status', 'resolution_notes', 'reviewed_by', 'reviewed_at', 'updated_at'];
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  -- what was reported, by whom and about whom never changes through the API
  IF (to_jsonb(NEW) - _review) IS DISTINCT FROM (to_jsonb(OLD) - _review) THEN
    RAISE EXCEPTION 'REPORT_FIELDS_FIXED: only the review status and notes of a report can be changed.' USING ERRCODE = '42501';
  END IF;
  -- the reviewer is whoever makes the change, and it happens now: any change of the review fields (notes included)
  IF (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    NEW.reviewed_by := auth.uid();
    NEW.reviewed_at := now();
  END IF;
  PERFORM private_sec.audit_report_change(to_jsonb(OLD), to_jsonb(NEW));
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.guard_report_moderation_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_report_moderation_update() TO anon, authenticated, service_role;

DROP TRIGGER IF EXISTS zz_user_reports_moderation_guard ON public.user_reports;
CREATE TRIGGER zz_user_reports_moderation_guard BEFORE UPDATE ON public.user_reports
  FOR EACH ROW EXECUTE FUNCTION public.guard_report_moderation_update();