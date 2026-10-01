-- Device pairing: let a managed child use their own device, without a login.
--
-- Today the only way to reach a managed child's profile is the guardian's own
-- browser swapping identities (src/lib/managed-session.ts) — the guardian has
-- to hand over their phone every time. This adds a second, independent path to
-- the SAME credential-less auth user: the guardian generates a short code in
-- the Parent Center; the child's own device enters it once and holds its own
-- standing session from then on, until the guardian revokes it. No password or
-- PIN is ever created for the child — this is not a login, just a second way
-- to reach the one the guardian already made.
--
-- What is new here:
--   * managed_device_pairings — one row per pairing attempt. At most one row
--     with status 'linked' per child (the partial unique index below), so
--     pairing a new device always supersedes the last one — there is no
--     "which of several devices" question, because nothing in Supabase's
--     Admin API can revoke one session without already holding its own JWT
--     (confirmed: admin signOut takes a JWT, not a user id or session id).
--     Revoking therefore always means "every session this child currently
--     has, everywhere" — the app layer (see createDevicePairing /
--     revokeDevicePairing in src/lib/device-pairing.functions.ts) enforces
--     that by banning and un-banning the child's auth user with the service
--     role; this migration only tracks the bookkeeping these functions read.
--   * create_device_pairing() — guardian-only, mirrors provision_managed_child's
--     guardian-validity checks. Supersedes any existing pairing for that child.
--   * lookup_device_pairing() — read-only, callable with no caller identity at
--     all (the child's device has no session yet to look up a code with). It
--     never marks anything used, so a flaky retry can't burn the code.
--   * confirm_device_pairing() — called by the child's own session, once it
--     exists, purely for accurate bookkeeping ("paired since …" in the Parent
--     Center). Not load-bearing for access: the session already exists either
--     way, this only makes the UI honest about whether it was actually used.
--   * revoke_device_pairing() — guardian-only, marks the pairing revoked.

-- ============ 1. managed_device_pairings ============

CREATE TABLE IF NOT EXISTS public.managed_device_pairings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  device_label text,
  code_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'linked' CHECK (status IN ('linked', 'revoked')),
  expires_at timestamptz NOT NULL,
  paired_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One active pairing at a time, enforced at the DB level the same way
-- managed_accounts.child_user_id (a primary key) enforces one guardian per
-- child.
CREATE UNIQUE INDEX IF NOT EXISTS managed_device_pairings_one_active_idx
  ON public.managed_device_pairings (child_user_id) WHERE status = 'linked';

CREATE INDEX IF NOT EXISTS managed_device_pairings_created_by_idx
  ON public.managed_device_pairings (created_by, created_at DESC);

ALTER TABLE public.managed_device_pairings ENABLE ROW LEVEL SECURITY;

-- Rows are written only by the SECURITY DEFINER functions below. Nobody
-- writes them through the API — same shape as managed_accounts. The child is
-- deliberately left out of the SELECT policy: nothing in the child's own UI
-- reads this table, the Parent Center is where pairing state is shown.
REVOKE ALL ON public.managed_device_pairings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.managed_device_pairings TO authenticated;
GRANT ALL ON public.managed_device_pairings TO service_role;

DROP POLICY IF EXISTS "Device pairings visible to the managing guardian and moderators" ON public.managed_device_pairings;
CREATE POLICY "Device pairings visible to the managing guardian and moderators"
  ON public.managed_device_pairings FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR public.is_moderator(auth.uid())
  );

-- ============ 2. create_device_pairing ============

CREATE OR REPLACE FUNCTION public.create_device_pairing(
  _child_user_id uuid,
  _code_hash text,
  _device_label text DEFAULT NULL,
  _ttl_minutes int DEFAULT 10
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _guardian uuid := auth.uid();
  _guardian_cohort text; _guardian_review boolean; _guardian_suspended timestamptz;
  _guardian_confirmed timestamptz;
  _id uuid;
BEGIN
  IF _guardian IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: sign in to pair a device.';
  END IF;

  -- Same guardian-validity bar as provision_managed_child(): a verified adult
  -- in good standing, never itself a managed account.
  SELECT p.age_cohort, p.age_review_required, p.suspended_at
    INTO _guardian_cohort, _guardian_review, _guardian_suspended
    FROM public.profiles p WHERE p.id = _guardian;
  SELECT u.email_confirmed_at INTO _guardian_confirmed FROM auth.users u WHERE u.id = _guardian;
  IF COALESCE(_guardian_cohort, 'unknown') <> 'adult'
     OR COALESCE(_guardian_review, false)
     OR _guardian_suspended IS NOT NULL
     OR _guardian_confirmed IS NULL
     OR EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = _guardian) THEN
    RAISE EXCEPTION 'ADULT_REQUIRED: only a verified adult account can pair a device.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.managed_accounts
    WHERE child_user_id = _child_user_id AND managed_by = _guardian
  ) THEN
    RAISE EXCEPTION 'NOT_MANAGED: that profile is not managed by your account.';
  END IF;

  IF _code_hash IS NULL OR length(_code_hash) <> 64 THEN
    RAISE EXCEPTION 'PAIRING_INVALID: could not create a pairing code.';
  END IF;
  IF COALESCE(_ttl_minutes, 0) <= 0 OR _ttl_minutes > 60 THEN
    RAISE EXCEPTION 'PAIRING_INVALID: invalid pairing code lifetime.';
  END IF;

  -- One active pairing at a time: creating a new one supersedes the last. A
  -- distinct audit action from revoke_device_pairing's 'device_pairing.revoked'
  -- — this wasn't the guardian choosing to end access, just the side effect of
  -- re-pairing — so a later read of the log can tell the two apart.
  IF EXISTS (
    SELECT 1 FROM public.managed_device_pairings
    WHERE child_user_id = _child_user_id AND status = 'linked'
  ) THEN
    UPDATE public.managed_device_pairings
       SET status = 'revoked', revoked_at = now(), revoked_by = _guardian
     WHERE child_user_id = _child_user_id AND status = 'linked';
    INSERT INTO public.family_audit_log (actor_user_id, child_user_id, action, context)
    VALUES (_guardian, _child_user_id, 'device_pairing.superseded', '{}'::jsonb);
  END IF;

  INSERT INTO public.managed_device_pairings
    (child_user_id, created_by, device_label, code_hash, expires_at)
  VALUES
    (_child_user_id, _guardian, NULLIF(btrim(COALESCE(_device_label, '')), ''),
     _code_hash, now() + (_ttl_minutes || ' minutes')::interval)
  RETURNING id INTO _id;

  INSERT INTO public.family_audit_log (actor_user_id, child_user_id, action, context)
  VALUES (_guardian, _child_user_id, 'device_pairing.created',
          jsonb_build_object('device_label', _device_label));

  RETURN _id;
END $function$;

REVOKE ALL ON FUNCTION public.create_device_pairing(uuid, text, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_device_pairing(uuid, text, text, int) TO authenticated, service_role;

-- ============ 3. lookup_device_pairing ============
--
-- Read-only, never marks anything used. The ONLY function in this file (or
-- this app) meant to be called with no caller identity at all — the device
-- redeeming a code has no session yet to have an identity. It still requires
-- no special grant beyond the usual authenticated/service_role pair: the
-- server function that calls it (lookupDevicePairing, uncovered by
-- requireSupabaseAuth) uses the service-role client, not an anon-key one.

CREATE OR REPLACE FUNCTION public.lookup_device_pairing(_code_hash text)
RETURNS TABLE(child_user_id uuid, state text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _row public.managed_device_pairings%ROWTYPE;
BEGIN
  SELECT * INTO _row FROM public.managed_device_pairings WHERE code_hash = _code_hash;
  IF _row.id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 'invalid'::text;
    RETURN;
  END IF;
  IF _row.status = 'revoked' THEN
    RETURN QUERY SELECT _row.child_user_id, 'revoked'::text;
    RETURN;
  END IF;
  IF _row.paired_at IS NOT NULL THEN
    RETURN QUERY SELECT _row.child_user_id, 'used'::text;
    RETURN;
  END IF;
  IF _row.expires_at < now() THEN
    RETURN QUERY SELECT _row.child_user_id, 'expired'::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT _row.child_user_id, 'linked'::text;
END $function$;

REVOKE ALL ON FUNCTION public.lookup_device_pairing(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_device_pairing(text) TO authenticated, service_role;

-- ============ 4. confirm_device_pairing ============

CREATE OR REPLACE FUNCTION public.confirm_device_pairing()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _child uuid := auth.uid();
  _id uuid;
BEGIN
  IF _child IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: sign in first.';
  END IF;

  UPDATE public.managed_device_pairings
     SET paired_at = now()
   WHERE child_user_id = _child AND status = 'linked' AND paired_at IS NULL
   RETURNING id INTO _id;

  IF _id IS NULL THEN
    -- Already confirmed, revoked, or this session isn't a managed child at
    -- all. Not an error: confirmation is bookkeeping, not what grants
    -- access — the session already exists either way by the time this runs.
    RETURN false;
  END IF;

  INSERT INTO public.family_audit_log (actor_user_id, child_user_id, action, context)
  VALUES (_child, _child, 'device_pairing.confirmed', '{}'::jsonb);

  RETURN true;
END $function$;

REVOKE ALL ON FUNCTION public.confirm_device_pairing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_device_pairing() TO authenticated, service_role;

-- ============ 5. revoke_device_pairing ============

CREATE OR REPLACE FUNCTION public.revoke_device_pairing(_child_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _guardian uuid := auth.uid();
  _id uuid;
BEGIN
  IF _guardian IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: sign in first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.managed_accounts
    WHERE child_user_id = _child_user_id AND managed_by = _guardian
  ) THEN
    RAISE EXCEPTION 'NOT_MANAGED: that profile is not managed by your account.';
  END IF;

  UPDATE public.managed_device_pairings
     SET status = 'revoked', revoked_at = now(), revoked_by = _guardian
   WHERE child_user_id = _child_user_id AND status = 'linked'
   RETURNING id INTO _id;

  IF _id IS NULL THEN
    RAISE EXCEPTION 'PAIRING_NOT_FOUND: no device is currently paired.';
  END IF;

  INSERT INTO public.family_audit_log (actor_user_id, child_user_id, action, context)
  VALUES (_guardian, _child_user_id, 'device_pairing.revoked', '{}'::jsonb);

  RETURN true;
END $function$;

REVOKE ALL ON FUNCTION public.revoke_device_pairing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_device_pairing(uuid) TO authenticated, service_role;
