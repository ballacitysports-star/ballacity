-- R7: one backend authorization policy for contact between a minor (or a person of unknown age) and anyone else.
--
-- INTENDED POLICY (owner, 2026-11-04). Guardian-mediated messaging for minors is kept. Adult to adult is unchanged (blocks, privacy settings).
-- A stranger never reaches a minor directly. "Fail closed": an unknown age counts as a minor; missing authorization means refused.
--
-- CLOSES (the five exceptions of docs/privacy/r7-messaging-audit.md):
--   E1 an unlinked 16-17 year old can no longer be messaged by an unrelated adult;
--   E2 unrelated minors can no longer open conversations with each other;
--   E3 a guardian's "peers" setting never authorizes an adult; it can only authorize two minors who share a confirmed game and
--      whose guardians both chose "peers";
--   E4 sharing a public game never authorizes an adult to message a child; the contexts below replace "shares a game or chat";
--   E5 a minor contacting an adult (or another minor) through a post goes through a guardian: the request waits, invisible to the
--      recipient, until a verified guardian approves it. A minor with no linked guardian is refused with guidance to link one.
--
-- AUTHORIZED CONTEXTS (private_sec.messaging_connection): a verified guardian and their child; two members of the same team
-- (players, coaches, managers); a game's host and a confirmed participant; an organization's administrator and its member;
-- an accepted contact request that a verified guardian approved (and that guardian link is still active). Shared chat history is NOT
-- a context (it would authorize itself).
--
-- ENFORCED IN ONE PLACE. public.minor_messaging_block is the single decision used by create_direct_conversation (conversation creation) and by
-- the per-message trigger (sending, so guardian revocation, control changes and new rules apply inside existing conversations). Existing
-- messages stay readable; a conversation that is no longer authorized simply stops accepting new messages. Contact requests use the same
-- controls and contexts (guard_contact_request_minor_recipient), and public.can_notify (the gate for server-written notifications and
-- pushes) now applies the same test whenever a minor is involved, so an unauthorized person cannot place a notification in a child's inbox.
-- The age_policy flags child_adult_dm_requires_guardian_link and teen_adult_dm_requires_shared_context can no longer open adult-to-minor
-- messaging; the backend floor above does not depend on them.
--
-- NOT CHANGED: guardian controls (off, guardian only, teammates), blocks, the recipient's own privacy settings, existing rows.
-- Depends on 20261106100000 (R2). Replaces public.minor_messaging_block and public.can_notify (production definitions fingerprint-compared
-- 2026-11-04: md5 52f406f8... and d0d2e465...).

-- ---------------------------------------------------------------------------------------------------------------- columns
ALTER TABLE public.availability_contact_requests ADD COLUMN IF NOT EXISTS guardian_approved_by uuid;
ALTER TABLE public.availability_contact_requests ADD COLUMN IF NOT EXISTS guardian_approved_at timestamptz;

-- ---------------------------------------------------------------------------------------------------------------- helpers
CREATE OR REPLACE FUNCTION private_sec.has_guardian_link(_minor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.guardian_links gl
                  WHERE gl.child_user_id = _minor AND gl.status = 'active' AND gl.verified_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.managed_accounts ma WHERE ma.child_user_id = _minor)
$$;
REVOKE ALL ON FUNCTION private_sec.has_guardian_link(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.has_guardian_link(uuid) TO service_role;

CREATE OR REPLACE FUNCTION private_sec.messaging_connection(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT _a IS NOT NULL AND _b IS NOT NULL AND _a <> _b AND (
       public.is_guardian_of(_a, _b) OR public.is_guardian_of(_b, _a)
    OR public.shares_team(_a, _b)
    OR EXISTS (SELECT 1 FROM public.hosted_games g JOIN public.game_participants p ON p.game_id = g.id
                WHERE (g.host_id = _a AND p.user_id = _b) OR (g.host_id = _b AND p.user_id = _a))
    OR EXISTS (SELECT 1 FROM public.org_members m WHERE (m.user_id = _b AND public.is_trainer_org_admin(m.org_id, _a))
                                                       OR (m.user_id = _a AND public.is_trainer_org_admin(m.org_id, _b)))
    OR EXISTS (SELECT 1 FROM public.trainer_org_members m WHERE (m.user_id = _b AND public.is_trainer_org_admin(m.org_id, _a))
                                                              OR (m.user_id = _a AND public.is_trainer_org_admin(m.org_id, _b)))
    OR EXISTS (SELECT 1 FROM public.availability_contact_requests r
                WHERE r.status = 'accepted' AND r.guardian_approved_at IS NOT NULL
                  AND ((r.from_user_id = _a AND r.to_user_id = _b) OR (r.from_user_id = _b AND r.to_user_id = _a))
                  AND private_sec.has_guardian_link(r.from_user_id))
  )
$$;
REVOKE ALL ON FUNCTION private_sec.messaging_connection(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.messaging_connection(uuid, uuid) TO service_role;

-- Two minors whose guardians both chose "peers" and who share a confirmed game. Never involves an adult.
CREATE OR REPLACE FUNCTION private_sec.peer_game_context(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT COALESCE(public.age_cohort_of(_a), 'unknown') <> 'adult' AND COALESCE(public.age_cohort_of(_b), 'unknown') <> 'adult'
     AND EXISTS (SELECT 1 FROM public.child_controls c WHERE c.child_user_id = _a AND c.messaging = 'peers')
     AND EXISTS (SELECT 1 FROM public.child_controls c WHERE c.child_user_id = _b AND c.messaging = 'peers')
     AND EXISTS (SELECT 1 FROM public.game_participants pa JOIN public.game_participants pb ON pb.game_id = pa.game_id
                  WHERE pa.user_id = _a AND pb.user_id = _b)
$$;
REVOKE ALL ON FUNCTION private_sec.peer_game_context(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.peer_game_context(uuid, uuid) TO service_role;

-- Guardian-set controls only (unchanged rules, extracted so conversations, messages and contact requests share them).
CREATE OR REPLACE FUNCTION private_sec.messaging_controls_block(_a uuid, _b uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE ca text; cb text; ctrl text;
BEGIN
  ca := COALESCE(public.age_cohort_of(_a), 'unknown');
  cb := COALESCE(public.age_cohort_of(_b), 'unknown');
  IF ca IN ('child_under_13', 'teen_13_15', 'teen_16_17') THEN
    SELECT messaging INTO ctrl FROM public.child_controls WHERE child_user_id = _a;
    IF ctrl = 'off' THEN RETURN 'messaging_off:self'; END IF;
    IF ctrl = 'guardian_only' AND NOT public.is_guardian_of(_b, _a) THEN RETURN 'guardian_only:self'; END IF;
    IF ctrl = 'teammates' AND NOT public.is_guardian_of(_b, _a) AND NOT public.shares_team(_a, _b) THEN RETURN 'teammates_only:self'; END IF;
  END IF;
  IF cb IN ('child_under_13', 'teen_13_15', 'teen_16_17') THEN
    SELECT messaging INTO ctrl FROM public.child_controls WHERE child_user_id = _b;
    IF ctrl = 'off' THEN RETURN 'messaging_off:other'; END IF;
    IF ctrl = 'guardian_only' AND NOT public.is_guardian_of(_a, _b) THEN RETURN 'guardian_only:other'; END IF;
    IF ctrl = 'teammates' AND NOT public.is_guardian_of(_a, _b) AND NOT public.shares_team(_b, _a) THEN RETURN 'teammates_only:other'; END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private_sec.messaging_controls_block(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.messaging_controls_block(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------------------------------- the one decision
CREATE OR REPLACE FUNCTION public.minor_messaging_block(_a uuid, _b uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE ca text; cb text; ctl text; minor_a boolean; minor_b boolean;
BEGIN
  ca := COALESCE(public.age_cohort_of(_a), 'unknown');
  cb := COALESCE(public.age_cohort_of(_b), 'unknown');
  minor_a := ca <> 'adult';
  minor_b := cb <> 'adult';

  -- Guardian-set controls first, so a restricted child is never reachable through the contexts below.
  ctl := private_sec.messaging_controls_block(_a, _b);
  IF ctl IS NOT NULL THEN RETURN ctl; END IF;

  IF NOT minor_a AND NOT minor_b THEN RETURN NULL; END IF;     -- adult to adult: unchanged

  IF private_sec.messaging_connection(_a, _b) THEN RETURN NULL; END IF;
  IF private_sec.peer_game_context(_a, _b) THEN RETURN NULL; END IF;

  -- No authorized context. Say which side is the protected one, and give the fix when one exists.
  IF minor_a AND NOT minor_b THEN
    IF ca = 'child_under_13' THEN RETURN 'child_needs_guardian:self'; END IF;
    IF NOT private_sec.has_guardian_link(_a) THEN RETURN 'needs_guardian_link:self'; END IF;
    RETURN 'needs_connection:self';
  ELSIF minor_b AND NOT minor_a THEN
    IF cb = 'child_under_13' THEN RETURN 'child_needs_guardian:other'; END IF;
    IF NOT private_sec.has_guardian_link(_b) THEN RETURN 'needs_guardian_link:other'; END IF;
    RETURN 'needs_connection:other';
  END IF;
  -- two minors
  IF NOT private_sec.has_guardian_link(_a) THEN RETURN 'needs_guardian_link:self'; END IF;
  IF NOT private_sec.has_guardian_link(_b) THEN RETURN 'needs_guardian_link:other'; END IF;
  RETURN 'needs_connection:other';
END $function$;

-- --------------------------------------------------------------------------------------------------------- notifications
CREATE OR REPLACE FUNCTION public.can_notify(_caller uuid, _target uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    _caller IS NOT NULL AND _target IS NOT NULL AND (
      _caller = _target
      OR (
        NOT public.blocks_exist_between(_caller, _target)
        AND CASE
          -- someone who is not a confirmed adult is involved: only a guardian or an authorized context, or the host handling a request
          WHEN COALESCE(public.age_cohort_of(_caller), 'unknown') <> 'adult' OR COALESCE(public.age_cohort_of(_target), 'unknown') <> 'adult' THEN
            private_sec.messaging_connection(_caller, _target)
            OR EXISTS (SELECT 1 FROM public.join_requests jr
                        WHERE (jr.host_id = _caller AND jr.player_id = _target) OR (jr.host_id = _target AND jr.player_id = _caller))
          ELSE
            EXISTS (SELECT 1 FROM public.conversation_participants a
                      JOIN public.conversation_participants b ON b.conversation_id = a.conversation_id
                     WHERE a.user_id = _caller AND b.user_id = _target)
            OR EXISTS (SELECT 1 FROM public.join_requests jr
                        WHERE (jr.host_id = _caller AND jr.player_id = _target) OR (jr.host_id = _target AND jr.player_id = _caller))
            OR EXISTS (SELECT 1 FROM public.game_participants gp JOIN public.hosted_games hg ON hg.id = gp.game_id
                        WHERE (hg.host_id = _caller AND gp.user_id = _target) OR (hg.host_id = _target AND gp.user_id = _caller))
            OR EXISTS (SELECT 1 FROM public.game_participants a JOIN public.game_participants b ON b.game_id = a.game_id
                        WHERE a.user_id = _caller AND b.user_id = _target)
            OR EXISTS (SELECT 1 FROM public.availability_contact_requests acr
                        WHERE (acr.from_user_id = _caller AND acr.to_user_id = _target) OR (acr.from_user_id = _target AND acr.to_user_id = _caller))
        END
      )
    );
$function$;

-- --------------------------------------------------------------------------------------------------------- contact requests
CREATE OR REPLACE FUNCTION public.guard_contact_request_minor_recipient()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cf text; _ct text; _block text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;   -- service-role maintenance
  _cf := COALESCE(public.age_cohort_of(NEW.from_user_id), 'unknown');
  _ct := COALESCE(public.age_cohort_of(NEW.to_user_id), 'unknown');
  _block := private_sec.messaging_controls_block(NEW.from_user_id, NEW.to_user_id);
  IF _block IS NULL AND (_cf <> 'adult' OR _ct <> 'adult') THEN
    IF _cf = 'adult' THEN
      -- an adult asking a minor: only inside an authorized context, never as a stranger
      IF NOT private_sec.messaging_connection(NEW.from_user_id, NEW.to_user_id) THEN
        _block := CASE WHEN _ct = 'child_under_13' THEN 'child_needs_guardian:other'
                       WHEN NOT private_sec.has_guardian_link(NEW.to_user_id) THEN 'needs_guardian_link:other'
                       ELSE 'needs_connection:other' END;
      END IF;
    ELSE
      -- a minor asking anyone: needs a linked guardian, who approves it (see the gate trigger); asking another minor also needs a context
      IF NOT private_sec.has_guardian_link(NEW.from_user_id) THEN
        _block := 'needs_guardian_link:self';
      ELSIF _ct <> 'adult' AND NOT private_sec.messaging_connection(NEW.from_user_id, NEW.to_user_id) THEN
        _block := 'needs_connection:other';
      END IF;
    END IF;
  END IF;
  IF _block IS NOT NULL THEN
    RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED:%', _block USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- Runs after the validator (which forces 'pending'): a request from a non-adult waits for a guardian and is invisible to the recipient.
CREATE OR REPLACE FUNCTION public.gate_contact_request_for_guardian()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND COALESCE(public.age_cohort_of(NEW.from_user_id), 'unknown') <> 'adult' THEN
    NEW.status := 'awaiting_guardian';
    NEW.guardian_approved_by := NULL;
    NEW.guardian_approved_at := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.gate_contact_request_for_guardian() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gate_contact_request_for_guardian() TO service_role;
DROP TRIGGER IF EXISTS zz_gate_contact_request_for_guardian_trg ON public.availability_contact_requests;
CREATE TRIGGER zz_gate_contact_request_for_guardian_trg BEFORE INSERT ON public.availability_contact_requests
  FOR EACH ROW EXECUTE FUNCTION public.gate_contact_request_for_guardian();

CREATE OR REPLACE FUNCTION public.notify_guardians_of_contact_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NEW.status = 'awaiting_guardian' THEN
    PERFORM public.notify_guardians_of(NEW.from_user_id, 'guardian_approval', 'Approval needed',
      'Your child asked to contact another player. Open Guardian to approve or decline. Nothing is sent until you approve.', '/guardian');
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.notify_guardians_of_contact_request() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_guardians_of_contact_request() TO service_role;
DROP TRIGGER IF EXISTS zz_notify_guardians_of_contact_request_trg ON public.availability_contact_requests;
CREATE TRIGGER zz_notify_guardians_of_contact_request_trg AFTER INSERT ON public.availability_contact_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_guardians_of_contact_request();

CREATE OR REPLACE FUNCTION public.guardian_decide_contact_request(_request uuid, _approve boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _r record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT * INTO _r FROM public.availability_contact_requests WHERE id = _request AND status = 'awaiting_guardian';
  IF NOT FOUND OR NOT public.is_guardian_of(auth.uid(), _r.from_user_id) THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND: nothing to decide.' USING ERRCODE = 'no_data_found';
  END IF;
  IF _approve THEN
    UPDATE public.availability_contact_requests
       SET status = 'pending', guardian_approved_by = auth.uid(), guardian_approved_at = now() WHERE id = _request;
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_r.to_user_id, 'contact_request', 'You have a new request', 'A player sent you a request. Open your requests to answer it.', '/messages');
  ELSE
    UPDATE public.availability_contact_requests SET status = 'withdrawn' WHERE id = _request;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.guardian_decide_contact_request(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardian_decide_contact_request(uuid, boolean) TO authenticated, service_role;

-- Recipients never see a request that is still waiting for a guardian; a guardian sees their child's requests.
DROP POLICY IF EXISTS "Sender or recipient can read" ON public.availability_contact_requests;
CREATE POLICY "Sender, released recipient or guardian can read" ON public.availability_contact_requests FOR SELECT TO authenticated
  USING (from_user_id = auth.uid()
         OR (to_user_id = auth.uid() AND status <> 'awaiting_guardian')
         OR public.is_guardian_of(auth.uid(), from_user_id));
DROP POLICY IF EXISTS "Recipient updates status" ON public.availability_contact_requests;
CREATE POLICY "Recipient updates status" ON public.availability_contact_requests FOR UPDATE TO authenticated
  USING (to_user_id = auth.uid() AND status <> 'awaiting_guardian')
  WITH CHECK (to_user_id = auth.uid() AND status <> 'awaiting_guardian');
