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
-- AUTHORIZED CONTEXTS (private_sec.messaging_connection): a verified guardian and their child; two members of the same team whose
-- memberships both count (an adult owner or an adult who accepted an invitation; a non-adult only through an accepted invitation a
-- currently verified guardian approved; never a direct roster add); an adult host and a participant of an approved request (guardian-approved
-- for a non-adult) until 30 days after the game; an accepted contact request from a non-adult that their verified guardian approved (and that
-- guardian link is still active). Organization membership and shared chat history are NOT contexts.
-- Review round 4 (2026-11-05, section at the end of this file): join-request approvals are server-written only, can_notify's join-request
-- branch obeys controls and the under-13 rule, direct roster adds of unknown ages are refused, family invitations cannot create a guardian
-- without an existing guardian's approval, and contact requests from adults cannot carry guardian columns.
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
-- Dependency guard: fail loudly, before changing anything, if a migration this one needs has not been applied (plpgsql bodies would otherwise fail only at user time).
DO $guard$ BEGIN
  IF to_regprocedure('private_sec.can_see_minor_name(uuid,uuid)') IS NULL OR to_regprocedure('public.minor_messaging_block(uuid,uuid)') IS NULL OR to_regprocedure('public.can_notify(uuid,uuid)') IS NULL OR to_regprocedure('private_sec.availability_post_visible(uuid)') IS NULL OR to_regprocedure('public.guard_contact_request_minor_recipient()') IS NULL THEN
    RAISE EXCEPTION 'R7: a required earlier release migration has not been applied (see docs/release/youth-privacy-release-runbook.md, sections 2 and 16)';
  END IF;
END $guard$;


ALTER TABLE public.availability_contact_requests ADD COLUMN IF NOT EXISTS guardian_approved_by uuid;
ALTER TABLE public.availability_contact_requests ADD COLUMN IF NOT EXISTS guardian_approved_at timestamptz;
ALTER TABLE public.availability_contact_requests ADD COLUMN IF NOT EXISTS needs_guardian boolean NOT NULL DEFAULT false;
-- Requests sent by a non-adult before this migration were never guardian-approved: they stay out of sight and can never become a context.
UPDATE public.availability_contact_requests r SET needs_guardian = true
 WHERE r.needs_guardian = false AND COALESCE(public.age_cohort_of(r.from_user_id), 'unknown') <> 'adult';

-- ---------------------------------------------------------------------------------------------------------------- helpers
CREATE OR REPLACE FUNCTION private_sec.has_guardian_link(_minor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.guardian_links gl
                  WHERE gl.child_user_id = _minor AND gl.status = 'active' AND gl.verified_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.managed_accounts ma WHERE ma.child_user_id = _minor)
$$;
REVOKE ALL ON FUNCTION private_sec.has_guardian_link(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.has_guardian_link(uuid) TO service_role;

-- Review round 4 (F3, F5): which team memberships count as a messaging context when a non-adult is involved. A roster row alone does not:
-- a manager can write one directly (any adult or teen can create a team), so it proves no consent. Only these count:
--   * an ADULT: the team's owner, or someone who accepted an invitation to that team themselves;
--   * anyone else (minor or unknown age): an accepted invitation to that team that a CURRENTLY verified guardian approved (guardian
--     revocation ends it). An unlinked minor, a minor team owner and a directly added member never count.
-- team_invites cannot be written by clients (team_invites_no_direct_insert / _update); only the definer invite functions write them.
CREATE OR REPLACE FUNCTION private_sec.team_membership_authorizes(_team text, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT CASE WHEN COALESCE(public.age_cohort_of(_user), 'unknown') = 'adult' THEN
           EXISTS (SELECT 1 FROM public.teams t WHERE t.id = _team AND t.owner_id = _user)
           OR EXISTS (SELECT 1 FROM public.team_invites i WHERE i.team_id = _team AND i.invitee_id = _user AND i.status = 'accepted')
         ELSE
           EXISTS (SELECT 1 FROM public.team_invites i
                    WHERE i.team_id = _team AND i.invitee_id = _user AND i.status = 'accepted'
                      AND i.guardian_approved_at IS NOT NULL AND public.is_guardian_of(i.guardian_approved_by, _user))
         END
$$;
REVOKE ALL ON FUNCTION private_sec.team_membership_authorizes(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.team_membership_authorizes(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION private_sec.messaging_connection(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT _a IS NOT NULL AND _b IS NOT NULL AND _a <> _b AND (
       public.is_guardian_of(_a, _b) OR public.is_guardian_of(_b, _a)
    -- two members of one team, each through a membership that counts (see team_membership_authorizes)
    OR EXISTS (SELECT 1 FROM public.team_members ma JOIN public.team_members mb ON mb.team_id = ma.team_id
                WHERE ma.user_id = _a AND mb.user_id = _b
                  AND private_sec.team_membership_authorizes(ma.team_id, _a)
                  AND private_sec.team_membership_authorizes(ma.team_id, _b))
    -- an ADULT host and a confirmed participant of an approved request, until 30 days after the game; a non-adult participant counts only when
    -- a verified guardian approved that participation (a stranger cannot create this context by publishing a public game, and a minor host is
    -- never reachable this way)
    OR EXISTS (SELECT 1 FROM public.hosted_games g JOIN public.game_participants p ON p.game_id = g.id
                WHERE ((g.host_id = _a AND p.user_id = _b) OR (g.host_id = _b AND p.user_id = _a))
                  AND public.age_cohort_of(g.host_id) = 'adult'
                  AND COALESCE(g.ends_at, g.date) > now() - interval '30 days'
                  AND (public.age_cohort_of(p.user_id) = 'adult'
                       OR EXISTS (SELECT 1 FROM public.join_requests jr
                                   WHERE jr.game_id = g.id AND jr.player_id = p.user_id AND jr.status = 'approved'
                                     AND jr.guardian_approved_at IS NOT NULL
                                     AND public.is_guardian_of(jr.guardian_approved_by, p.user_id))))
    -- an accepted request FROM a non-adult that their verified guardian approved (an adult sender cannot manufacture one: see the gate trigger)
    OR EXISTS (SELECT 1 FROM public.availability_contact_requests r
                WHERE r.status = 'accepted' AND r.needs_guardian AND r.guardian_approved_at IS NOT NULL
                  AND ((r.from_user_id = _a AND r.to_user_id = _b) OR (r.from_user_id = _b AND r.to_user_id = _a))
                  AND COALESCE(public.age_cohort_of(r.from_user_id), 'unknown') <> 'adult'
                  AND public.is_guardian_of(r.guardian_approved_by, r.from_user_id))
  )
$$;
REVOKE ALL ON FUNCTION private_sec.messaging_connection(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.messaging_connection(uuid, uuid) TO service_role;

-- (No shared-game peer context: a shared public game alone never authorizes direct messaging. Teens reach each other through a team or
-- through a request that the sender's guardian approved, the recipient's guardian allows (controls 'peers') and the recipient accepted.)

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
  -- Not an oracle: a signed-in caller who is neither party (and not a moderator) learns nothing about the pair.
  IF auth.uid() IS NOT NULL AND auth.uid() NOT IN (_a, _b) AND NOT public.is_moderator(auth.uid()) THEN
    RETURN 'needs_connection:other';
  END IF;
  ca := COALESCE(public.age_cohort_of(_a), 'unknown');
  cb := COALESCE(public.age_cohort_of(_b), 'unknown');
  minor_a := ca <> 'adult';
  minor_b := cb <> 'adult';

  -- Guardian-set controls first, so a restricted child is never reachable through the contexts below.
  ctl := private_sec.messaging_controls_block(_a, _b);
  IF ctl IS NOT NULL THEN RETURN ctl; END IF;

  IF NOT minor_a AND NOT minor_b THEN RETURN NULL; END IF;     -- adult to adult: unchanged

  IF private_sec.messaging_connection(_a, _b) THEN RETURN NULL; END IF;

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
        -- not an oracle: a signed-in caller who is neither party learns nothing about the pair (service role has no auth.uid())
        (auth.uid() IS NULL OR auth.uid() IN (_caller, _target))
        AND NOT public.blocks_exist_between(_caller, _target)
        AND CASE
          -- a person who is not a confirmed adult is involved: the guardian's controls first, then an authorized context, or a host dealing
          -- with a live join request (pending or approved, last 90 days); a rejected or old request is not a relationship
          WHEN COALESCE(public.age_cohort_of(_caller), 'unknown') <> 'adult' OR COALESCE(public.age_cohort_of(_target), 'unknown') <> 'adult' THEN
            private_sec.messaging_controls_block(_caller, _target) IS NULL
            AND (
              private_sec.messaging_connection(_caller, _target)
              -- a host dealing with a live join request: host to player only; a player may notify a host only when that host is a confirmed
              -- adult; an under-13 player's request counts only once a verified guardian approved it (under-13 contact stays guardian-mediated)
              OR EXISTS (SELECT 1 FROM public.join_requests jr
                          WHERE jr.status IN ('pending', 'approved') AND jr.created_at > now() - interval '90 days'
                            AND ((jr.host_id = _caller AND jr.player_id = _target)
                                 OR (jr.host_id = _target AND jr.player_id = _caller AND public.age_cohort_of(_target) = 'adult'))
                            AND (COALESCE(public.age_cohort_of(jr.player_id), 'unknown') <> 'child_under_13'
                                 OR (jr.guardian_approved_at IS NOT NULL AND public.is_guardian_of(jr.guardian_approved_by, jr.player_id))))
            )
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
      ELSIF _ct <> 'adult' AND NOT private_sec.messaging_connection(NEW.from_user_id, NEW.to_user_id)
            -- teen to teen of the same age band, when the recipient's guardian allows peers: the request then waits for the sender's
            -- guardian and the recipient's acceptance (mutual consent); never an under-13, never across age bands
            AND NOT (_ct IN ('teen_13_15', 'teen_16_17') AND _ct = _cf AND private_sec.has_guardian_link(NEW.to_user_id)
                     AND EXISTS (SELECT 1 FROM public.child_controls c WHERE c.child_user_id = NEW.to_user_id AND c.messaging = 'peers')) THEN
        _block := 'needs_connection:other';
      END IF;
    END IF;
  END IF;
  IF _block IS NOT NULL THEN
    IF _block LIKE '%:other' THEN _block := 'not_permitted:other'; END IF;   -- final review N1: no reason about the other person
    RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED:%', _block USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- Runs after the validator (which forces 'pending'): a request from a non-adult waits for a guardian and is invisible to the recipient.
-- Review round 4 (F7): every insert, from any sender, starts with no approval and needs_guardian computed from the sender's age, so an adult
-- cannot insert a request that already carries a forged needs_guardian/approval and so counts as a context.
CREATE OR REPLACE FUNCTION public.gate_contact_request_for_guardian()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  NEW.needs_guardian := COALESCE(public.age_cohort_of(NEW.from_user_id), 'unknown') <> 'adult';
  NEW.guardian_approved_by := NULL;
  NEW.guardian_approved_at := NULL;
  IF NEW.needs_guardian THEN
    NEW.status := 'awaiting_guardian';
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

DROP FUNCTION IF EXISTS public.guardian_decide_contact_request(uuid, boolean);
CREATE OR REPLACE FUNCTION public.guardian_decide_contact_request(_request uuid, _approve boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _r record; _mode text; _key text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT * INTO _r FROM public.availability_contact_requests WHERE id = _request AND status = 'awaiting_guardian';
  IF NOT FOUND OR NOT public.is_guardian_of(auth.uid(), _r.from_user_id) THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND: nothing to decide.' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM set_config('app.guardian_decide_request', 'on', true);
  IF NOT _approve THEN
    UPDATE public.availability_contact_requests SET status = 'withdrawn' WHERE id = _request;
    PERFORM set_config('app.guardian_decide_request', '', true);
    RETURN 'declined';
  END IF;
  -- the world may have changed since the child sent it: re-check blocks, the recipient's privacy settings and the controls
  _key := CASE WHEN _r.kind = 'invite' THEN 'allow_invites' ELSE 'allow_messages' END;
  _mode := COALESCE(public.privacy_text(_r.to_user_id, _key), 'everyone');
  IF public.blocks_exist_between(_r.from_user_id, _r.to_user_id)
     OR _mode = 'nobody'
     OR (_mode = 'shared' AND NOT private_sec.messaging_connection(_r.from_user_id, _r.to_user_id))
     OR private_sec.messaging_controls_block(_r.from_user_id, _r.to_user_id) IS NOT NULL THEN
    UPDATE public.availability_contact_requests SET status = 'withdrawn' WHERE id = _request;
    PERFORM set_config('app.guardian_decide_request', '', true);
    RETURN 'blocked';
  END IF;
  UPDATE public.availability_contact_requests
     SET status = 'pending', guardian_approved_by = auth.uid(), guardian_approved_at = now() WHERE id = _request;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_r.to_user_id, 'contact_request', 'You have a new request', 'A player sent you a request. Open your requests to answer it.', '/messages');
  PERFORM set_config('app.guardian_decide_request', '', true);
  RETURN 'approved';
END $$;
REVOKE ALL ON FUNCTION public.guardian_decide_contact_request(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardian_decide_contact_request(uuid, boolean) TO authenticated, service_role;

-- A client can never write the approval, the gate flag or a status the flow does not allow: only guardian_decide_contact_request (which sets the
-- transaction-local flag below) writes approval; a recipient may only move a visible, pending request to accepted or declined.
CREATE OR REPLACE FUNCTION public.protect_contact_request_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NULL OR COALESCE(current_setting('app.guardian_decide_request', true), '') = 'on' THEN RETURN NEW; END IF;
  NEW.guardian_approved_by := OLD.guardian_approved_by;
  NEW.guardian_approved_at := OLD.guardian_approved_at;
  NEW.needs_guardian := OLD.needs_guardian;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'pending' AND NEW.status IN ('accepted', 'declined')) THEN
    RAISE EXCEPTION 'This request cannot be changed that way.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_contact_request_approval() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_contact_request_approval() TO service_role;
DROP TRIGGER IF EXISTS a2_protect_contact_request_approval_trg ON public.availability_contact_requests;
CREATE TRIGGER a2_protect_contact_request_approval_trg BEFORE UPDATE ON public.availability_contact_requests
  FOR EACH ROW EXECUTE FUNCTION public.protect_contact_request_approval();

-- Recipients never see a request that is still waiting for a guardian; a guardian sees their child's requests.
DROP POLICY IF EXISTS "Sender or recipient can read" ON public.availability_contact_requests;
CREATE POLICY "Sender, released recipient or guardian can read" ON public.availability_contact_requests FOR SELECT TO authenticated
  USING (from_user_id = auth.uid()
         OR (to_user_id = auth.uid() AND status <> 'awaiting_guardian' AND (NOT needs_guardian OR guardian_approved_at IS NOT NULL))
         OR public.is_guardian_of(auth.uid(), from_user_id));
DROP POLICY IF EXISTS "Recipient updates status" ON public.availability_contact_requests;
CREATE POLICY "Recipient updates status" ON public.availability_contact_requests FOR UPDATE TO authenticated
  USING (to_user_id = auth.uid() AND status <> 'awaiting_guardian' AND (NOT needs_guardian OR guardian_approved_at IS NOT NULL))
  WITH CHECK (to_user_id = auth.uid() AND status <> 'awaiting_guardian' AND (NOT needs_guardian OR guardian_approved_at IS NOT NULL));

-- ------------------------------------------------------------------------------------------------------------------ team invitations
-- Found in review: team_invite_player let any team manager (any adult can create a team) place a free-text message and a direct notification in a minor's
-- inbox. For a person who is not a confirmed adult the message is dropped and the guardians are told instead; the invitation itself still waits for
-- the guardian's approval as before. Everything else is unchanged (production definition fingerprint-compared, md5 2712dcac...).
CREATE OR REPLACE FUNCTION public.team_invite_player(_team text, _user uuid, _role team_role DEFAULT 'player'::team_role, _message text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _id uuid;
  _team_name text;
  _minor boolean := COALESCE(public.age_cohort_of(_user), 'unknown') <> 'adult';
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.is_team_manager(_team, _me) THEN RAISE EXCEPTION 'NOT_TEAM_MANAGER'; END IF;
  IF _role = 'owner' THEN RAISE EXCEPTION 'OWNER_NOT_INVITABLE'; END IF;
  IF _user = _me THEN RAISE EXCEPTION 'SELF_INVITE'; END IF;
  IF public.is_team_member(_team, _user) THEN RAISE EXCEPTION 'ALREADY_MEMBER'; END IF;
  IF public.blocks_exist_between(_me, _user) THEN RAISE EXCEPTION 'BLOCKED'; END IF;

  SELECT name INTO _team_name FROM public.teams WHERE id = _team;

  UPDATE public.team_invites SET status = 'expired', updated_at = now()
  WHERE team_id = _team AND invitee_id = _user AND status = 'pending' AND expires_at <= now();

  INSERT INTO public.team_invites (team_id, invitee_id, invited_by, role, message)
  VALUES (_team, _user, _me, _role, CASE WHEN _minor THEN NULL ELSE nullif(btrim(coalesce(_message,'')), '') END)
  RETURNING id INTO _id;

  IF NOT _minor THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_user, 'team_invite', 'Team invitation',
            coalesce(_team_name,'A team') || ' invited you to join as ' || _role::text,
            '/teams/' || _team);
  ELSE
    PERFORM public.notify_guardians(_user, 'team_invite',
      'Team invitation for your player',
      coalesce(_team_name,'A team') || ' invited your player to join as ' || _role::text,
      '/parent');
  END IF;

  RETURN _id;
END $function$;

-- ---------------------------------------------------------------------------------------------------------------------------- reactions
-- Found in review: a participant whose authorization had lapsed could still react to messages. Reactions follow the same decision as messages.
CREATE OR REPLACE FUNCTION public.enforce_minor_messaging_reaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE other uuid; block text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  FOR other IN
    SELECT cp.user_id FROM public.messages m
      JOIN public.conversation_participants cp ON cp.conversation_id = m.conversation_id
     WHERE m.id = NEW.message_id AND cp.user_id <> NEW.user_id
  LOOP
    block := public.minor_messaging_block(NEW.user_id, other);
    IF block IS NOT NULL THEN
      RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED:%', block USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_minor_messaging_reaction() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_minor_messaging_reaction() TO service_role;
DROP TRIGGER IF EXISTS trg_enforce_minor_messaging_reaction ON public.message_reactions;
CREATE TRIGGER trg_enforce_minor_messaging_reaction BEFORE INSERT ON public.message_reactions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_minor_messaging_reaction();

-- ================================================================================================ review round 4 corrections (2026-11-05)
-- -------------------------------------------------------------------------------------------- F1: join-request guardian approval
-- guardian_approved_at/by on join_requests were client-writable: a minor could insert a request carrying a forged approval, and a host (or a
-- player resubmitting) could stamp one, which created the host-to-minor game context above and satisfied enforce_child_game_participation and
-- enforce_guardian_before_payment. Now an insert always starts without an approval, and an update keeps the stored values unless
-- guardian_approve_join_request (which sets the transaction-local flag app.guardian_approve_join_request) is writing them.
-- Names match SEC-1 (20261107100000), whose later CREATE OR REPLACE of protect_join_request_guardian_approval and re-creation of
-- a0_protect_join_request_guardian_approval_trg (UPDATE only) simply replace the update half; the insert half has its own trigger, which SEC-1
-- does not touch.
CREATE OR REPLACE FUNCTION public.protect_join_request_guardian_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NULL OR COALESCE(current_setting('app.guardian_approve_join_request', true), '') = 'on' THEN RETURN NEW; END IF;
  NEW.guardian_approved_at := OLD.guardian_approved_at;
  NEW.guardian_approved_by := OLD.guardian_approved_by;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_join_request_guardian_approval() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_join_request_guardian_approval() TO service_role;
DROP TRIGGER IF EXISTS a0_protect_join_request_guardian_approval_trg ON public.join_requests;
CREATE TRIGGER a0_protect_join_request_guardian_approval_trg BEFORE UPDATE ON public.join_requests
  FOR EACH ROW EXECUTE FUNCTION public.protect_join_request_guardian_approval();

CREATE OR REPLACE FUNCTION public.clear_join_request_guardian_approval_on_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;   -- service role and definer-owned maintenance
  NEW.guardian_approved_at := NULL;
  NEW.guardian_approved_by := NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.clear_join_request_guardian_approval_on_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_join_request_guardian_approval_on_insert() TO service_role;
DROP TRIGGER IF EXISTS a0_clear_join_request_guardian_approval_ins_trg ON public.join_requests;
CREATE TRIGGER a0_clear_join_request_guardian_approval_ins_trg BEFORE INSERT ON public.join_requests
  FOR EACH ROW EXECUTE FUNCTION public.clear_join_request_guardian_approval_on_insert();

-- Unchanged from 20261027130000_guardian_join_request_either_order.sql except that the approval write sets (and then clears) the flag.
CREATE OR REPLACE FUNCTION public.guardian_approve_join_request(_request uuid, _approve boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _row public.join_requests;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _row FROM public.join_requests WHERE id = _request FOR UPDATE;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF NOT public.is_guardian_of(_me, _row.player_id) THEN RAISE EXCEPTION 'NOT_GUARDIAN'; END IF;
  IF _row.status NOT IN ('pending', 'approved') THEN RAISE EXCEPTION 'REQUEST_NOT_PENDING'; END IF;
  IF EXISTS (SELECT 1 FROM public.game_participants gp
              WHERE gp.game_id = _row.game_id AND gp.user_id = _row.player_id) THEN
    RAISE EXCEPTION 'ALREADY_ON_ROSTER: this child is already in the game; cancel their spot from the game page.';
  END IF;

  IF _approve THEN
    PERFORM set_config('app.guardian_approve_join_request', 'on', true);
    UPDATE public.join_requests
       SET guardian_approved_at = COALESCE(guardian_approved_at, now()),
           guardian_approved_by = COALESCE(guardian_approved_by, _me)
     WHERE id = _request AND status IN ('pending', 'approved');
    PERFORM set_config('app.guardian_approve_join_request', '', true);

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_row.player_id, 'join_request_guardian_approved', 'Your guardian approved this request',
            CASE WHEN _row.status = 'approved'
                 THEN 'Your guardian and the host both said yes. You can take your place now.'
                 ELSE 'Your guardian approved your request to join this game.' END,
            '/games/' || _row.game_id);
  ELSE
    -- join_requests has no 'withdrawn-by-guardian' concept distinct from the
    -- player's own withdrawal; reuse the existing 'rejected' status rather
    -- than widening join_requests_status_chk for a guardian-specific value.
    UPDATE public.join_requests
       SET status = 'rejected', reviewed_at = now(), reviewer_notes = 'Declined by guardian'
     WHERE id = _request AND status IN ('pending', 'approved');
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.guardian_approve_join_request(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardian_approve_join_request(uuid, boolean) TO authenticated;

-- -------------------------------------------------------------------------------------------- F4: unknown age fails closed on direct adds
-- team_members_manager_write used NOT is_minor(user_id), which is false for a person with no birthday, so a manager could add an unknown-age
-- account directly. A manager may add only people of known adult age directly; everyone else joins through an invitation (and their guardian).
-- (Direct adds never count as a messaging context for a non-adult anyway: see team_membership_authorizes.)
DROP POLICY IF EXISTS "team_members_manager_write" ON public.team_members;
CREATE POLICY "team_members_manager_write"
ON public.team_members
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_team_manager(team_id, auth.uid())
  AND role <> 'owner'::team_role
  -- a known age (age_verified: cohort is not 'unknown') that is not a minor; both helpers are callable by clients, age_cohort_of is not
  AND public.age_verified(user_id)
  AND NOT public.is_minor(user_id)
);

-- -------------------------------------------------------------------------------------------- F6: family invitations cannot fake a guardian
-- redeem_minor_invite made any adult who sent a link a verified guardian after one click by the person who opened it: an adult could redeem
-- one (so two adults could make each other "guardians"), and a child who already had a guardian gained a new one with no word to that guardian.
-- Now: an adult cannot redeem; a child who already has a verified guardian gets a PENDING request that one of their current guardians must
-- approve (guardian_decide_link_request; the guardians are notified); a child with no guardian links as before (that is how the first guardian
-- links) and no one new is notified.
CREATE TABLE IF NOT EXISTS public.guardian_link_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  relationship text NOT NULL DEFAULT 'parent',
  invite_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS guardian_link_requests_one_pending ON public.guardian_link_requests (child_user_id, parent_user_id) WHERE status = 'pending';
ALTER TABLE public.guardian_link_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Child, requester or current guardian can read" ON public.guardian_link_requests;
CREATE POLICY "Child, requester or current guardian can read" ON public.guardian_link_requests FOR SELECT TO authenticated
  USING (child_user_id = auth.uid() OR parent_user_id = auth.uid() OR public.is_guardian_of(auth.uid(), child_user_id));
REVOKE ALL ON public.guardian_link_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.guardian_link_requests TO authenticated;
GRANT ALL ON public.guardian_link_requests TO service_role;

-- The return type gains pending_approval, so the function is dropped and re-created (grants restored below).
DROP FUNCTION IF EXISTS public.redeem_minor_invite(text);
CREATE FUNCTION public.redeem_minor_invite(_token_hash text)
 RETURNS TABLE(parent_id uuid, consent_recorded boolean, pending_approval boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _inv public.minor_invites; _cohort text;
        _consent boolean := false; _cid uuid; _prev text; _parent uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: sign in to accept a family invitation.';
  END IF;

  SELECT * INTO _inv FROM public.minor_invites WHERE token_hash = _token_hash FOR UPDATE;
  IF _inv.id IS NULL THEN
    RAISE EXCEPTION 'INVITE_INVALID: that invitation link is not valid.';
  END IF;
  IF _inv.status = 'revoked' THEN
    RAISE EXCEPTION 'INVITE_REVOKED: that invitation was cancelled.';
  END IF;
  IF _inv.status = 'redeemed' THEN
    RAISE EXCEPTION 'INVITE_USED: that invitation was already used.';
  END IF;
  IF _inv.expires_at <= now() THEN
    RAISE EXCEPTION 'INVITE_EXPIRED: that invitation has expired.';
  END IF;
  _parent := _inv.parent_user_id;
  IF _parent = _uid THEN
    RAISE EXCEPTION 'INVITE_SELF: you cannot accept your own invitation.';
  END IF;

  SELECT age_cohort INTO _cohort FROM public.profiles WHERE id = _uid;
  IF COALESCE(_cohort, 'unknown') = 'unknown' THEN
    RAISE EXCEPTION 'AGE_VERIFICATION_REQUIRED: add your date of birth first.';
  END IF;
  -- NEW (R7 review round 4): a family invitation links a minor; an adult account cannot become anyone's "child"
  IF _cohort = 'adult' THEN
    RAISE EXCEPTION 'ADULT_CANNOT_REDEEM: family invitations are for players under 18.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM public.guardian_links g
              WHERE g.parent_user_id = _parent AND g.child_user_id = _uid) THEN
    RAISE EXCEPTION 'ALREADY_LINKED: you are already connected to this parent or guardian.';
  END IF;

  -- NEW (R7 review round 4): a child who already has a verified guardian cannot add another by their own click; a current guardian approves
  IF private_sec.has_guardian_link(_uid) THEN
    IF EXISTS (SELECT 1 FROM public.guardian_link_requests r
                WHERE r.child_user_id = _uid AND r.parent_user_id = _parent AND r.status = 'pending') THEN
      RAISE EXCEPTION 'ALREADY_REQUESTED: this request is already waiting for your parent or guardian.';
    END IF;
    INSERT INTO public.guardian_link_requests (child_user_id, parent_user_id, relationship, invite_id)
    VALUES (_uid, _parent, _inv.relationship, _inv.id);
    UPDATE public.minor_invites
       SET status = 'redeemed', child_user_id = _uid, redeemed_at = now()
     WHERE id = _inv.id;
    PERFORM public.notify_guardians_of(_uid, 'guardian_approval', 'Approve a new guardian',
      'Someone asked to be added as a parent or guardian of your child. Open Guardian to approve or decline. Nothing changes until you approve.',
      '/guardian');
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_uid, 'guardian_link', 'Waiting for your parent or guardian',
            'Your current parent or guardian needs to approve this new connection.', '/settings');
    RETURN QUERY SELECT _parent, false, true;
    RETURN;
  END IF;

  INSERT INTO public.guardian_links (parent_user_id, child_user_id, relationship, status, verified_at)
  VALUES (_parent, _uid, _inv.relationship, 'active', now())
  ON CONFLICT (parent_user_id, child_user_id) DO NOTHING;

  -- LEGAL REVIEW REQUIRED: consent-required age band is configurable policy,
  -- not hardcoded to under-13; mirrors platform_status(). The invited adult
  -- holds a confirmed account email, so the method is email_confirmation.
  IF public.parental_consent_required(_cohort) THEN
    SELECT id, status INTO _cid, _prev FROM public.parental_consents WHERE child_user_id = _uid;
    IF _cid IS NULL THEN
      INSERT INTO public.parental_consents (
        child_user_id, parent_email, parent_name, parent_user_id, relationship,
        status, method, jurisdiction, approved_at, requested_at)
      VALUES (_uid, COALESCE((SELECT email FROM auth.users u WHERE u.id = _parent), ''),
              (SELECT display_name FROM public.profiles p WHERE p.id = _parent),
              _parent, _inv.relationship, 'approved', 'email_confirmation', 'US_FEDERAL',
              now(), now())
      RETURNING id INTO _cid;
      _prev := 'required';
    ELSIF _prev <> 'approved' THEN
      UPDATE public.parental_consents
         SET status = 'approved', method = 'email_confirmation',
             parent_user_id = _parent, relationship = _inv.relationship,
             approved_at = now(), revoked_at = NULL, revoked_reason = NULL,
             verification_token_hash = NULL, token_expires_at = NULL
       WHERE id = _cid;
    END IF;

    INSERT INTO public.parental_consent_events
      (consent_id, child_user_id, actor_id, action, from_status, to_status, detail)
    VALUES (_cid, _uid, _uid, 'consent_approved', COALESCE(_prev, 'required'), 'approved',
            jsonb_build_object('method', 'email_confirmation', 'invite_id', _inv.id));

    INSERT INTO public.child_controls (child_user_id, updated_by)
    VALUES (_uid, _parent)
    ON CONFLICT (child_user_id) DO NOTHING;

    _consent := true;
  END IF;

  UPDATE public.minor_invites
     SET status = 'redeemed', child_user_id = _uid, redeemed_at = now()
   WHERE id = _inv.id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_parent, 'guardian_link', 'Family invitation accepted',
          COALESCE(_inv.child_name, 'Your minor') || ' is now linked to your account.', '/parent'),
         (_uid, 'guardian_link', 'Parent or guardian connected',
          'Your parent or guardian can now manage your safety settings.', '/settings');

  RETURN QUERY SELECT _parent, _consent, false;
END $function$;
REVOKE ALL ON FUNCTION public.redeem_minor_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_minor_invite(text) TO authenticated, service_role;

-- A current verified guardian approves or declines a pending request to add another guardian.
CREATE OR REPLACE FUNCTION public.guardian_decide_link_request(_request uuid, _approve boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _r public.guardian_link_requests;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT * INTO _r FROM public.guardian_link_requests WHERE id = _request AND status = 'pending' FOR UPDATE;
  IF NOT FOUND OR NOT public.is_guardian_of(auth.uid(), _r.child_user_id) THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND: nothing to decide.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT _approve OR COALESCE(public.age_cohort_of(_r.parent_user_id), 'unknown') <> 'adult' THEN
    UPDATE public.guardian_link_requests SET status = 'declined', decided_by = auth.uid(), decided_at = now() WHERE id = _request;
    RETURN 'declined';
  END IF;
  INSERT INTO public.guardian_links (parent_user_id, child_user_id, relationship, status, verified_at)
  VALUES (_r.parent_user_id, _r.child_user_id, _r.relationship, 'active', now())
  ON CONFLICT (parent_user_id, child_user_id) DO UPDATE SET status = 'active', verified_at = now();
  UPDATE public.guardian_link_requests SET status = 'approved', decided_by = auth.uid(), decided_at = now() WHERE id = _request;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_r.parent_user_id, 'guardian_link', 'Family invitation accepted',
          'You are now linked as a parent or guardian.', '/parent'),
         (_r.child_user_id, 'guardian_link', 'Parent or guardian connected',
          'Your parent or guardian approved the new connection.', '/settings');
  RETURN 'approved';
END $$;
REVOKE ALL ON FUNCTION public.guardian_decide_link_request(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardian_decide_link_request(uuid, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Final independent review (7d154333):
-- N1: create_direct_conversation told any caller WHY a minor could not be messaged (age band, guardian link, guardian controls),
--     which SEC-2 hides everywhere else; a reason about the other person is now one fixed code.
-- N2: host_cancel_game sent the host's free text to every participant, minors included, outside can_notify and guardian controls.
CREATE OR REPLACE FUNCTION public.create_direct_conversation(_other_user uuid, _game_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _existing uuid;
  _new_id uuid;
  _mode text;
  _block text;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _me = _other_user THEN
    RAISE EXCEPTION 'Cannot message yourself';
  END IF;

  _block := public.minor_messaging_block(_me, _other_user);
  IF _block IS NOT NULL THEN
    -- Final review N1: a reason about the OTHER person (their age band, guardian link or controls) is not told to the caller;
    -- the app shows its generic line for this code. A reason about the caller's own account (:self) is still explained.
    IF _block LIKE '%:other' THEN _block := 'not_permitted:other'; END IF;
    RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED:%', _block;
  END IF;

  SELECT cp1.conversation_id INTO _existing
  FROM public.conversation_participants cp1
  JOIN public.conversation_participants cp2
    ON cp1.conversation_id = cp2.conversation_id
  WHERE cp1.user_id = _me AND cp2.user_id = _other_user
  LIMIT 1;

  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;

  _mode := COALESCE(public.privacy_text(_other_user, 'allow_messages'), 'everyone');
  IF _mode = 'nobody' THEN
    RAISE EXCEPTION 'This player is not accepting new messages.';
  ELSIF _mode = 'shared' AND NOT public.shares_game_or_chat(_me, _other_user) THEN
    RAISE EXCEPTION 'This player only accepts messages from people they share a game or chat with.';
  END IF;

  INSERT INTO public.conversations (created_by, game_id)
  VALUES (_me, _game_id)
  RETURNING id INTO _new_id;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (_new_id, _me), (_new_id, _other_user);

  RETURN _new_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.host_cancel_game(_game_id text, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g record;
  p record;
BEGIN
  SELECT id, host_id, title, cancelled_at INTO g
  FROM public.hosted_games WHERE id = _game_id;

  IF g IS NULL THEN
    RAISE EXCEPTION 'Game not found.' USING ERRCODE = 'P0001';
  END IF;
  IF g.host_id <> auth.uid() AND NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Only the host can cancel this game.' USING ERRCODE = 'P0001';
  END IF;
  IF g.cancelled_at IS NOT NULL THEN
    RETURN;
  END IF;

  UPDATE public.hosted_games
    SET status = 'cancelled',
        cancelled_at = now(),
        cancellation_reason = NULLIF(btrim(COALESCE(_reason, '')), ''),
        joins_closed = true,
        updated_at = now()
  WHERE id = _game_id;

  FOR p IN
    SELECT user_id FROM public.game_participants
    WHERE game_id = _game_id AND user_id <> g.host_id
  LOOP
    -- Final review N2: the host's free-text reason reaches only confirmed adults; anyone else gets the fixed wording
    -- (their guardian sees the reason on the game page).
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      p.user_id, 'game_cancelled',
      g.title || ' was cancelled',
      CASE WHEN public.age_cohort_of(p.user_id) = 'adult'
           THEN COALESCE(NULLIF(btrim(COALESCE(_reason, '')), ''), 'The host cancelled this game.')
           ELSE 'The host cancelled this game.' END,
      '/games/' || _game_id
    );
  END LOOP;
END $function$
;

-- N6: SEC-2 (#273) containment: this migration redefines wrapped helpers (minor_messaging_block, can_notify) in public; re-wrap
-- here so the release is safe even if no later migration re-wraps.
DO $rewrap$ BEGIN
  IF to_regprocedure('private_sec.wrap_oracle_helpers()') IS NOT NULL THEN PERFORM private_sec.wrap_oracle_helpers(); END IF;
END $rewrap$;
