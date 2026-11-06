-- P3-7: telemetry age-gating. No minor's row keeps a user id, a full user agent or free text.
--
-- Two telemetry tables take rows straight from the client:
--   * location_denial_events (a location prompt was refused or failed), and
--   * auth_signin_events (sign-in attempts, popups blocked, failures).
-- Each row can carry user_id, the full navigator.userAgent and a free-text message
-- or error. Product analytics in the app is already adults-only (src/lib/analytics.ts);
-- these two tables were not.
--
-- From now on, a BEFORE INSERT trigger anonymises any row written by, or naming, an
-- account that is not a confirmed adult (minors and accounts of unknown age):
-- user_id, user_agent and the free-text field are cleared. The event, reason and
-- the coarse fields the dashboards count by (browser family, platform, viewport,
-- sport, permission state) stay. Adults' rows are unchanged. Signed-out rows name no
-- account, but their age is unknown too, so they keep no full user agent either
-- (owner decision, 2026-11-06); their other fields are kept.
--
-- The trigger applies to every writer, including the service role. Existing rows of
-- minors and unknown-age accounts are anonymised the same way below.
-- Rollback: docs/rollbacks/20261106200000_telemetry_age_gating.down.sql (it removes the
-- triggers; it cannot restore what was cleared).

CREATE OR REPLACE FUNCTION private_sec.telemetry_subject_is_adult(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(public.age_cohort_of(_uid) = 'adult', false)
$$;

REVOKE ALL ON FUNCTION private_sec.telemetry_subject_is_adult(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private_sec.anonymise_minor_location_denial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := COALESCE(NEW.user_id, auth.uid());
BEGIN
  IF _uid IS NOT NULL AND private_sec.telemetry_subject_is_adult(_uid) THEN
    RETURN NEW;
  END IF;
  -- Not a confirmed adult, or signed out (age unknown): no full user agent.
  NEW.user_agent := NULL;
  IF _uid IS NULL THEN
    RETURN NEW;
  END IF;
  NEW.user_id := NULL;
  NEW.message := NULL;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION private_sec.anonymise_minor_signin_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := COALESCE(NEW.user_id, auth.uid());
BEGIN
  IF _uid IS NOT NULL AND private_sec.telemetry_subject_is_adult(_uid) THEN
    RETURN NEW;
  END IF;
  -- Not a confirmed adult, or signed out (age unknown): no full user agent.
  NEW.user_agent := NULL;
  IF _uid IS NULL THEN
    RETURN NEW;
  END IF;
  NEW.user_id := NULL;
  NEW.error_message := NULL;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION private_sec.anonymise_minor_location_denial() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_sec.anonymise_minor_signin_event() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS aa_anonymise_minor_location_denial ON public.location_denial_events;
CREATE TRIGGER aa_anonymise_minor_location_denial
  BEFORE INSERT OR UPDATE ON public.location_denial_events
  FOR EACH ROW EXECUTE FUNCTION private_sec.anonymise_minor_location_denial();

DROP TRIGGER IF EXISTS aa_anonymise_minor_signin_event ON public.auth_signin_events;
CREATE TRIGGER aa_anonymise_minor_signin_event
  BEFORE INSERT OR UPDATE ON public.auth_signin_events
  FOR EACH ROW EXECUTE FUNCTION private_sec.anonymise_minor_signin_event();

-- Existing rows that name a minor or an account of unknown age.
UPDATE public.location_denial_events e
SET user_id = NULL, user_agent = NULL, message = NULL
WHERE e.user_id IS NOT NULL AND NOT private_sec.telemetry_subject_is_adult(e.user_id);

UPDATE public.auth_signin_events e
SET user_id = NULL, user_agent = NULL, error_message = NULL
WHERE e.user_id IS NOT NULL AND NOT private_sec.telemetry_subject_is_adult(e.user_id);

-- Existing signed-out rows: no full user agent.
UPDATE public.location_denial_events SET user_agent = NULL
WHERE user_id IS NULL AND user_agent IS NOT NULL;
UPDATE public.auth_signin_events SET user_agent = NULL
WHERE user_id IS NULL AND user_agent IS NOT NULL;
