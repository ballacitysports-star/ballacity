-- Listing claims: no self-review, a declared relationship, an accuracy
-- attestation, and a "needs more information" step.
--
-- Closes a gap in 20260911000000_unclaimed_listings.sql: approve_listing_claim
-- and deny_listing_claim checked that the caller is a moderator but not that the
-- claim is someone else's. Reproduced on a full local replay before this file
-- existed: a moderator created an unclaimed team, claimed it, approved the claim
-- and became its owner. Both routines now refuse the caller's own claim.
--
-- Everything else is additive: new nullable columns, one widened CHECK (adds
-- 'needs_info'), the one-open-claim index widened to cover 'needs_info', and new
-- routines. Existing claims keep their values; their relationship is NULL
-- ("not stated"), which the UI shows as such.
--
-- What a claim still never does: grant anything before a moderator approves it,
-- or touch Facebook. Approval still only sets owner_id inside
-- approve_listing_claim, guarded by guard_listing_owner_change.
--
-- Rollback: drop the three new routines, restore the four replaced routines
-- from 20260911000000, recreate listing_claims_one_open_per_user with
-- WHERE status = 'pending' and the original status CHECK (after moving any
-- 'needs_info' rows back to 'pending'), then drop the four new columns.

-- ============ 1. columns ============

ALTER TABLE public.listing_claims
  ADD COLUMN IF NOT EXISTS relationship text
    CHECK (relationship IN ('original_poster', 'owner', 'coach', 'gym_owner', 'employee', 'authorized_rep')),
  ADD COLUMN IF NOT EXISTS attested_at timestamptz,
  ADD COLUMN IF NOT EXISTS info_request text CHECK (length(info_request) <= 500),
  ADD COLUMN IF NOT EXISTS info_requested_at timestamptz;

ALTER TABLE public.listing_claims DROP CONSTRAINT IF EXISTS listing_claims_status_check;
ALTER TABLE public.listing_claims
  ADD CONSTRAINT listing_claims_status_check
  CHECK (status IN ('pending', 'needs_info', 'approved', 'denied', 'withdrawn'));

-- A claim waiting on the claimant's answer is still open: one per person per listing.
DROP INDEX IF EXISTS public.listing_claims_one_open_per_user;
CREATE UNIQUE INDEX listing_claims_one_open_per_user
  ON public.listing_claims (subject_type, subject_id, user_id)
  WHERE status IN ('pending', 'needs_info');

-- ============ 2. validation (replaces the 20260911000000 body) ============

CREATE OR REPLACE FUNCTION public.validate_listing_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _owner uuid;
  _found boolean := false;
  _uuid uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000'; END IF;
    IF NEW.user_id <> auth.uid() THEN
      RAISE EXCEPTION 'USER_MISMATCH' USING ERRCODE='42501';
    END IF;

    NEW.status := 'pending';
    NEW.denial_reason := NULL;
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    -- Review fields are the reviewer's, never the claimant's.
    NEW.info_request := NULL;
    NEW.info_requested_at := NULL;

    IF NEW.message IS NOT NULL AND length(NEW.message) > 1000 THEN
      RAISE EXCEPTION 'MESSAGE_TOO_LONG';
    END IF;

    IF NEW.subject_type = 'team' THEN
      SELECT owner_id, true INTO _owner, _found FROM public.teams WHERE id = NEW.subject_id;
    ELSE
      BEGIN
        _uuid := NEW.subject_id::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'LISTING_NOT_FOUND';
      END;
      SELECT owner_id, true INTO _owner, _found FROM public.trainer_orgs WHERE id = _uuid;
    END IF;

    IF NOT COALESCE(_found, false) THEN RAISE EXCEPTION 'LISTING_NOT_FOUND'; END IF;
    IF _owner IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_CLAIMED'; END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.subject_type <> OLD.subject_type
       OR NEW.subject_id <> OLD.subject_id
       OR NEW.user_id <> OLD.user_id THEN
      RAISE EXCEPTION 'IMMUTABLE_FIELDS' USING ERRCODE='42501';
    END IF;
    -- What the claimant declared and attested stays as filed.
    IF NEW.relationship IS DISTINCT FROM OLD.relationship
       OR NEW.attested_at IS DISTINCT FROM OLD.attested_at THEN
      RAISE EXCEPTION 'IMMUTABLE_FIELDS' USING ERRCODE='42501';
    END IF;
    IF NEW.denial_reason IS NOT NULL AND length(NEW.denial_reason) > 500 THEN
      RAISE EXCEPTION 'REASON_TOO_LONG';
    END IF;
    IF NEW.message IS NOT NULL AND length(NEW.message) > 1000 THEN
      RAISE EXCEPTION 'MESSAGE_TOO_LONG';
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- ============ 3. filing with a relationship and an attestation ============

CREATE OR REPLACE FUNCTION public.submit_listing_claim_details(
  _type text, _id text, _relationship text, _attest boolean,
  _message text DEFAULT NULL, _evidence text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid(); _claim uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000'; END IF;
  IF _relationship IS NULL OR _relationship NOT IN
     ('original_poster', 'owner', 'coach', 'gym_owner', 'employee', 'authorized_rep') THEN
    RAISE EXCEPTION 'RELATIONSHIP_REQUIRED';
  END IF;
  IF _attest IS DISTINCT FROM true THEN RAISE EXCEPTION 'ATTESTATION_REQUIRED'; END IF;
  IF _evidence IS NOT NULL AND length(_evidence) > 500 THEN RAISE EXCEPTION 'EVIDENCE_TOO_LONG'; END IF;

  BEGIN
    INSERT INTO public.listing_claims
      (subject_type, subject_id, user_id, message, evidence_url, relationship, attested_at)
    VALUES (_type, _id, _me, NULLIF(btrim(COALESCE(_message, '')), ''),
            NULLIF(btrim(COALESCE(_evidence, '')), ''), _relationship, now())
    RETURNING id INTO _claim;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'CLAIM_ALREADY_PENDING';
  END;
  RETURN _claim;
END $$;

-- ============ 4. review (replaces the 20260911000000 bodies, plus OWN_CLAIM) ============

CREATE OR REPLACE FUNCTION public.approve_listing_claim(_claim uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _c public.listing_claims%ROWTYPE;
  _owner uuid;
  _name text;
  _link text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000'; END IF;
  IF NOT public.is_moderator(_me) THEN RAISE EXCEPTION 'NOT_MODERATOR' USING ERRCODE='42501'; END IF;

  SELECT * INTO _c FROM public.listing_claims WHERE id = _claim FOR UPDATE;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'CLAIM_NOT_FOUND'; END IF;
  IF _c.user_id = _me THEN RAISE EXCEPTION 'OWN_CLAIM' USING ERRCODE='42501'; END IF;
  IF _c.status <> 'pending' THEN RAISE EXCEPTION 'CLAIM_NOT_PENDING'; END IF;

  IF _c.subject_type = 'team' THEN
    SELECT owner_id, name INTO _owner, _name
      FROM public.teams WHERE id = _c.subject_id FOR UPDATE;
    IF _name IS NULL THEN RAISE EXCEPTION 'LISTING_NOT_FOUND'; END IF;
    IF _owner IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_CLAIMED'; END IF;

    PERFORM set_config('app.team_transfer', 'on', true);
    PERFORM set_config('app.listing_claim', 'on', true);

    UPDATE public.teams SET owner_id = _c.user_id, claimed_at = now(), updated_at = now()
      WHERE id = _c.subject_id;
    _link := '/teams/' || _c.subject_id;
  ELSE
    SELECT owner_id, name INTO _owner, _name
      FROM public.trainer_orgs WHERE id = _c.subject_id::uuid FOR UPDATE;
    IF _name IS NULL THEN RAISE EXCEPTION 'LISTING_NOT_FOUND'; END IF;
    IF _owner IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_CLAIMED'; END IF;

    PERFORM set_config('app.listing_claim', 'on', true);
    UPDATE public.trainer_orgs SET owner_id = _c.user_id, claimed_at = now(), updated_at = now()
      WHERE id = _c.subject_id::uuid;
    _link := '/orgs/' || _c.subject_id;
  END IF;

  UPDATE public.listing_claims
    SET status = 'approved', reviewed_by = _me, reviewed_at = now()
    WHERE id = _claim;

  -- Competing open claims, including ones waiting on more information, lose.
  UPDATE public.listing_claims
    SET status = 'denied',
        denial_reason = 'Listing was claimed by another user.',
        reviewed_by = _me, reviewed_at = now()
    WHERE subject_type = _c.subject_type AND subject_id = _c.subject_id
      AND status IN ('pending', 'needs_info') AND id <> _claim;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_c.user_id, 'listing_claim', 'You now manage ' || _name,
          'Your claim was approved. ' || _name || ' is yours to manage.', _link);
END $$;

CREATE OR REPLACE FUNCTION public.deny_listing_claim(_claim uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _c public.listing_claims%ROWTYPE;
  _name text;
  _link text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000'; END IF;
  IF NOT public.is_moderator(_me) THEN RAISE EXCEPTION 'NOT_MODERATOR' USING ERRCODE='42501'; END IF;

  SELECT * INTO _c FROM public.listing_claims WHERE id = _claim FOR UPDATE;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'CLAIM_NOT_FOUND'; END IF;
  IF _c.user_id = _me THEN RAISE EXCEPTION 'OWN_CLAIM' USING ERRCODE='42501'; END IF;
  IF _c.status NOT IN ('pending', 'needs_info') THEN RAISE EXCEPTION 'CLAIM_NOT_PENDING'; END IF;

  UPDATE public.listing_claims
    SET status = 'denied',
        denial_reason = NULLIF(btrim(COALESCE(_reason, '')), ''),
        reviewed_by = _me, reviewed_at = now()
    WHERE id = _claim;

  IF _c.subject_type = 'team' THEN
    SELECT name INTO _name FROM public.teams WHERE id = _c.subject_id;
    _link := '/teams/' || _c.subject_id;
  ELSE
    SELECT name INTO _name FROM public.trainer_orgs WHERE id = _c.subject_id::uuid;
    _link := '/orgs/' || _c.subject_id;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_c.user_id, 'listing_claim',
          'Your claim on ' || COALESCE(_name, 'a listing') || ' was declined',
          NULLIF(btrim(COALESCE(_reason, '')), ''), _link);
END $$;

-- ============ 5. asking for more, and answering ============

CREATE OR REPLACE FUNCTION public.request_listing_claim_info(_claim uuid, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _c public.listing_claims%ROWTYPE;
  _name text;
  _link text;
  _clean text := NULLIF(btrim(COALESCE(_note, '')), '');
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000'; END IF;
  IF NOT public.is_moderator(_me) THEN RAISE EXCEPTION 'NOT_MODERATOR' USING ERRCODE='42501'; END IF;
  IF _clean IS NULL THEN RAISE EXCEPTION 'NOTE_REQUIRED'; END IF;
  IF length(_clean) > 500 THEN RAISE EXCEPTION 'NOTE_TOO_LONG'; END IF;

  SELECT * INTO _c FROM public.listing_claims WHERE id = _claim FOR UPDATE;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'CLAIM_NOT_FOUND'; END IF;
  IF _c.user_id = _me THEN RAISE EXCEPTION 'OWN_CLAIM' USING ERRCODE='42501'; END IF;
  IF _c.status <> 'pending' THEN RAISE EXCEPTION 'CLAIM_NOT_PENDING'; END IF;

  UPDATE public.listing_claims
    SET status = 'needs_info', info_request = _clean, info_requested_at = now(),
        reviewed_by = _me
    WHERE id = _claim;

  IF _c.subject_type = 'team' THEN
    SELECT name INTO _name FROM public.teams WHERE id = _c.subject_id;
    _link := '/teams/' || _c.subject_id;
  ELSE
    SELECT name INTO _name FROM public.trainer_orgs WHERE id = _c.subject_id::uuid;
    _link := '/orgs/' || _c.subject_id;
  END IF;

  -- The note is the reviewer's question, written for the claimant. Internal
  -- review notes never go here.
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_c.user_id, 'listing_claim',
          'More information needed for your claim on ' || COALESCE(_name, 'a listing'),
          _clean, _link);
END $$;

CREATE OR REPLACE FUNCTION public.respond_listing_claim(_claim uuid, _message text, _evidence text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid(); _c public.listing_claims%ROWTYPE;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000'; END IF;
  SELECT * INTO _c FROM public.listing_claims WHERE id = _claim FOR UPDATE;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'CLAIM_NOT_FOUND'; END IF;
  IF _c.user_id <> _me THEN RAISE EXCEPTION 'NOT_CLAIM_OWNER' USING ERRCODE='42501'; END IF;
  IF _c.status <> 'needs_info' THEN RAISE EXCEPTION 'CLAIM_NOT_AWAITING_INFO'; END IF;
  IF btrim(COALESCE(_message, '')) = '' THEN RAISE EXCEPTION 'MESSAGE_REQUIRED'; END IF;
  IF _evidence IS NOT NULL AND length(_evidence) > 500 THEN RAISE EXCEPTION 'EVIDENCE_TOO_LONG'; END IF;

  -- Back in the queue with the answer appended, so the reviewer sees both.
  UPDATE public.listing_claims
    SET status = 'pending',
        message = left(COALESCE(_c.message || E'\n\n', '') || 'Reply: ' || btrim(_message), 1000),
        evidence_url = COALESCE(NULLIF(btrim(COALESCE(_evidence, '')), ''), _c.evidence_url)
    WHERE id = _claim;
END $$;

CREATE OR REPLACE FUNCTION public.withdraw_listing_claim(_claim uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid(); _c public.listing_claims%ROWTYPE;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000'; END IF;
  SELECT * INTO _c FROM public.listing_claims WHERE id = _claim FOR UPDATE;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'CLAIM_NOT_FOUND'; END IF;
  IF _c.user_id <> _me THEN RAISE EXCEPTION 'NOT_CLAIM_OWNER' USING ERRCODE='42501'; END IF;
  IF _c.status NOT IN ('pending', 'needs_info') THEN RAISE EXCEPTION 'CLAIM_NOT_PENDING'; END IF;

  UPDATE public.listing_claims SET status = 'withdrawn' WHERE id = _claim;
END $$;

-- ============ 6. privileges (house pattern: PUBLIC and anon out) ============

REVOKE EXECUTE ON FUNCTION public.validate_listing_claim() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_listing_claim_details(text, text, text, boolean, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.approve_listing_claim(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.deny_listing_claim(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_listing_claim_info(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.respond_listing_claim(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.withdraw_listing_claim(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.submit_listing_claim_details(text, text, text, boolean, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_listing_claim(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deny_listing_claim(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_listing_claim_info(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_listing_claim(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_listing_claim(uuid) TO authenticated;
