-- Managed-account handover at 18 (owner instruction 2026-11-21: "do all 3 steps as your best recommendation").
-- docs/managed-account-handover.md has the scope, the flow, the inventory of every reader and the residual risk.
--
-- THE PROBLEM. A managed account (public.managed_accounts) has no sign-in of its own: the managing guardian is the only way
-- in. 20261125200000 (guardian links end at 18) deliberately does NOT end the link of a managed account that has turned
-- 18, because that would strand it; it only tells the managing guardian once. Nothing could give such an adult their own
-- account. This is that: a handover the guardian STARTS and the adult COMPLETES.
--
-- THE FLOW (the app side is src/lib/managed-handover.functions.ts; this file is the rules the database holds the app to)
--   1. start_managed_handover(guardian, child, adult's email, token hash)  [service role only: the app calls it for the
--      signed-in guardian, so the token never reaches the guardian's browser and the guardian cannot finish the handover
--      without receiving the email]. Only for a managed account whose person is a KNOWN ADULT (private_sec.is_known_adult). The email must be a plain
--      address that is not the guardian's own mailbox, not any existing account's, not another pending handover's. One
--      pending handover per account. Nothing about the account changes: it is managed and linked exactly as before.
--   2. The app emails the adult a one-time link (the plain token never reaches the database; only its hash does).
--   3. claim_managed_handover / finish_managed_handover  [service role only, called by the app when the adult follows the link]
--      The app first puts the adult's confirmed email on the sign-in record (auth Admin API), then finish_managed_handover
--      checks that it really is there, removes the managed_accounts row, ends the guardian link the way the 18 sweep ends it
--      (both sides told once), revokes every session and device pairing the account had, and closes the handover. Any
--      failure before that leaves the account managed and linked.
--   4. cancel_managed_handover (the guardian, signed in) and a daily expiry (7 days) close a pending handover with nothing changed.
--   Every step writes a family_audit_log row (started, refused, cancelled, expired, completed).
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   * It does not touch private_sec.end_adult_guardian_links or any #452 reader (the rollback of 20261125200000 checks those
--     definitions). Removing the managed row is what ends the managed exemption in private_sec.guardian_authority_ended; the
--     link rows are ended here at once (the same status change, audit trigger and notices as the sweep) instead of waiting
--     for the next daily run.
--   * It never starts for a minor or an unknown age, and nothing here can finalize for a minor: finish re-checks is_known_adult.
--   * It does not revoke or rewrite parental_consents, child_controls or legal_consents (history, as in #452).
--   * It stores no plain token and, once a handover ends, no email (only a short hash and the domain stay in the audit row).
--
--   * It does not stop a switched-in guardian from setting a password on a managed account (the app's pages do that); instead
--     completion REPLACES whatever password and one-time tokens the account holds (finish_managed_handover step 2b).
--
-- Rollback: docs/rollbacks/20261128100000_managed_account_handover.down.sql (guarded). It cannot un-complete a handover.

DO $guard$
BEGIN
  IF to_regprocedure('private_sec.is_known_adult(uuid)') IS NULL
     OR to_regclass('private_sec.guardian_link_age_events') IS NULL THEN
    RAISE EXCEPTION 'This migration needs 20261125200000_guardian_links_end_at_18 applied first.';
  END IF;
END
$guard$;

-- ============================================================ 1. the table
CREATE TABLE IF NOT EXISTS private_sec.managed_handovers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  managed_by     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled', 'expired')),
  email          text,
  email_hash     text NOT NULL,
  token_hash     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  claimed_at     timestamptz,
  ended_at       timestamptz,
  -- A pending handover holds its address and token hash; an ended one holds neither.
  CONSTRAINT managed_handovers_pending_has_secrets CHECK (status <> 'pending' OR (email IS NOT NULL AND token_hash IS NOT NULL)),
  CONSTRAINT managed_handovers_ended_has_none CHECK (status = 'pending' OR (email IS NULL AND token_hash IS NULL AND ended_at IS NOT NULL))
);
-- One pending handover per account, one waiting per address, and a token is unique.
CREATE UNIQUE INDEX IF NOT EXISTS managed_handovers_one_pending ON private_sec.managed_handovers (child_user_id) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS managed_handovers_pending_email ON private_sec.managed_handovers (email) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS managed_handovers_token ON private_sec.managed_handovers (token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS managed_handovers_managed_by ON private_sec.managed_handovers (managed_by, created_at DESC);
ALTER TABLE private_sec.managed_handovers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private_sec.managed_handovers FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE private_sec.managed_handovers IS
  'A guardian-started, adult-completed handover of a managed account. Not readable through the API: the guardian reads it through guardian_managed_handovers(), the app through the service-role functions. An ended row holds no address and no token.';

-- ============================================================ 2. helpers
-- The address as a mailbox: lower case, no +tag, and no dots for Gmail. Used only to refuse "the guardian's own mailbox"
-- (a best-effort test: it cannot know every provider's aliases).
CREATE OR REPLACE FUNCTION private_sec.handover_mailbox_key(_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN position('@' IN lower(btrim(COALESCE(_email, '')))) = 0 THEN lower(btrim(COALESCE(_email, '')))
    ELSE (CASE WHEN split_part(lower(btrim(_email)), '@', 2) IN ('gmail.com', 'googlemail.com')
               THEN replace(split_part(split_part(lower(btrim(_email)), '@', 1), '+', 1), '.', '')
               ELSE split_part(split_part(lower(btrim(_email)), '@', 1), '+', 1) END)
         || '@' ||
         (CASE WHEN split_part(lower(btrim(_email)), '@', 2) = 'googlemail.com' THEN 'gmail.com'
               ELSE split_part(lower(btrim(_email)), '@', 2) END)
  END;
$$;
REVOKE ALL ON FUNCTION private_sec.handover_mailbox_key(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private_sec.handover_mask_email(_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN _email IS NULL OR position('@' IN _email) < 2 THEN NULL
              ELSE left(_email, 1) || '***@' || split_part(_email, '@', 2) END;
$$;
REVOKE ALL ON FUNCTION private_sec.handover_mask_email(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private_sec.handover_display_name(_user uuid, _fallback text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE((SELECT NULLIF(btrim(p.display_name), '') FROM public.profiles p WHERE p.id = _user), _fallback);
$$;
REVOKE ALL ON FUNCTION private_sec.handover_display_name(uuid, text) FROM PUBLIC, anon, authenticated;

-- Close the pending handovers that ran out of time (all of them, or one account's). Nothing about the account changes;
-- the guardian is told once. A handover somebody is finishing right now (claimed in the last two minutes) is left alone.
CREATE OR REPLACE FUNCTION private_sec.expire_managed_handovers(_child uuid DEFAULT NULL, _limit integer DEFAULT 200)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r      record;
  _n     integer := 0;
  _cap   integer := LEAST(GREATEST(COALESCE(_limit, 200), 1), 1000);
BEGIN
  FOR r IN
    UPDATE private_sec.managed_handovers h
       SET status = 'expired', email = NULL, token_hash = NULL, claimed_at = NULL, ended_at = now()
     WHERE h.id IN (SELECT x.id FROM private_sec.managed_handovers x
                     WHERE x.status = 'pending' AND x.expires_at <= now()
                       AND (x.claimed_at IS NULL OR x.claimed_at < now() - interval '2 minutes')
                       AND (_child IS NULL OR x.child_user_id = _child)
                     ORDER BY x.expires_at
                     LIMIT _cap
                       FOR UPDATE SKIP LOCKED)
    RETURNING h.id, h.child_user_id, h.managed_by
  LOOP
    _n := _n + 1;
    INSERT INTO public.family_audit_log (actor_user_id, child_user_id, action, context)
    VALUES (NULL, r.child_user_id, 'managed.handover_expired', jsonb_build_object('handover_id', r.id));
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (r.managed_by, 'guardian_link', 'Handover not finished',
            private_sec.handover_display_name(r.child_user_id, 'Your family member')
            || '''s handover was not finished in time, so nothing changed and the account is still managed by you. You can start it again from the Parent Center.',
            '/parent');
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION private_sec.expire_managed_handovers(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('expire-managed-handovers', '51 4 * * *',
      $j$SELECT private_sec.expire_managed_handovers()$j$);
  ELSE
    RAISE NOTICE 'pg_cron is not installed: expire-managed-handovers not scheduled (every handover call expires what it meets; run private_sec.expire_managed_handovers() by hand)';
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'expire-managed-handovers not scheduled: %', SQLERRM;
END
$cron$;

-- ============================================================ 3. the guardian's side
-- What the Parent Center needs to decide whether to show "Hand over this account": one row per account the caller manages.
-- Answers only about the caller's own managed accounts (nobody else reads a pending handover).
CREATE OR REPLACE FUNCTION public.guardian_managed_handovers()
RETURNS TABLE (child_user_id uuid, display_name text, is_adult boolean, pending boolean, email_masked text,
               started_at timestamptz, expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.child_user_id,
         private_sec.handover_display_name(m.child_user_id, 'Child account'),
         private_sec.is_known_adult(m.child_user_id),
         h.id IS NOT NULL,
         private_sec.handover_mask_email(h.email),
         h.created_at,
         h.expires_at
    FROM public.managed_accounts m
    LEFT JOIN private_sec.managed_handovers h
           ON h.child_user_id = m.child_user_id AND h.status = 'pending' AND h.expires_at > now()
   WHERE auth.uid() IS NOT NULL AND m.managed_by = auth.uid()
   ORDER BY m.created_at, m.child_user_id;
$$;
REVOKE ALL ON FUNCTION public.guardian_managed_handovers() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.guardian_managed_handovers() TO authenticated;
COMMENT ON FUNCTION public.guardian_managed_handovers() IS
  'The caller''s managed accounts with whether the person is a known adult (a handover can start) and any pending handover (masked address, expiry). Answers only about the caller.';

-- Service role only, on purpose. The token is made on the server and only its hash is passed here, so it never reaches the
-- guardian's browser. If the guardian could call this directly with a token they chose, they could follow their own link
-- without receiving the email, and the emailed link would prove nothing about the mailbox. The app passes the signed-in
-- guardian's id (checked by its auth middleware); every rule about that guardian is still the database's.
CREATE OR REPLACE FUNCTION public.start_managed_handover(_guardian uuid, _child uuid, _email text, _token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _g_cohort     text; _g_review boolean; _g_suspended timestamptz; _g_email text; _g_confirmed timestamptz;
  _addr         text := lower(btrim(COALESCE(_email, '')));
  _key          text;
  _reason       text;
  _hash         text;
  _expires      timestamptz := now() + interval '7 days';
  _id           uuid;
BEGIN
  IF _guardian IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: sign in to hand over an account.';
  END IF;

  -- The guardian: the account that manages this person, an adult in good standing with a confirmed email, never itself a
  -- managed account (a managed account switched into by its guardian cannot hand anything over).
  SELECT p.age_cohort, p.age_review_required, p.suspended_at INTO _g_cohort, _g_review, _g_suspended
    FROM public.profiles p WHERE p.id = _guardian;
  SELECT u.email, u.email_confirmed_at INTO _g_email, _g_confirmed FROM auth.users u WHERE u.id = _guardian;
  IF COALESCE(_g_cohort, 'unknown') <> 'adult' OR COALESCE(_g_review, false) OR _g_suspended IS NOT NULL
     OR _g_confirmed IS NULL
     OR EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = _guardian)
     OR NOT EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = _child AND m.managed_by = _guardian) THEN
    RAISE EXCEPTION 'HANDOVER_NOT_ALLOWED: only the adult who manages this account can hand it over.';
  END IF;

  -- Only a known adult: a minor, and an unknown age, are refused (fail closed).
  IF NOT private_sec.is_known_adult(_child) THEN
    RAISE EXCEPTION 'HANDOVER_NOT_ADULT: an account can be handed over once its person is 18 or over.';
  END IF;

  -- Close every overdue handover, not only this account's: an overdue one for another account would otherwise keep its
  -- address reserved (the unique index and the 'taken' test below look at status only) until the daily sweep.
  PERFORM private_sec.expire_managed_handovers(NULL, 50);
  IF EXISTS (SELECT 1 FROM private_sec.managed_handovers h WHERE h.child_user_id = _child AND h.status = 'pending') THEN
    RAISE EXCEPTION 'HANDOVER_ALREADY_PENDING: a handover is already waiting for this account.';
  END IF;

  IF _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'HANDOVER_FAILED: the handover could not be started.';
  END IF;

  -- Limits: every start and every refused address counts, so the address check cannot be used to look people up.
  IF (SELECT count(*) FROM public.family_audit_log a
       WHERE a.actor_user_id = _guardian AND a.action IN ('managed.handover_started', 'managed.handover_refused')
         AND a.created_at > now() - interval '24 hours') >= 10
     OR (SELECT count(*) FROM public.family_audit_log a
          WHERE a.child_user_id = _child AND a.action = 'managed.handover_started'
            AND a.created_at > now() - interval '24 hours') >= 3 THEN
    RAISE EXCEPTION 'HANDOVER_LIMIT: too many handover attempts for now.';
  END IF;

  -- The address: a plain one.
  IF char_length(_addr) > 254 OR _addr !~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:]]+$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'HANDOVER_EMAIL_INVALID');
  END IF;
  _key := private_sec.handover_mailbox_key(_addr);
  _reason := CASE
    WHEN split_part(_addr, '@', 2) = 'managed.invalid' THEN 'unusable'
    WHEN _g_email IS NOT NULL AND private_sec.handover_mailbox_key(_g_email) = _key THEN 'own'
    -- The account's own current address is allowed: it is what a half-finished earlier attempt left on the sign-in record,
    -- and starting again must be able to recover (the app also puts the placeholder back; docs section 2a).
    WHEN EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = _addr AND u.id <> _child) THEN 'taken'
    WHEN EXISTS (SELECT 1 FROM private_sec.managed_handovers h WHERE h.status = 'pending' AND h.email = _addr) THEN 'taken'
    ELSE NULL END;
  _hash := left(encode(sha256(convert_to(_addr, 'UTF8')), 'hex'), 16);
  IF _reason IS NOT NULL THEN
    INSERT INTO public.family_audit_log (actor_user_id, child_user_id, action, context)
    -- A coarse reason only: the family audit log is readable by the child and the linked guardians, and the finer reason
    -- ('taken' covers both "has an account" and "another handover waits for this address") would say more than the
    -- start call's own generic answer does.
    VALUES (_guardian, _child, 'managed.handover_refused', jsonb_build_object('reason', 'refused'));
    RETURN jsonb_build_object('ok', false,
      'code', CASE WHEN _reason = 'own' THEN 'HANDOVER_EMAIL_IS_OWN' ELSE 'HANDOVER_EMAIL_UNUSABLE' END);
  END IF;

  BEGIN
    INSERT INTO private_sec.managed_handovers (child_user_id, managed_by, email, email_hash, token_hash, expires_at)
    VALUES (_child, _guardian, _addr, _hash, _token_hash, _expires)
    RETURNING id INTO _id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'HANDOVER_ALREADY_PENDING: a handover is already waiting for this account.';
  END;

  INSERT INTO public.family_audit_log (actor_user_id, child_user_id, action, context)
  VALUES (_guardian, _child, 'managed.handover_started',
          jsonb_build_object('handover_id', _id, 'expires_at', _expires,
                             'email_domain', split_part(_addr, '@', 2), 'email_hash', _hash));
  RETURN jsonb_build_object('ok', true, 'handover_id', _id, 'expires_at', _expires,
                            'email_masked', private_sec.handover_mask_email(_addr));
END $$;
REVOKE ALL ON FUNCTION public.start_managed_handover(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_managed_handover(uuid, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_managed_handover(_child uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _guardian uuid := auth.uid();
  _hid      uuid;
BEGIN
  IF _guardian IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: sign in to cancel a handover.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = _child AND m.managed_by = _guardian) THEN
    RAISE EXCEPTION 'HANDOVER_NOT_ALLOWED: only the adult who manages this account can cancel its handover.';
  END IF;
  PERFORM private_sec.expire_managed_handovers(_child);
  -- Not while the adult's step is running: it would change the account under it. The claim test is part of the UPDATE itself
  -- (not a separate check before it): a claim that commits while this waits for the row is seen again by the UPDATE's
  -- condition, so a claimed handover can never be cancelled underneath the adult's step.
  UPDATE private_sec.managed_handovers h
     SET status = 'cancelled', email = NULL, token_hash = NULL, claimed_at = NULL, ended_at = now()
   WHERE h.child_user_id = _child AND h.status = 'pending'
     AND (h.claimed_at IS NULL OR h.claimed_at <= now() - interval '2 minutes')
  RETURNING h.id INTO _hid;
  IF _hid IS NULL AND EXISTS (SELECT 1 FROM private_sec.managed_handovers h WHERE h.child_user_id = _child AND h.status = 'pending') THEN
    RAISE EXCEPTION 'HANDOVER_BUSY: the handover is being finished right now. Try again in a minute.';
  END IF;
  IF _hid IS NULL THEN RETURN false; END IF;
  INSERT INTO public.family_audit_log (actor_user_id, child_user_id, action, context)
  VALUES (_guardian, _child, 'managed.handover_cancelled', jsonb_build_object('handover_id', _hid));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.cancel_managed_handover(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_managed_handover(uuid) TO authenticated;

-- ============================================================ 4. the adult's side (service role: the app calls these)
-- A read for the landing page: who is handing over what, nothing that is not the token holder's to know.
CREATE OR REPLACE FUNCTION public.managed_handover_lookup(_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE h private_sec.managed_handovers%ROWTYPE;
BEGIN
  SELECT * INTO h FROM private_sec.managed_handovers x WHERE x.token_hash = _token_hash AND x.status = 'pending';
  IF NOT FOUND THEN RETURN jsonb_build_object('valid', false, 'code', 'HANDOVER_INVALID'); END IF;
  IF h.expires_at <= now() THEN RETURN jsonb_build_object('valid', false, 'code', 'HANDOVER_EXPIRED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = h.child_user_id AND m.managed_by = h.managed_by)
     OR NOT private_sec.is_known_adult(h.child_user_id) THEN
    RETURN jsonb_build_object('valid', false, 'code', 'HANDOVER_INVALID');
  END IF;
  RETURN jsonb_build_object('valid', true,
    'child_name', private_sec.handover_display_name(h.child_user_id, 'this account'),
    'guardian_name', private_sec.handover_display_name(h.managed_by, NULL),
    'email_masked', private_sec.handover_mask_email(h.email),
    'expires_at', h.expires_at);
END $$;
REVOKE ALL ON FUNCTION public.managed_handover_lookup(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.managed_handover_lookup(text) TO service_role;

-- Take the handover for this run (two minutes): one finisher at a time, and the guardian cannot cancel under it.
CREATE OR REPLACE FUNCTION public.claim_managed_handover(_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE h private_sec.managed_handovers%ROWTYPE;
BEGIN
  SELECT * INTO h FROM private_sec.managed_handovers x WHERE x.token_hash = _token_hash AND x.status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'HANDOVER_INVALID'); END IF;
  IF h.expires_at <= now() THEN
    PERFORM private_sec.expire_managed_handovers(h.child_user_id);
    RETURN jsonb_build_object('ok', false, 'code', 'HANDOVER_EXPIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = h.child_user_id AND m.managed_by = h.managed_by)
     OR NOT private_sec.is_known_adult(h.child_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'HANDOVER_INVALID');
  END IF;
  IF h.claimed_at IS NOT NULL AND h.claimed_at > now() - interval '2 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'HANDOVER_BUSY');
  END IF;
  -- The address may have been taken since the guardian typed it.
  IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = h.email AND u.id <> h.child_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'HANDOVER_EMAIL_UNUSABLE');
  END IF;
  UPDATE private_sec.managed_handovers SET claimed_at = now() WHERE id = h.id;
  RETURN jsonb_build_object('ok', true, 'handover_id', h.id, 'child_user_id', h.child_user_id,
                            'managed_by', h.managed_by, 'email', h.email);
END $$;
REVOKE ALL ON FUNCTION public.claim_managed_handover(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_managed_handover(text) TO service_role;

-- What the app needs to know to keep the sign-in record and the database in agreement (docs section 2a): does this account
-- still have its managed row, is a handover pending, is somebody finishing one this minute. Service role only, no secrets.
CREATE OR REPLACE FUNCTION public.managed_handover_state(_child uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'managed', EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = _child),
    'managed_by', (SELECT m.managed_by FROM public.managed_accounts m WHERE m.child_user_id = _child),
    'pending', EXISTS (SELECT 1 FROM private_sec.managed_handovers h WHERE h.child_user_id = _child AND h.status = 'pending'),
    'claim_live', EXISTS (SELECT 1 FROM private_sec.managed_handovers h
                           WHERE h.child_user_id = _child AND h.status = 'pending' AND h.claimed_at > now() - interval '2 minutes'));
$$;
REVOKE ALL ON FUNCTION public.managed_handover_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.managed_handover_state(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.release_managed_handover(_token_hash text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE private_sec.managed_handovers SET claimed_at = NULL WHERE token_hash = _token_hash AND status = 'pending';
$$;
REVOKE ALL ON FUNCTION public.release_managed_handover(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_managed_handover(text) TO service_role;

-- The only way a managed account stops being managed. Everything happens in this one transaction or nothing does.
CREATE OR REPLACE FUNCTION public.finish_managed_handover(_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  h        private_sec.managed_handovers%ROWTYPE;
  _email   text; _confirmed timestamptz; _meta jsonb;
  r        record;
  _name    text;
  _told    boolean := false;
  _sets    text;
BEGIN
  SELECT * INTO h FROM private_sec.managed_handovers x WHERE x.token_hash = _token_hash AND x.status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'HANDOVER_INVALID'); END IF;

  -- Claimed by this run, still inside its two minutes.
  IF h.claimed_at IS NULL OR h.claimed_at < now() - interval '2 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'HANDOVER_FAILED');
  END IF;
  -- Still the same managed account, still a known adult.
  IF NOT EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = h.child_user_id AND m.managed_by = h.managed_by)
     OR NOT private_sec.is_known_adult(h.child_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'HANDOVER_INVALID');
  END IF;
  -- The sign-in record must already carry the adult's confirmed address and no longer say "managed": that is what the
  -- adult completing the link does first. Without it nothing is finalized.
  SELECT u.email, u.email_confirmed_at, COALESCE(u.raw_app_meta_data, '{}'::jsonb) INTO _email, _confirmed, _meta
    FROM auth.users u WHERE u.id = h.child_user_id;
  IF lower(COALESCE(_email, '')) IS DISTINCT FROM h.email OR _confirmed IS NULL OR (_meta ->> 'managed') = 'true' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'HANDOVER_FAILED');
  END IF;

  -- 1. The account is no longer managed: from here the #452 rule says no guardian has authority over this adult.
  DELETE FROM public.managed_accounts WHERE child_user_id = h.child_user_id AND managed_by = h.managed_by;

  -- 2. The device paired to it, and every session it has (a session the guardian opened while switched in included).
  IF to_regclass('public.managed_device_pairings') IS NOT NULL THEN
    EXECUTE 'UPDATE public.managed_device_pairings SET status = ''revoked'', revoked_at = now() WHERE child_user_id = $1 AND status = ''linked'''
      USING h.child_user_id;
  END IF;
  DELETE FROM auth.refresh_tokens WHERE user_id::text = h.child_user_id::text;
  DELETE FROM auth.sessions WHERE user_id = h.child_user_id;

  -- 2b. Nothing the guardian could have planted while switched in survives. A managed account is meant to have no password,
  --     but only the app's pages keep a switched-in guardian from setting one; nothing in the database does. So here, in the
  --     same transaction: the stored password becomes a random one nobody knows (the adult sets theirs from the emailed
  --     sign-in link), every outstanding one-time token (a magic link the guardian made, an email-change or recovery token)
  --     and every extra identity (an OAuth account linked while switched in), second factor and phone number goes. Each
  --     step is skipped where the auth schema in use does not have the table or column.
  IF to_regprocedure('extensions.crypt(text, text)') IS NOT NULL AND to_regprocedure('extensions.gen_salt(text)') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'auth' AND c.table_name = 'users' AND c.column_name = 'encrypted_password') THEN
    EXECUTE 'UPDATE auth.users SET encrypted_password = extensions.crypt(gen_random_uuid()::text || gen_random_uuid()::text, extensions.gen_salt(''bf'')) WHERE id = $1'
      USING h.child_user_id;
  END IF;
  IF to_regclass('auth.one_time_tokens') IS NOT NULL THEN
    EXECUTE 'DELETE FROM auth.one_time_tokens WHERE user_id = $1' USING h.child_user_id;
  END IF;
  SELECT string_agg(format('%I = %L', c.column_name, ''), ', ') INTO _sets
    FROM information_schema.columns c
   WHERE c.table_schema = 'auth' AND c.table_name = 'users'
     AND c.column_name IN ('confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change_token_current',
                           'phone_change_token', 'reauthentication_token', 'email_change', 'phone_change');
  IF _sets IS NOT NULL THEN
    EXECUTE 'UPDATE auth.users SET ' || _sets || ' WHERE id = $1' USING h.child_user_id;
  END IF;
  SELECT string_agg(format('%I = NULL', c.column_name), ', ') INTO _sets
    FROM information_schema.columns c
   WHERE c.table_schema = 'auth' AND c.table_name = 'users' AND c.column_name IN ('phone', 'phone_confirmed_at');
  IF _sets IS NOT NULL THEN
    EXECUTE 'UPDATE auth.users SET ' || _sets || ' WHERE id = $1' USING h.child_user_id;
  END IF;
  DELETE FROM auth.identities WHERE user_id = h.child_user_id AND provider <> 'email';
  IF to_regclass('auth.mfa_factors') IS NOT NULL THEN
    EXECUTE 'DELETE FROM auth.mfa_factors WHERE user_id = $1' USING h.child_user_id;
  END IF;

  -- 3. The links end now, as the sweep ends them (its triggers write the family audit row and clear that guardian's
  --    approvals on requests that are not yet a place); recorded as 'ended' so a birthday correction that makes the person
  --    a minor again puts them back, as in 20261125200000.
  _name := private_sec.handover_display_name(h.child_user_id, 'Your family member');
  FOR r IN
    UPDATE public.guardian_links gl SET status = 'revoked'
     WHERE gl.child_user_id = h.child_user_id AND gl.status = 'active'
    RETURNING gl.parent_user_id
  LOOP
    INSERT INTO private_sec.guardian_link_age_events (child_user_id, parent_user_id, kind)
    VALUES (h.child_user_id, r.parent_user_id, 'ended')
    ON CONFLICT DO NOTHING;
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (r.parent_user_id, 'guardian_link', 'Account handed over',
            _name || ' now has their own sign-in. Your family link with them has ended, so they no longer appear in your Parent Center.',
            '/parent');
    IF r.parent_user_id = h.managed_by THEN _told := true; END IF;
  END LOOP;
  -- The managing guardian is told once, even if their link row was already gone or ended.
  IF NOT _told THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (h.managed_by, 'guardian_link', 'Account handed over',
            _name || ' now has their own sign-in. You no longer manage their account.', '/parent');
  END IF;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (h.child_user_id, 'guardian_link', 'This account is yours',
          'You now have your own sign-in. The link to the adult who managed this account has ended, so they can no longer see or change your account settings.',
          '/settings');

  -- 4. Close the handover and keep no address and no token.
  UPDATE private_sec.managed_handovers
     SET status = 'completed', email = NULL, token_hash = NULL, claimed_at = NULL, ended_at = now()
   WHERE id = h.id;
  INSERT INTO public.family_audit_log (actor_user_id, child_user_id, action, context)
  VALUES (h.child_user_id, h.child_user_id, 'managed.handover_completed',
          jsonb_build_object('handover_id', h.id, 'managed_by', h.managed_by, 'email_hash', h.email_hash));

  RETURN jsonb_build_object('ok', true, 'child_user_id', h.child_user_id);
END $$;
REVOKE ALL ON FUNCTION public.finish_managed_handover(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_managed_handover(text) TO service_role;
COMMENT ON FUNCTION public.finish_managed_handover(text) IS
  'Service role only. The one place a managed account stops being managed: needs a pending, claimed handover whose adult address is already confirmed on the sign-in record. Removes the managed row, revokes sessions and device pairings, ends the guardian link (both sides told once), closes the handover.';
