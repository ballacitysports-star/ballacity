-- Guardian becomes a first-class account type, alongside player/team/trainer/gym.
--
-- Choosing "Parent / Guardian" at sign-up has always been a UI-only role that
-- gets stored as account_type = 'player' (SETUPS.child.accountType in
-- src/lib/account-type.ts). That made a guardian's account indistinguishable
-- from a player's at the data level, and combined with a routing race
-- (postAuthDestination() resolves "does this account need a type" before "does
-- it have an unstarted setup", while account_type itself is written
-- asynchronously, not atomically at signup), could land a brand-new guardian
-- on the wrong screen. This migration removes the reason that race mattered,
-- the same way team/trainer/gym never had it: 'parent' becomes a real value,
-- not a label painted over 'player'.
--
-- Two CHECK constraints on profiles.account_type needed widening, not one:
-- profiles_account_type_check (named in 20260724193311, the one every prior
-- migration touching this column references) AND profiles_account_type_valid
-- — a second, functionally overlapping constraint applied directly to
-- production on 2026-07-25 with no file ever added for it, found only by
-- querying the live database while preparing this change and back-filled in
-- 20260725025124_profiles_account_type_valid.sql, which must apply before
-- this file. Dropping only the first and leaving the second in place would
-- have left 'parent' silently rejected.
--
-- account_profiles.kind carries the identical four-value list on a second
-- table (account_profiles_kind_check, unnamed at creation in 20260804040157 —
-- confirmed against the live schema as Postgres's own auto-generated name for
-- that inline column CHECK) and needs the same widening, plus a new partial
-- unique index mirroring account_profiles_player_uniq: at most one 'parent'
-- profile per user, just as there is at most one 'player' profile.
--
-- handle_new_user() has its own inline allow-list (not a DB constraint) that
-- SILENTLY NULLS an account_type it doesn't recognise rather than rejecting
-- it — without this fix, a 'parent' signup would quietly lose its type.
--
-- provision_managed_child() gains one new, idempotent insert: the guardian's
-- own account_profiles 'parent' row, created the moment they successfully add
-- their first child (not at signup, mirroring exactly how team/trainer/gym
-- profiles are created when their setup finishes, never at signup either).
-- Existing guardians (anyone already in managed_accounts) are backfilled
-- separately in 20261001140000_backfill_parent_account_profiles.sql.

-- ============ 1. Widen both profiles constraints ============

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_account_type_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_account_type_check
  CHECK (account_type IN ('player','team','trainer','gym','parent'));

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_account_type_valid;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_account_type_valid
  CHECK (account_type IS NULL OR account_type IN ('player','team','trainer','gym','parent'));

-- ============ 2. Widen account_profiles.kind ============

ALTER TABLE public.account_profiles DROP CONSTRAINT IF EXISTS account_profiles_kind_check;
ALTER TABLE public.account_profiles ADD CONSTRAINT account_profiles_kind_check
  CHECK (kind IN ('player','team','trainer','gym','parent'));

-- One active 'parent' profile per user, same shape as account_profiles_player_uniq.
CREATE UNIQUE INDEX IF NOT EXISTS account_profiles_parent_uniq
  ON public.account_profiles (user_id) WHERE kind = 'parent';

-- ============ 3. handle_new_user(): stop silently dropping 'parent' ============

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _type text;
BEGIN
  _type := NEW.raw_user_meta_data->>'account_type';
  IF _type IS NOT NULL AND _type NOT IN ('player','team','trainer','gym','parent') THEN
    _type := NULL;
  END IF;

  INSERT INTO public.profiles (id, display_name, avatar_initials, account_type)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1), 'Player'),
    UPPER(LEFT(COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'name', NEW.email, 'P'), 2)),
    -- Left NULL on purpose when metadata carries no type: that is what tells
    -- getOnboardingStatus the account still has to pick one. Onboarding sets it.
    _type
  );

  INSERT INTO public.privacy_preferences (user_id, profile_visibility)
  VALUES (NEW.id, public.default_profile_visibility_for(NEW.id))
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- ============ 4. provision_managed_child(): create the guardian's own profile row ============

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

  -- 1b. This guardian's own account_profiles row, the same way a team/trainer/
  --     gym profile is created once its setup finishes rather than at signup.
  --     Idempotent: the partial unique index on kind='parent' makes every
  --     later child a no-op here.
  INSERT INTO public.account_profiles (user_id, kind, ref_id)
  VALUES (_parent, 'parent', NULL)
  ON CONFLICT DO NOTHING;

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
