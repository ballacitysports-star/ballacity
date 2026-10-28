-- Let a guardian start a conversation with their own 13-15 year old.
--
-- Found by the minor-messaging SQL test (120_minor_messaging): the adult <->
-- 13-15 branch of `minor_messaging_block` asks for a shared game or an existing
-- chat and has no guardian exemption, unlike the adult <-> under-13 branch just
-- above it. So a parent whose 14-year-old has no game with them in common was
-- refused ("teen_needs_shared_game") when they tried to message their own child.
-- The failure is on the safe side (it blocks, it never exposes), but it defeats
-- the point of the guardian link.
--
-- The only change is the three-line guardian check in that branch. Every other
-- branch, ordering and flag default is transcribed unchanged from
-- 20261014130000_minor_messaging_block_side.sql. A guardian is someone with an
-- active, verified link (`is_guardian_of`), so a stranger gains nothing.
--
-- ROLLBACK: re-run the `minor_messaging_block` definition from
-- 20261014130000_minor_messaging_block_side.sql. Nothing else depends on this
-- change; no data is touched.

CREATE OR REPLACE FUNCTION public.minor_messaging_block(_a uuid, _b uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE ca text; cb text; ctrl text; side text;
BEGIN
  ca := public.age_cohort_of(_a);
  cb := public.age_cohort_of(_b);

  -- Guardian-set controls, checked first so a restricted child is never
  -- reachable through the shared-context fallbacks further down.
  IF ca IN ('child_under_13','teen_13_15','teen_16_17') THEN
    SELECT messaging INTO ctrl FROM public.child_controls WHERE child_user_id = _a;
    IF ctrl = 'off' THEN RETURN 'messaging_off:self'; END IF;
    IF ctrl = 'guardian_only' AND NOT public.is_guardian_of(_b, _a) THEN
      RETURN 'guardian_only:self';
    END IF;
    IF ctrl = 'teammates'
       AND NOT public.is_guardian_of(_b, _a)
       AND NOT public.shares_team(_a, _b) THEN RETURN 'teammates_only:self'; END IF;
  END IF;
  IF cb IN ('child_under_13','teen_13_15','teen_16_17') THEN
    SELECT messaging INTO ctrl FROM public.child_controls WHERE child_user_id = _b;
    IF ctrl = 'off' THEN RETURN 'messaging_off:other'; END IF;
    IF ctrl = 'guardian_only' AND NOT public.is_guardian_of(_a, _b) THEN
      RETURN 'guardian_only:other';
    END IF;
    IF ctrl = 'teammates'
       AND NOT public.is_guardian_of(_a, _b)
       AND NOT public.shares_team(_b, _a) THEN RETURN 'teammates_only:other'; END IF;
  END IF;

  -- Adult <-> under-13. The side is the child's.
  IF (ca = 'child_under_13' AND cb = 'adult') OR (cb = 'child_under_13' AND ca = 'adult') THEN
    side := CASE WHEN ca = 'child_under_13' THEN 'self' ELSE 'other' END;
    IF public.is_guardian_of(CASE WHEN ca = 'child_under_13' THEN _b ELSE _a END,
                             CASE WHEN ca = 'child_under_13' THEN _a ELSE _b END) THEN
      RETURN NULL;
    END IF;
    IF public.age_policy_flag('child_adult_dm_requires_guardian_link', true) THEN
      RETURN 'child_needs_guardian:' || side;
    END IF;
    IF public.shares_game_or_chat(_a, _b) THEN RETURN NULL; END IF;
    RETURN 'child_needs_shared_game:' || side;
  END IF;

  -- Adult <-> 13-15 requires a shared game or an existing conversation. The
  -- side is the teen's.
  IF (ca = 'teen_13_15' AND cb = 'adult') OR (cb = 'teen_13_15' AND ca = 'adult') THEN
    -- A guardian never needs a shared game to reach their own child.
    IF public.is_guardian_of(CASE WHEN ca = 'teen_13_15' THEN _b ELSE _a END,
                             CASE WHEN ca = 'teen_13_15' THEN _a ELSE _b END) THEN
      RETURN NULL;
    END IF;
    IF public.age_policy_flag('teen_adult_dm_requires_shared_context', true) THEN
      IF public.shares_game_or_chat(_a, _b) THEN RETURN NULL; END IF;
      RETURN 'teen_needs_shared_game:' || CASE WHEN ca = 'teen_13_15' THEN 'self' ELSE 'other' END;
    END IF;
    RETURN NULL;
  END IF;

  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION public.minor_messaging_block(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minor_messaging_block(uuid, uuid) TO authenticated, service_role;
