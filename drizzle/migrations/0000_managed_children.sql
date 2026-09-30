-- Managed children: a guardian adds a child who has no email or password.
--
-- The child is a real auth user — created by the app's server function with
-- the service role, with an undeliverable placeholder address and no password
-- — rather than a login-less row in player_profiles. That choice is the point
-- of this migration: every child-safety control verified in
-- docs/family-architecture-*.md keys on the child's auth id (consent locks,
-- minor messaging, hosting, comments, rosters, AI analysis, the location and
-- privacy floor, birthday immutability), so all of them apply to a managed
-- child unchanged. The player_profiles route would have required repointing
-- games, rosters, media and messages and re-teaching every gate a new kind of
-- actor (the documented stage-3 blocker); it is frozen in the next migration.
--
-- What is new here:
--   * managed_accounts — who manages which credential-less child. managed_by is
--     ON DELETE RESTRICT, so no path (self-service, admin, dashboard) can
--     delete a guardian and strand an approved minor account nobody can reach.
--   * provision_managed_child() — run as the guardian (auth.uid() is the
--     guardian, so every audit, consent and age-change row names them) right
--     after the server function creates the auth user. It mirrors
--     redeem_minor_invite(): birthday, link, consent, controls, legal
--     acceptance, all in one transaction.
--   * revoke_guardian_link() refuses to unlink the managing guardian from a
--     managed child, which would hide the child from the only adult who can
--     reach it. Deleting the child is the way out.

-- ============ 1. managed_accounts ============

CREATE TABLE IF NOT EXISTS public.managed_accounts (
  child_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  managed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  relationship text NOT NULL DEFAULT 'parent',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS managed_accounts_managed_by_idx
  ON public.managed_accounts (managed_by, created_at DESC);

ALTER TABLE public.managed_accounts ENABLE ROW LEVEL SECURITY;

-- Rows are written only by provision_managed_child() (SECURITY DEFINER) and
-- removed by the child's deletion cascade. Nobody writes them through the API.
REVOKE ALL ON public.managed_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.managed_accounts TO authenticated;
GRANT ALL ON public.managed_accounts TO service_role;

DROP POLICY IF EXISTS "Managed accounts visible to manager, child and moderators" ON public.managed_accounts;
CREATE POLICY "Managed accounts visible to manager, child and moderators"
  ON public.managed_accounts FOR SELECT TO authenticated
  USING (
    managed_by = auth.uid()
    OR child_user_id = auth.uid()
    OR public.is_moderator(auth.uid())
  );

CREATE OR REPLACE FUNCTION public.is_managed_account(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.managed_accounts WHERE child_user_id = _user);
$$;
REVOKE ALL ON FUNCTION public.is_managed_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_managed_account(uuid) TO authenticated, service_role;

-- ============ 2. who accepted the legal documents ============

-- A managed child's Terms/Privacy acceptance is given by the guardian on their
-- behalf. Recording who clicked keeps that distinguishable from a member
-- accepting for themselves. NULL means the account holder accepted.
ALTER TABLE public.legal_consents
  ADD COLUMN IF NOT EXISTS accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============ 3. provision_managed_child ============

CREATE OR REPLACE FUNCTION public.provision_managed_child(
  _child uuid,
  _dob date,
  _display_name text,
  _relationship text DEFAULT 'parent',
  _sport text DEFAULT NULL,
  _versions jsonb DEFAULT '{}'::jsonb,
  _attested boolean DEFAULT false
)
RETURNS TABLE(cohort text, consent_recorded boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _parent uuid := auth.uid();
  _parent_cohort text; _parent_review boolean; _parent_suspended timestamptz;
  _parent_name text; _parent_email text; _parent_confirmed timestamptz;
  _child_meta jsonb; _child_created timestamptz;
  _cohort text; _age int; _name text; _rel text; _sport_clean text;
  _terms text; _privacy text; _published text;
  _consent boolean := false; _cid uuid; _prev text;
BEGIN
  IF _parent IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: sign in to add your child.';
  END IF;
  IF NOT COALESCE(_attested, false) THEN
    RAISE EXCEPTION 'ATTESTATION_REQUIRED: confirm you are this child''s parent or legal guardian.';
  END IF;

  -- The guardian: a verified adult in good standing with a confirmed email,
  -- and never itself a managed account.
  SELECT p.age_cohort, p.age_review_required, p.suspended_at, p.display_name
    INTO _parent_cohort, _parent_review, _parent_suspended, _parent_name
    FROM public.profiles p WHERE p.id = _parent;
  SELECT u.email, u.email_confirmed_at
    INTO _parent_email, _parent_confirmed
    FROM auth.users u WHERE u.id = _parent;
  IF COALESCE(_parent_cohort, 'unknown') <> 'adult'
     OR COALESCE(_parent_review, false)
     OR _parent_suspended IS NOT NULL
     OR _parent_confirmed IS NULL
     OR EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = _parent) THEN
    RAISE EXCEPTION 'ADULT_REQUIRED: only a verified adult account can add a child.';
  END IF;

  -- The child: an auth user the app's server function created moments ago for
  -- this guardian. app_metadata is writable only with the service role, so a
  -- guardian cannot point this at an arbitrary account.
  SELECT u.raw_app_meta_data, u.created_at
    INTO _child_meta, _child_created
    FROM auth.users u WHERE u.id = _child;
  IF _child_meta IS NULL
     OR COALESCE(_child_meta ->> 'managed', '') <> 'true'
     OR (_child_meta ->> 'managed_by') IS DISTINCT FROM _parent::text
     OR _child_created < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'NOT_YOUR_MANAGED_CHILD: that profile was not created for your account.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = _child)
     OR EXISTS (SELECT 1 FROM public.profile_birthdays b WHERE b.user_id = _child)
     OR EXISTS (SELECT 1 FROM public.guardian_links g WHERE g.child_user_id = _child) THEN
    RAISE EXCEPTION 'ALREADY_PROVISIONED: that profile is already set up.';
  END IF;

  IF (SELECT count(*) FROM public.managed_accounts m WHERE m.managed_by = _parent) >= 10
     OR (SELECT count(*) FROM public.managed_accounts m
          WHERE m.managed_by = _parent AND m.created_at > now() - interval '24 hours') >= 5 THEN
    RAISE EXCEPTION 'MANAGED_LIMIT: too many child profiles for one account.';
  END IF;

  -- Birthday: same validation as set_my_birthday(), and it must be a minor.
  IF _dob IS NULL THEN
    RAISE EXCEPTION 'DOB_REQUIRED: enter your child''s date of birth.';
  END IF;
  IF _dob > current_date THEN
    RAISE EXCEPTION 'DOB_IN_FUTURE: enter a date of birth in the past.';
  END IF;
  _age := public.calculate_age(_dob);
  IF _age IS NULL OR _age > 120 THEN
    RAISE EXCEPTION 'DOB_INVALID: enter a valid date of birth.';
  END IF;
  _cohort := public.age_cohort_from_birthday(_dob);
  IF _cohort NOT IN ('child_under_13', 'teen_13_15', 'teen_16_17') THEN
    RAISE EXCEPTION 'CHILD_IS_ADULT: an adult signs up with their own account.';
  END IF;

  _name := btrim(COALESCE(_display_name, ''));
  IF _name = '' THEN
    RAISE EXCEPTION 'NAME_REQUIRED: enter your child''s first name.';
  END IF;
  IF length(_name) > 60 OR _name ~ '[0-9@]' THEN
    RAISE EXCEPTION 'NAME_INVALID: use letters only in your child''s name.';
  END IF;

  _rel := CASE WHEN _relationship IN ('parent', 'guardian', 'grandparent', 'other adult')
               THEN _relationship ELSE 'parent' END;
  _sport_clean := NULLIF(left(btrim(COALESCE(_sport, '')), 40), '');

  -- Legal versions: the guardian accepts the versions currently published.
  -- When a document has a published row the stated version must match it;
  -- the built-in fallback applies only when nothing is published.
  _terms := NULLIF(btrim(COALESCE(_versions ->> 'terms', '')), '');
  _privacy := NULLIF(btrim(COALESCE(_versions ->> 'privacy', '')), '');
  IF _terms IS NULL OR _privacy IS NULL OR length(_terms) > 64 OR length(_privacy) > 64 THEN
    RAISE EXCEPTION 'LEGAL_VERSION_INVALID: accept the current Terms and Privacy Policy.';
  END IF;
  SELECT d.version INTO _published FROM public.legal_documents d
   WHERE d.document_type = 'terms' AND d.published
   ORDER BY d.effective_date DESC, d.published_at DESC NULLS LAST LIMIT 1;
  IF _published IS NOT NULL AND _published <> _terms THEN
    RAISE EXCEPTION 'LEGAL_VERSION_STALE: the Terms were just updated.';
  END IF;
  _published := NULL;
  SELECT d.version INTO _published FROM public.legal_documents d
   WHERE d.document_type = 'privacy' AND d.published
   ORDER BY d.effective_date DESC, d.published_at DESC NULLS LAST LIMIT 1;
  IF _published IS NOT NULL AND _published <> _privacy THEN
    RAISE EXCEPTION 'LEGAL_VERSION_STALE: the Privacy Policy was just updated.';
  END IF;

  -- 1. Ownership first: the primary key also serialises two concurrent calls.
  BEGIN
    INSERT INTO public.managed_accounts (child_user_id, managed_by, relationship)
    VALUES (_child, _parent, _rel);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ALREADY_PROVISIONED: that profile is already set up.';
  END;

  -- 2. Birthday. sync_age_category_from_birthdays() derives profiles.age_cohort,
  --    reclamps privacy to the minor floor, and for under-13 opens a
  --    'required' consent row. guard_birthday_immutability() locks it from here.
  INSERT INTO public.profile_birthdays (user_id, birthday) VALUES (_child, _dob);

  -- 3. Name, after the cohort is known, so enforce_minor_handle_safety() rejects
  --    an unsafe name here (MINOR_HANDLE_UNSAFE) instead of silently renaming
  --    the child to "Player" as it does for values nobody typed.
  UPDATE public.profiles
     SET display_name = _name,
         avatar_initials = upper(left(regexp_replace(_name, '[^[:alpha:] ]', '', 'g'), 1)
                                 || COALESCE(left(split_part(_name, ' ', 2), 1), '')),
         sport = COALESCE(_sport_clean, sport),
         account_type = 'player',
         updated_at = now()
   WHERE id = _child;

  -- 4. Link before consent, so notify_guardians() on the approval reaches the
  --    guardian. Verified: the guardian created this account themselves.
  INSERT INTO public.guardian_links (parent_user_id, child_user_id, relationship, status, verified_at)
  VALUES (_parent, _child, _rel, 'active', now());

  -- 5. Consent, where policy requires it for this cohort (mirrors
  --    redeem_minor_invite). LEGAL REVIEW REQUIRED: the method is the same
  --    email_confirmation a signed-in adult account gives elsewhere; the scope
  --    records that the guardian attested and created the account.
  IF public.parental_consent_required(_cohort) THEN
    SELECT c.id, c.status INTO _cid, _prev FROM public.parental_consents c WHERE c.child_user_id = _child;
    IF _cid IS NULL THEN
      INSERT INTO public.parental_consents (
        child_user_id, parent_email, parent_name, parent_user_id, relationship,
        status, method, jurisdiction, approved_at, requested_at,
        terms_version, privacy_version, scope)
      VALUES (_child, COALESCE(_parent_email, ''), _parent_name, _parent, _rel,
              'approved', 'email_confirmation', 'US_FEDERAL', now(), now(),
              _terms, _privacy,
              jsonb_build_object('guardian_attested', true, 'source', 'managed_child'))
      RETURNING id INTO _cid;
      _prev := 'required';
    ELSE
      UPDATE public.parental_consents
         SET status = 'approved', method = 'email_confirmation',
             parent_email = COALESCE(_parent_email, ''), parent_name = _parent_name,
             parent_user_id = _parent, relationship = _rel,
             approved_at = now(), revoked_at = NULL, revoked_reason = NULL,
             verification_token_hash = NULL, token_expires_at = NULL,
             terms_version = _terms, privacy_version = _privacy,
             scope = jsonb_build_object('guardian_attested', true, 'source', 'managed_child'),
             updated_at = now()
       WHERE id = _cid;
    END IF;

    INSERT INTO public.parental_consent_events
      (consent_id, child_user_id, actor_id, action, from_status, to_status, method, detail)
    VALUES (_cid, _child, _parent, 'consent_approved', COALESCE(_prev, 'required'), 'approved',
            'email_confirmation',
            jsonb_build_object('method', 'email_confirmation', 'source', 'managed_child',
                               'guardian_attested', true));
    _consent := true;
  END IF;

  -- 6. Guardian controls for every minor cohort (redeem_minor_invite only
  --    writes them where consent is required; a managed 16–17-year-old still
  --    needs a row for the guardian to manage). Column defaults are the safe
  --    starting point: guardian-only messaging, private media, games allowed.
  INSERT INTO public.child_controls (child_user_id, updated_by)
  VALUES (_child, _parent)
  ON CONFLICT (child_user_id) DO NOTHING;

  -- 7. Terms and Privacy accepted by the guardian on the child's behalf.
  INSERT INTO public.legal_consents (user_id, document_type, document_version, accepted_by, user_agent)
  VALUES (_child, 'terms', _terms, _parent, 'guardian-on-behalf'),
         (_child, 'privacy', _privacy, _parent, 'guardian-on-behalf')
  ON CONFLICT (user_id, document_type, document_version) DO NOTHING;

  INSERT INTO public.family_audit_log (actor_user_id, child_user_id, action, context)
  VALUES (_parent, _child, 'managed.created',
          jsonb_build_object('relationship', _rel, 'cohort', _cohort));

  -- Where consent was recorded, notify_on_consent_change() has already told
  -- the guardian; only the no-consent cohorts need their own notice.
  IF NOT _consent THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_parent, 'guardian_link', 'Child profile added',
            _name || '''s profile is ready. You manage it from your account.', '/parent');
  END IF;

  RETURN QUERY SELECT _cohort, _consent;
END $function$;

REVOKE ALL ON FUNCTION public.provision_managed_child(uuid, date, text, text, text, jsonb, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_managed_child(uuid, date, text, text, text, jsonb, boolean)
  TO authenticated, service_role;

-- ============ 4. the managing guardian cannot unlink a managed child ============

CREATE OR REPLACE FUNCTION public.revoke_guardian_link(_child_user_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent uuid := auth.uid();
BEGIN
  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.guardian_links
    WHERE parent_user_id = v_parent AND child_user_id = _child_user_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  -- Unlinking would drop the child from guardian_children_overview for the
  -- only adult who can reach a credential-less account. Deleting the child's
  -- profile is the supported way out.
  IF EXISTS (
    SELECT 1 FROM public.managed_accounts
    WHERE child_user_id = _child_user_id AND managed_by = v_parent
  ) THEN
    RAISE EXCEPTION 'MANAGED_CHILD_DELETE_INSTEAD';
  END IF;

  UPDATE public.guardian_links
  SET status = 'revoked'
  WHERE parent_user_id = v_parent AND child_user_id = _child_user_id AND status = 'active';

  UPDATE public.parental_consents
  SET status = 'revoked',
      revoked_at = now(),
      revoked_reason = coalesce(_reason, 'Guardian ended the family link'),
      updated_at = now()
  WHERE child_user_id = _child_user_id
    AND parent_user_id = v_parent
    AND status <> 'revoked';
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_guardian_link(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_guardian_link(uuid, text) TO authenticated, service_role;