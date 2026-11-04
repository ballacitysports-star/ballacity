-- SEC-4 (Approval B): first-guardian security.
--
-- FOUND BY independent review R7 N3: a stranger could become an unlinked minor's FIRST guardian. They created a family invitation
-- (create_minor_invite) and the minor's single click (redeem_minor_invite) inserted an active, verified guardian_links row, which unlocked
-- messaging, approvals, controls, location and payment management. The parental-consent email flow had the same shape: the CHILD types the
-- address the approval link goes to, and whoever signs in with any adult account and opens that link became an active guardian through
-- approve_parental_consent. Neither is an independent check: the inviter and the child can produce both halves alone.
--
-- POLICY (owner): invitation redemption alone never establishes guardian authority; guardian identity and authorization are verified
-- independently; an unlinked minor cannot be claimed through a self-created relationship; existing legitimate links are preserved (no
-- backfill: existing active links stay active and untouched); pending verification grants NOTHING; every activation, revocation and recovery
-- is audited in an append-only table readable only by staff and the parties; unknown or unverified relationships fail closed.
--
-- WHAT CHANGES
--   1. redeem_minor_invite never inserts an active link. A child with no verified guardian gets a PENDING guardian_link_requests row of
--      kind 'first_guardian'; a child with one keeps R7's 'additional_guardian' request that a current guardian decides. Parental consent is
--      no longer recorded on redemption: it is recorded when the link is activated.
--   2. approve_parental_consent (service role only; the app calls it after the approver signs in) no longer creates or re-activates links.
--      The consent email is NOT an independent channel (the child chooses the address), so it is not wired as an activation path: an approver
--      who is not already a verified guardian becomes a pending claim (source 'consent_email') and the consent stays pending until activation.
--      A verified guardian approving their own child's consent works as before.
--   3. Activation of a first-guardian claim needs staff: staff_verify_guardian_claim (moderator, admin or superadmin, never a party) records
--      the verification method and an evidence reference, re-checks that the guardian is an eligible adult and the child still a minor, and
--      refuses a claim with self-created-relationship signals unless the reviewer explicitly acknowledges them. A current verified guardian
--      may still approve a pending request (guardian_decide_link_request), which is independent of the child and the claimant.
--   4. Self-created relationships: at redemption the claim records signals (shared_team, shared_game, contact_request, conversation) when the
--      claimant already shares a team, game, contact request or conversation with the child. Nothing auto-verifies; a signalled claim needs
--      the reviewer's explicit acknowledgement.
--   5. Invitations: expiry capped at 14 days from creation (also enforced at redemption for older rows), at most 10 created per adult per
--      24 hours, single use, looked up only by token hash, revocable by the inviter or staff before use; after use the child (or the
--      claimant, or staff) can withdraw the pending claim. Redemption is rate limited per child and per claimant.
--   6. Forged approvals: guardian_links and guardian_link_requests carry BEFORE triggers that refuse any write from a signed-in session unless
--      one of the definer RPCs below set the transaction-local flag app.guardian_link_write (the protect_contact_request_approval pattern).
--      Two narrow exceptions keep existing flows: provision_managed_child (the guardian created the credential-less child account, see
--      20260930120000) and revoke_guardian_link (a guardian ending their own link). Clients still have no INSERT/UPDATE grant at all.
--   7. Recovery: staff_revoke_guardian_link and staff_restore_guardian_link (both audited, both with a reason; restore re-checks that the
--      guardian is an eligible adult and the child still a minor).
--   8. Audit: public.guardian_link_audit, append-only, written only by triggers on guardian_links and guardian_link_requests, readable by
--      staff, the child and the guardian or claimant of that row.
--
-- NOT CHANGED: is_guardian_of and has_guardian_link (both already require status = 'active' AND verified_at IS NOT NULL; a pending claim lives
-- in guardian_link_requests and is never a guardian_links row), existing guardian_links rows, managed-child provisioning, revoke_guardian_link.
-- Depends on R7 (20261106140000). Rollback: forward-fix only.

-- Dependency guard: fail loudly before changing anything if a migration this one needs has not been applied.
DO $guard$ BEGIN
  IF to_regclass('public.guardian_link_requests') IS NULL
     OR to_regclass('public.managed_accounts') IS NULL
     OR to_regprocedure('public.guardian_decide_link_request(uuid,boolean)') IS NULL
     OR to_regprocedure('private_sec.has_guardian_link(uuid)') IS NULL
     OR to_regprocedure('public.redeem_minor_invite(text)') IS NULL
     OR to_regprocedure('public.approve_parental_consent(text,text,uuid,jsonb)') IS NULL
     OR to_regprocedure('public.create_minor_invite(text,text,text,timestamptz)') IS NULL
     OR to_regprocedure('public.notify_guardians_of(uuid,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'SEC-4: a required earlier release migration (R7 20261106140000) has not been applied';
  END IF;
END $guard$;

-- ------------------------------------------------------------------------------------------------------------------------------ columns
ALTER TABLE public.guardian_links ADD COLUMN IF NOT EXISTS verified_by uuid;
ALTER TABLE public.guardian_links ADD COLUMN IF NOT EXISTS verification_method text;

ALTER TABLE public.guardian_link_requests ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'additional_guardian';
ALTER TABLE public.guardian_link_requests ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'family_invite';
ALTER TABLE public.guardian_link_requests ADD COLUMN IF NOT EXISTS signals text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.guardian_link_requests ADD COLUMN IF NOT EXISTS consent_id uuid;
ALTER TABLE public.guardian_link_requests ADD COLUMN IF NOT EXISTS consent_versions jsonb;
ALTER TABLE public.guardian_link_requests ADD COLUMN IF NOT EXISTS verification_method text;
ALTER TABLE public.guardian_link_requests ADD COLUMN IF NOT EXISTS evidence_ref text;
ALTER TABLE public.guardian_link_requests ADD COLUMN IF NOT EXISTS decision_reason text;
ALTER TABLE public.guardian_link_requests DROP CONSTRAINT IF EXISTS guardian_link_requests_kind_check;
ALTER TABLE public.guardian_link_requests ADD CONSTRAINT guardian_link_requests_kind_check CHECK (kind IN ('first_guardian', 'additional_guardian'));
ALTER TABLE public.guardian_link_requests DROP CONSTRAINT IF EXISTS guardian_link_requests_source_check;
ALTER TABLE public.guardian_link_requests ADD CONSTRAINT guardian_link_requests_source_check CHECK (source IN ('family_invite', 'consent_email'));
ALTER TABLE public.guardian_link_requests DROP CONSTRAINT IF EXISTS guardian_link_requests_status_check;
ALTER TABLE public.guardian_link_requests ADD CONSTRAINT guardian_link_requests_status_check
  CHECK (status IN ('pending', 'approved', 'declined', 'withdrawn'));
CREATE INDEX IF NOT EXISTS guardian_link_requests_pending_kind ON public.guardian_link_requests (kind, created_at) WHERE status = 'pending';

-- Staff review the queue (the parties and current guardians keep R7's policy).
DROP POLICY IF EXISTS "Staff read guardian link requests" ON public.guardian_link_requests;
CREATE POLICY "Staff read guardian link requests" ON public.guardian_link_requests FOR SELECT TO authenticated
  USING (public.is_moderator(auth.uid()));

-- ------------------------------------------------------------------------------------------------------------------------------ audit
CREATE TABLE IF NOT EXISTS public.guardian_link_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  child_user_id uuid NOT NULL,
  guardian_user_id uuid NOT NULL,
  link_id uuid,
  request_id uuid,
  action text NOT NULL,
  from_status text,
  to_status text,
  actor_id uuid,
  actor_role text NOT NULL,
  method text,
  evidence_ref text,
  reason text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guardian_link_audit_child_idx ON public.guardian_link_audit (child_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS guardian_link_audit_guardian_idx ON public.guardian_link_audit (guardian_user_id, created_at DESC);
ALTER TABLE public.guardian_link_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guardian_link_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.guardian_link_audit TO authenticated;
GRANT SELECT, INSERT ON public.guardian_link_audit TO service_role;
DROP POLICY IF EXISTS "Staff and the parties read guardian link audit" ON public.guardian_link_audit;
CREATE POLICY "Staff and the parties read guardian link audit" ON public.guardian_link_audit FOR SELECT TO authenticated
  USING (child_user_id = auth.uid() OR guardian_user_id = auth.uid() OR public.is_moderator(auth.uid()));

CREATE OR REPLACE FUNCTION public.guardian_link_audit_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  RAISE EXCEPTION 'guardian_link_audit is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
REVOKE ALL ON FUNCTION public.guardian_link_audit_append_only() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guardian_link_audit_no_change ON public.guardian_link_audit;
CREATE TRIGGER guardian_link_audit_no_change BEFORE UPDATE OR DELETE ON public.guardian_link_audit
  FOR EACH ROW EXECUTE FUNCTION public.guardian_link_audit_append_only();
DROP TRIGGER IF EXISTS guardian_link_audit_no_truncate ON public.guardian_link_audit;
CREATE TRIGGER guardian_link_audit_no_truncate BEFORE TRUNCATE ON public.guardian_link_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.guardian_link_audit_append_only();

-- ------------------------------------------------------------------------------------------------------------------------------ helpers
-- The definer RPCs below open a write window for the protect triggers and pass the audit context (who, why, how) to the audit triggers.
-- Both settings are transaction-local, and every RPC closes the window before returning.
CREATE OR REPLACE FUNCTION private_sec.guardian_write_begin(_ctx jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path TO '' AS $$
BEGIN
  PERFORM set_config('app.guardian_link_write', 'on', true);
  PERFORM set_config('app.guardian_audit', COALESCE(_ctx, '{}'::jsonb)::text, true);
END $$;
CREATE OR REPLACE FUNCTION private_sec.guardian_write_end()
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path TO '' AS $$
BEGIN
  PERFORM set_config('app.guardian_link_write', '', true);
  PERFORM set_config('app.guardian_audit', '', true);
END $$;
REVOKE ALL ON FUNCTION private_sec.guardian_write_begin(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_sec.guardian_write_end() FROM PUBLIC, anon, authenticated;

-- An adult who may hold guardian authority: a known adult age not under review, not suspended, never a managed (credential-less) account.
CREATE OR REPLACE FUNCTION private_sec.guardian_eligible(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = _user AND p.age_cohort = 'adult' AND NOT COALESCE(p.age_review_required, false) AND p.suspended_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = _user)
$$;
REVOKE ALL ON FUNCTION private_sec.guardian_eligible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.guardian_eligible(uuid) TO service_role;

-- Signals that the claimant built a relationship with the child themselves (a stranger who coached, hosted, played with or contacted them).
-- A parent can legitimately share a team or a conversation with their child, so these do not refuse the claim; they make sure it can never
-- be activated without a reviewer who saw them and explicitly acknowledged them.
CREATE OR REPLACE FUNCTION private_sec.guardian_claim_signals(_claimant uuid, _child uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN EXISTS (SELECT 1 FROM public.team_members a JOIN public.team_members b ON b.team_id = a.team_id
                       WHERE a.user_id = _claimant AND b.user_id = _child)
           OR EXISTS (SELECT 1 FROM public.teams t JOIN public.team_members b ON b.team_id = t.id WHERE t.owner_id = _claimant AND b.user_id = _child)
           OR EXISTS (SELECT 1 FROM public.team_invites i WHERE i.invited_by = _claimant AND i.invitee_id = _child)
         THEN 'shared_team' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.hosted_games g JOIN public.game_participants p ON p.game_id = g.id
                       WHERE (g.host_id = _claimant AND p.user_id = _child) OR (g.host_id = _child AND p.user_id = _claimant))
           OR EXISTS (SELECT 1 FROM public.join_requests jr
                       WHERE (jr.host_id = _claimant AND jr.player_id = _child) OR (jr.host_id = _child AND jr.player_id = _claimant))
           OR EXISTS (SELECT 1 FROM public.game_participants a JOIN public.game_participants b ON b.game_id = a.game_id
                       WHERE a.user_id = _claimant AND b.user_id = _child)
         THEN 'shared_game' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.availability_contact_requests r
                       WHERE (r.from_user_id = _claimant AND r.to_user_id = _child) OR (r.from_user_id = _child AND r.to_user_id = _claimant))
         THEN 'contact_request' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.conversation_participants a JOIN public.conversation_participants b ON b.conversation_id = a.conversation_id
                       WHERE a.user_id = _claimant AND b.user_id = _child)
         THEN 'conversation' END
  ], NULL)
$$;
REVOKE ALL ON FUNCTION private_sec.guardian_claim_signals(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.guardian_claim_signals(uuid, uuid) TO service_role;

-- Record parental consent when a guardian link is activated and the child's age requires it. The method is manual_review: the consent counts
-- because staff (or a current guardian) verified who gave it, not because someone holding a link clicked it.
CREATE OR REPLACE FUNCTION private_sec.guardian_apply_consent(_child uuid, _guardian uuid, _relationship text, _actor uuid, _versions jsonb, _detail jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cid uuid; _prev text; _email text; _name text;
BEGIN
  IF NOT public.parental_consent_required(COALESCE(public.age_cohort_of(_child), 'unknown')) THEN RETURN false; END IF;
  SELECT c.id, c.status INTO _cid, _prev FROM public.parental_consents c WHERE c.child_user_id = _child FOR UPDATE;
  IF _prev = 'approved' THEN RETURN false; END IF;
  SELECT u.email INTO _email FROM auth.users u WHERE u.id = _guardian;
  SELECT p.display_name INTO _name FROM public.profiles p WHERE p.id = _guardian;
  IF _cid IS NULL THEN
    INSERT INTO public.parental_consents (child_user_id, parent_email, parent_name, parent_user_id, relationship, status, method, jurisdiction,
                                          approved_at, requested_at, privacy_version, terms_version, child_policy_version, scope)
    VALUES (_child, COALESCE(_email, ''), _name, _guardian, COALESCE(_relationship, 'guardian'), 'approved', 'manual_review', 'US_FEDERAL',
            now(), now(), _versions ->> 'privacy', _versions ->> 'terms', _versions ->> 'child_policy', COALESCE(_versions -> 'scope', '{}'::jsonb))
    RETURNING id INTO _cid;
    _prev := 'required';
  ELSE
    UPDATE public.parental_consents
       SET status = 'approved', method = 'manual_review', parent_user_id = _guardian, parent_email = COALESCE(_email, parent_email),
           parent_name = COALESCE(_name, parent_name), relationship = COALESCE(_relationship, relationship),
           approved_at = now(), revoked_at = NULL, revoked_reason = NULL, verification_token_hash = NULL, token_expires_at = NULL,
           privacy_version = COALESCE(_versions ->> 'privacy', privacy_version), terms_version = COALESCE(_versions ->> 'terms', terms_version),
           child_policy_version = COALESCE(_versions ->> 'child_policy', child_policy_version), scope = COALESCE(_versions -> 'scope', scope)
     WHERE id = _cid;
  END IF;
  INSERT INTO public.parental_consent_events (consent_id, child_user_id, actor_id, action, from_status, to_status, method, detail)
  VALUES (_cid, _child, _actor, 'consent_approved', COALESCE(_prev, 'required'), 'approved', 'manual_review', COALESCE(_detail, '{}'::jsonb));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION private_sec.guardian_apply_consent(uuid, uuid, text, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.guardian_apply_consent(uuid, uuid, text, uuid, jsonb, jsonb) TO service_role;

-- ------------------------------------------------------------------------------------------------------------------------------ protect triggers
-- guardian_links: a signed-in session writes a link only through the definer RPCs below (flag), with two narrow existing exceptions.
CREATE OR REPLACE FUNCTION public.protect_guardian_link_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NULL OR COALESCE(current_setting('app.guardian_link_write', true), '') = 'on' THEN
    IF NEW.status = 'active' AND NEW.verified_at IS NULL AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'GUARDIAN_LINK_UNVERIFIED: an active link needs a verification.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- provision_managed_child: the guardian created this credential-less child account moments ago (20260930120000 checks the service-written
    -- app_metadata and the 15-minute window before it writes managed_accounts, which clients cannot write).
    IF NEW.parent_user_id = auth.uid() AND NEW.status = 'active'
       AND EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = NEW.child_user_id AND m.managed_by = NEW.parent_user_id) THEN
      NEW.verified_at := now();
      NEW.verified_by := NULL;
      NEW.verification_method := 'managed_child_created';
      RETURN NEW;
    END IF;
  ELSIF OLD.status = 'active' AND NEW.status = 'revoked' AND OLD.parent_user_id = auth.uid()
        AND NEW.parent_user_id = OLD.parent_user_id AND NEW.child_user_id = OLD.child_user_id AND NEW.relationship IS NOT DISTINCT FROM OLD.relationship
        AND NEW.verified_at IS NOT DISTINCT FROM OLD.verified_at AND NEW.verified_by IS NOT DISTINCT FROM OLD.verified_by
        AND NEW.verification_method IS NOT DISTINCT FROM OLD.verification_method THEN
    -- revoke_guardian_link: a guardian ends their own link (authority only goes down)
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'GUARDIAN_LINK_WRITE_REFUSED: guardian links change only through verification.' USING ERRCODE = 'insufficient_privilege';
END $$;
REVOKE ALL ON FUNCTION public.protect_guardian_link_write() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS a0_protect_guardian_link_write_trg ON public.guardian_links;
CREATE TRIGGER a0_protect_guardian_link_write_trg BEFORE INSERT OR UPDATE ON public.guardian_links
  FOR EACH ROW EXECUTE FUNCTION public.protect_guardian_link_write();

-- guardian_link_requests: status, decision and verification columns are written only by the definer RPCs below.
CREATE OR REPLACE FUNCTION public.protect_guardian_link_request_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NULL OR COALESCE(current_setting('app.guardian_link_write', true), '') = 'on' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'GUARDIAN_LINK_WRITE_REFUSED: guardian requests change only through their own actions.' USING ERRCODE = 'insufficient_privilege';
END $$;
REVOKE ALL ON FUNCTION public.protect_guardian_link_request_write() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS a0_protect_guardian_link_request_write_trg ON public.guardian_link_requests;
CREATE TRIGGER a0_protect_guardian_link_request_write_trg BEFORE INSERT OR UPDATE ON public.guardian_link_requests
  FOR EACH ROW EXECUTE FUNCTION public.protect_guardian_link_request_write();

-- ------------------------------------------------------------------------------------------------------------------------------ audit triggers
CREATE OR REPLACE FUNCTION private_sec.guardian_audit_actor_role(_ctx jsonb, _guardian uuid, _child uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT COALESCE(NULLIF(_ctx ->> 'actor_role', ''),
                  CASE WHEN auth.uid() IS NULL THEN 'service'
                       WHEN auth.uid() = _guardian THEN 'guardian'
                       WHEN auth.uid() = _child THEN 'child'
                       WHEN public.is_moderator(auth.uid()) THEN 'staff'
                       ELSE 'other' END)
$$;
REVOKE ALL ON FUNCTION private_sec.guardian_audit_actor_role(jsonb, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.audit_guardian_link_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _ctx jsonb := COALESCE(NULLIF(current_setting('app.guardian_audit', true), ''), '{}')::jsonb; _row public.guardian_links; _action text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _row := OLD; _action := 'link_deleted';
  ELSE
    _row := NEW;
    IF TG_OP = 'INSERT' THEN
      _action := CASE WHEN NEW.status = 'active' THEN 'link_activated' ELSE 'link_created_' || NEW.status END;
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      _action := CASE WHEN OLD.status = 'active' AND NEW.status = 'revoked' THEN 'link_revoked'
                      WHEN OLD.status = 'revoked' AND NEW.status = 'active' THEN 'link_restored'
                      ELSE 'link_status_changed' END;
    ELSIF NEW.verified_at IS DISTINCT FROM OLD.verified_at OR NEW.verified_by IS DISTINCT FROM OLD.verified_by THEN
      _action := 'link_reverified';
    ELSE
      RETURN NULL;
    END IF;
  END IF;
  INSERT INTO public.guardian_link_audit (child_user_id, guardian_user_id, link_id, request_id, action, from_status, to_status, actor_id,
                                          actor_role, method, evidence_ref, reason, detail)
  VALUES (_row.child_user_id, _row.parent_user_id, _row.id, NULLIF(_ctx ->> 'request_id', '')::uuid, _action,
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END, CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.status END,
          auth.uid(), private_sec.guardian_audit_actor_role(_ctx, _row.parent_user_id, _row.child_user_id),
          COALESCE(_ctx ->> 'method', _row.verification_method), _ctx ->> 'evidence_ref', _ctx ->> 'reason',
          jsonb_strip_nulls(jsonb_build_object('relationship', _row.relationship, 'verified_by', _row.verified_by,
                                               'guardian_cohort', public.age_cohort_of(_row.parent_user_id), 'signals', _ctx -> 'signals')));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.audit_guardian_link_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_audit_guardian_link_change_trg ON public.guardian_links;
CREATE TRIGGER zz_audit_guardian_link_change_trg AFTER INSERT OR UPDATE OR DELETE ON public.guardian_links
  FOR EACH ROW EXECUTE FUNCTION public.audit_guardian_link_change();

CREATE OR REPLACE FUNCTION public.audit_guardian_link_request_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _ctx jsonb := COALESCE(NULLIF(current_setting('app.guardian_audit', true), ''), '{}')::jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
  INSERT INTO public.guardian_link_audit (child_user_id, guardian_user_id, request_id, action, from_status, to_status, actor_id, actor_role,
                                          method, evidence_ref, reason, detail)
  VALUES (NEW.child_user_id, NEW.parent_user_id, NEW.id,
          CASE WHEN TG_OP = 'INSERT' THEN 'claim_created' ELSE 'claim_' || NEW.status END,
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END, NEW.status,
          auth.uid(), private_sec.guardian_audit_actor_role(_ctx, NEW.parent_user_id, NEW.child_user_id),
          COALESCE(NEW.verification_method, _ctx ->> 'method'), COALESCE(NEW.evidence_ref, _ctx ->> 'evidence_ref'),
          COALESCE(NEW.decision_reason, _ctx ->> 'reason'),
          jsonb_strip_nulls(jsonb_build_object('kind', NEW.kind, 'source', NEW.source, 'signals', to_jsonb(NEW.signals),
                                               'invite_id', NEW.invite_id, 'relationship', NEW.relationship)));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.audit_guardian_link_request_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_audit_guardian_link_request_change_trg ON public.guardian_link_requests;
CREATE TRIGGER zz_audit_guardian_link_request_change_trg AFTER INSERT OR UPDATE ON public.guardian_link_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_guardian_link_request_change();

-- ------------------------------------------------------------------------------------------------------------------------------ invitations
-- Unchanged from 20260902193537 except: expiry is capped at 14 days, and an adult may create at most 10 invitations in 24 hours.
CREATE OR REPLACE FUNCTION public.create_minor_invite(_child_name text, _relationship text, _token_hash text, _expires_at timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid(); _cohort text; _id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: sign in first.';
  END IF;
  SELECT age_cohort INTO _cohort FROM public.profiles WHERE id = _uid;
  IF COALESCE(_cohort, 'unknown') <> 'adult' THEN
    RAISE EXCEPTION 'ADULT_REQUIRED: only an adult account can add a minor.';
  END IF;
  IF _child_name IS NULL OR length(btrim(_child_name)) < 1 THEN
    RAISE EXCEPTION 'NAME_REQUIRED: add the child''s first name.';
  END IF;
  IF _token_hash IS NULL OR length(_token_hash) < 32 THEN
    RAISE EXCEPTION 'TOKEN_INVALID: invitation could not be created.';
  END IF;
  IF _expires_at IS NULL OR _expires_at <= now() THEN
    RAISE EXCEPTION 'TOKEN_INVALID: invitation could not be created.';
  END IF;
  IF (SELECT count(*) FROM public.minor_invites
       WHERE parent_user_id = _uid AND status = 'pending' AND expires_at > now()) >= 20 THEN
    RAISE EXCEPTION 'TOO_MANY_INVITES: cancel an open invitation first.';
  END IF;
  -- SEC-4: rate limit
  IF (SELECT count(*) FROM public.minor_invites WHERE parent_user_id = _uid AND created_at > now() - interval '24 hours') >= 10 THEN
    RAISE EXCEPTION 'TOO_MANY_INVITES: you created many invitations today. Try again tomorrow.';
  END IF;

  INSERT INTO public.minor_invites (parent_user_id, child_name, relationship, token_hash, expires_at)
  VALUES (_uid, btrim(_child_name), COALESCE(NULLIF(btrim(_relationship), ''), 'parent'),
          _token_hash, LEAST(_expires_at, now() + interval '14 days'))   -- SEC-4: never longer than 14 days
  RETURNING id INTO _id;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.create_minor_invite(text, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_minor_invite(text, text, text, timestamptz) TO authenticated;

-- The inviter, or staff, can cancel an invitation before it is used.
CREATE OR REPLACE FUNCTION public.revoke_minor_invite(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: sign in first.';
  END IF;
  UPDATE public.minor_invites
     SET status = 'revoked'
   WHERE id = _id AND status = 'pending' AND (parent_user_id = _uid OR public.is_moderator(_uid));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: that invitation is no longer open.';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.revoke_minor_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_minor_invite(uuid) TO authenticated;

-- Redemption creates a PENDING request; it never creates a guardian link. The return type gains verification_required (the request waits for
-- BallaCity's verification rather than a current guardian), so the function is dropped and re-created (grants restored below).
DROP FUNCTION IF EXISTS public.redeem_minor_invite(text);
CREATE FUNCTION public.redeem_minor_invite(_token_hash text)
 RETURNS TABLE(parent_id uuid, consent_recorded boolean, pending_approval boolean, verification_required boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _uid uuid := auth.uid(); _inv public.minor_invites; _cohort text; _parent uuid; _kind text; _signals text[]; _req uuid;
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
  -- SEC-4: an invitation created before the 14-day cap still expires 14 days after it was created
  IF _inv.expires_at <= now() OR _inv.created_at <= now() - interval '14 days' THEN
    RAISE EXCEPTION 'INVITE_EXPIRED: that invitation has expired.';
  END IF;
  _parent := _inv.parent_user_id;
  IF _parent = _uid THEN
    RAISE EXCEPTION 'INVITE_SELF: you cannot accept your own invitation.';
  END IF;

  SELECT p.age_cohort INTO _cohort FROM public.profiles p WHERE p.id = _uid;
  IF COALESCE(_cohort, 'unknown') = 'unknown' THEN
    RAISE EXCEPTION 'AGE_VERIFICATION_REQUIRED: add your date of birth first.';
  END IF;
  IF _cohort = 'adult' THEN
    RAISE EXCEPTION 'ADULT_CANNOT_REDEEM: family invitations are for players under 18.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- SEC-4: the inviter must still be an eligible adult (a suspended or re-aged account's old link is dead)
  IF NOT private_sec.guardian_eligible(_parent) THEN
    RAISE EXCEPTION 'INVITE_INVALID: that invitation link is not valid.';
  END IF;
  IF public.blocks_exist_between(_parent, _uid) THEN
    RAISE EXCEPTION 'INVITE_INVALID: that invitation link is not valid.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.guardian_links g WHERE g.parent_user_id = _parent AND g.child_user_id = _uid) THEN
    RAISE EXCEPTION 'ALREADY_LINKED: you are already connected to this parent or guardian.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.guardian_link_requests r
              WHERE r.child_user_id = _uid AND r.parent_user_id = _parent AND r.status = 'pending') THEN
    RAISE EXCEPTION 'ALREADY_REQUESTED: this request is already waiting for approval.';
  END IF;
  -- SEC-4: rate limits, so a leaked or mass-produced link cannot flood a child or let one adult hold many claims
  IF (SELECT count(*) FROM public.guardian_link_requests r WHERE r.child_user_id = _uid AND r.created_at > now() - interval '24 hours') >= 3
     OR (SELECT count(*) FROM public.guardian_link_requests r WHERE r.child_user_id = _uid AND r.status = 'pending' AND r.kind = 'first_guardian') >= 2
     OR (SELECT count(*) FROM public.guardian_link_requests r WHERE r.parent_user_id = _parent AND r.status = 'pending' AND r.kind = 'first_guardian') >= 3 THEN
    RAISE EXCEPTION 'CLAIM_RATE_LIMITED: this invitation cannot be used right now. Try again later or contact support.';
  END IF;

  _kind := CASE WHEN private_sec.has_guardian_link(_uid) THEN 'additional_guardian' ELSE 'first_guardian' END;
  _signals := private_sec.guardian_claim_signals(_parent, _uid);

  PERFORM private_sec.guardian_write_begin(jsonb_build_object('actor_role', 'child'));
  INSERT INTO public.guardian_link_requests (child_user_id, parent_user_id, relationship, invite_id, kind, source, signals)
  VALUES (_uid, _parent, _inv.relationship, _inv.id, _kind, 'family_invite', COALESCE(_signals, '{}'))
  RETURNING id INTO _req;
  PERFORM private_sec.guardian_write_end();

  UPDATE public.minor_invites SET status = 'redeemed', child_user_id = _uid, redeemed_at = now() WHERE id = _inv.id;

  IF _kind = 'additional_guardian' THEN
    PERFORM public.notify_guardians_of(_uid, 'guardian_approval', 'Approve a new guardian',
      'Someone asked to be added as a parent or guardian of your child. Open Guardian to approve or decline. Nothing changes until you approve.',
      '/guardian');
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_uid, 'guardian_link', 'Waiting for your parent or guardian',
            'Your current parent or guardian needs to approve this new connection.', '/settings');
  ELSE
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_uid, 'guardian_link', 'Waiting for verification',
            'BallaCity verifies every new parent or guardian before they get any access. You can cancel this request from the invitation page.', '/settings'),
           (_parent, 'guardian_link', 'Family invitation accepted: verification next',
            'BallaCity verifies every new parent or guardian before the connection turns on. Our team will contact you.', '/parent');
  END IF;

  RETURN QUERY SELECT _parent, false, true, (_kind = 'first_guardian');
END $function$;
REVOKE ALL ON FUNCTION public.redeem_minor_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_minor_invite(text) TO authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------------------ consent email
-- The consent email is not independent of the child (the child types the address), so a click on it never creates or re-activates a link.
-- A verified guardian approving their own child's consent works as before. Anyone else becomes a pending claim and the consent stays pending
-- until the claim is verified (staff) or approved (a current guardian), at which point the consent is recorded with the versions given here.
-- Still service-role only (20260902010016): the app calls it after the approver signs in with an adult account.
CREATE OR REPLACE FUNCTION public.approve_parental_consent(_token_hash text, _method text, _parent_user uuid, _versions jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r public.parental_consents; days int; _kind text; _signals text[];
BEGIN
  SELECT * INTO r FROM public.parental_consents WHERE verification_token_hash = _token_hash AND _token_hash IS NOT NULL FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'CONSENT_TOKEN_INVALID'; END IF;
  IF r.token_expires_at IS NOT NULL AND r.token_expires_at < now() THEN
    UPDATE public.parental_consents SET status = 'expired', verification_token_hash = NULL WHERE id = r.id;
    RAISE EXCEPTION 'CONSENT_TOKEN_EXPIRED';
  END IF;
  IF _method NOT IN ('email_confirmation','third_party_verified','manual_review') THEN
    RAISE EXCEPTION 'CONSENT_METHOD_NOT_ALLOWED';
  END IF;
  -- SEC-4: fail closed. Consent is given by a known, eligible adult who is not the child.
  IF _parent_user IS NULL OR _parent_user = r.child_user_id OR NOT private_sec.guardian_eligible(_parent_user) THEN
    RAISE EXCEPTION 'GUARDIAN_NOT_ELIGIBLE: only an adult account can approve a child account.';
  END IF;

  IF public.is_guardian_of(_parent_user, r.child_user_id) THEN
    -- an already verified guardian approving their own child's consent: unchanged
    days := public.age_policy_number('consent_reverification_days', 0);
    UPDATE public.parental_consents SET
      status = 'approved', method = _method, parent_user_id = _parent_user, approved_at = now(), revoked_at = NULL, revoked_reason = NULL,
      verification_token_hash = NULL, token_expires_at = NULL,
      reverify_at = CASE WHEN days > 0 THEN now() + make_interval(days => days) ELSE NULL END,
      privacy_version = COALESCE(_versions ->> 'privacy', privacy_version), terms_version = COALESCE(_versions ->> 'terms', terms_version),
      child_policy_version = COALESCE(_versions ->> 'child_policy', child_policy_version), scope = COALESCE(_versions -> 'scope', scope)
    WHERE id = r.id;
    INSERT INTO public.child_controls (child_user_id, updated_by) VALUES (r.child_user_id, _parent_user) ON CONFLICT (child_user_id) DO NOTHING;
    INSERT INTO public.parental_consent_events (consent_id, child_user_id, actor_id, action, from_status, to_status, method)
    VALUES (r.id, r.child_user_id, _parent_user, 'consent_approved', r.status, 'approved', _method);
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (r.child_user_id, 'guardian_link', 'Your account is approved',
            'A parent or guardian approved your ballaCity account. Games, messages and videos follow their settings.', '/feed'),
           (_parent_user, 'guardian_link', 'Child account approved',
            'You approved a child account. Manage their safety settings in the Parent Center.', '/parent');
    RETURN r.id;
  END IF;

  -- Anyone else: the link is single use from here; a pending claim waits for independent verification.
  UPDATE public.parental_consents SET verification_token_hash = NULL, token_expires_at = NULL WHERE id = r.id;
  IF EXISTS (SELECT 1 FROM public.guardian_links g WHERE g.parent_user_id = _parent_user AND g.child_user_id = r.child_user_id) THEN
    RAISE EXCEPTION 'ALREADY_LINKED: this account was linked before; contact support to restore it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.guardian_link_requests q
                  WHERE q.child_user_id = r.child_user_id AND q.parent_user_id = _parent_user AND q.status = 'pending') THEN
    _kind := CASE WHEN private_sec.has_guardian_link(r.child_user_id) THEN 'additional_guardian' ELSE 'first_guardian' END;
    _signals := private_sec.guardian_claim_signals(_parent_user, r.child_user_id);
    PERFORM private_sec.guardian_write_begin(jsonb_build_object('actor_role', 'claimant'));
    INSERT INTO public.guardian_link_requests (child_user_id, parent_user_id, relationship, kind, source, signals, consent_id, consent_versions)
    VALUES (r.child_user_id, _parent_user, COALESCE(r.relationship, 'guardian'), _kind, 'consent_email', COALESCE(_signals, '{}'), r.id,
            jsonb_strip_nulls(jsonb_build_object('privacy', _versions ->> 'privacy', 'terms', _versions ->> 'terms',
                                                 'child_policy', _versions ->> 'child_policy', 'scope', _versions -> 'scope', 'method', _method)));
    PERFORM private_sec.guardian_write_end();
    IF _kind = 'additional_guardian' THEN
      PERFORM public.notify_guardians_of(r.child_user_id, 'guardian_approval', 'Approve a new guardian',
        'Someone asked to be added as a parent or guardian of your child. Open Guardian to approve or decline. Nothing changes until you approve.',
        '/guardian');
    END IF;
  END IF;
  INSERT INTO public.parental_consent_events (consent_id, child_user_id, actor_id, action, from_status, to_status, method, detail)
  VALUES (r.id, r.child_user_id, _parent_user, 'consent_guardian_claimed', r.status, r.status, _method,
          jsonb_build_object('verification', 'pending'));
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_parent_user, 'guardian_link', 'Thanks: verification next',
          'BallaCity verifies every new parent or guardian before the account is approved. Our team will contact you.', '/parent');
  RETURN r.id;
END $$;
REVOKE ALL ON FUNCTION public.approve_parental_consent(text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_parental_consent(text, text, uuid, jsonb) TO service_role;

-- ------------------------------------------------------------------------------------------------------------------------------ activation
-- Shared by the two activation paths (staff verification, a current guardian's approval). Callers hold the request row locked.
CREATE OR REPLACE FUNCTION private_sec.guardian_activate(_r public.guardian_link_requests, _actor uuid, _actor_role text, _method text, _evidence text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _link uuid;
BEGIN
  PERFORM private_sec.guardian_write_begin(jsonb_build_object('actor_role', _actor_role, 'method', _method, 'evidence_ref', _evidence,
                                                              'request_id', _r.id, 'signals', to_jsonb(_r.signals)));
  INSERT INTO public.guardian_links (parent_user_id, child_user_id, relationship, status, verified_at, verified_by, verification_method)
  VALUES (_r.parent_user_id, _r.child_user_id, _r.relationship, 'active', now(), _actor, _method)
  ON CONFLICT (parent_user_id, child_user_id)
    DO UPDATE SET status = 'active', verified_at = now(), verified_by = EXCLUDED.verified_by, verification_method = EXCLUDED.verification_method
  RETURNING id INTO _link;
  UPDATE public.guardian_link_requests
     SET status = 'approved', decided_by = _actor, decided_at = now(), verification_method = _method, evidence_ref = _evidence
   WHERE id = _r.id;
  PERFORM private_sec.guardian_write_end();

  PERFORM private_sec.guardian_apply_consent(_r.child_user_id, _r.parent_user_id, _r.relationship, _actor, COALESCE(_r.consent_versions, '{}'::jsonb),
                                             jsonb_build_object('source', 'guardian_verification', 'request_id', _r.id, 'verified_by_role', _actor_role));
  INSERT INTO public.child_controls (child_user_id, updated_by) VALUES (_r.child_user_id, _r.parent_user_id) ON CONFLICT (child_user_id) DO NOTHING;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_r.parent_user_id, 'guardian_link', 'Family invitation accepted', 'You are now linked as a parent or guardian.', '/parent'),
         (_r.child_user_id, 'guardian_link', 'Parent or guardian connected', 'Your parent or guardian was verified and is now connected.', '/settings');
  RETURN _link;
END $$;
REVOKE ALL ON FUNCTION private_sec.guardian_activate(public.guardian_link_requests, uuid, text, text, text) FROM PUBLIC, anon, authenticated;

-- (a) Staff verification: a moderator, admin or superadmin who is not a party records how they verified the guardian and a reference to the
-- evidence (a case or ticket reference, never the document itself).
CREATE OR REPLACE FUNCTION public.staff_verify_guardian_claim(_request uuid, _method text, _evidence_ref text, _acknowledge_signals boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _r public.guardian_link_requests; _ref text := btrim(COALESCE(_evidence_ref, ''));
BEGIN
  IF _me IS NULL OR NOT public.is_moderator(_me) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only BallaCity staff verify guardians.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO _r FROM public.guardian_link_requests WHERE id = _request AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND: nothing to verify.' USING ERRCODE = 'no_data_found'; END IF;
  IF _me IN (_r.parent_user_id, _r.child_user_id) THEN
    RAISE EXCEPTION 'CONFLICT_OF_INTEREST: a party cannot verify their own relationship.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _method IS NULL OR _method NOT IN ('government_id', 'consent_document', 'video_call', 'school_or_league_record', 'court_order', 'other') THEN
    RAISE EXCEPTION 'METHOD_INVALID: choose how the guardian was verified.';
  END IF;
  IF length(_ref) < 4 OR length(_ref) > 200 THEN
    RAISE EXCEPTION 'EVIDENCE_REQUIRED: record a reference to the evidence you checked (4 to 200 characters).';
  END IF;
  IF NOT private_sec.guardian_eligible(_r.parent_user_id) THEN
    RAISE EXCEPTION 'GUARDIAN_NOT_ELIGIBLE: the guardian must be a verified adult in good standing.';
  END IF;
  IF COALESCE(public.age_cohort_of(_r.child_user_id), 'unknown') = 'adult' THEN
    RAISE EXCEPTION 'CHILD_NOT_MINOR: this account is no longer a minor.';
  END IF;
  IF public.blocks_exist_between(_r.parent_user_id, _r.child_user_id) THEN
    RAISE EXCEPTION 'BLOCKED: one of them has blocked the other.';
  END IF;
  -- re-read: the claimant may have built a relationship with the child since the claim was made
  _r.signals := ARRAY(SELECT DISTINCT unnest(_r.signals || COALESCE(private_sec.guardian_claim_signals(_r.parent_user_id, _r.child_user_id), '{}')));
  IF cardinality(_r.signals) > 0 AND NOT COALESCE(_acknowledge_signals, false) THEN
    RAISE EXCEPTION 'SIGNALS_NOT_ACKNOWLEDGED: this claimant already shares %; confirm you checked that before verifying.',
      array_to_string(_r.signals, ', ');
  END IF;
  RETURN private_sec.guardian_activate(_r, _me, 'staff', _method, _ref);
END $$;
REVOKE ALL ON FUNCTION public.staff_verify_guardian_claim(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_verify_guardian_claim(uuid, text, text, boolean) TO authenticated;

-- A current verified guardian approves or declines a pending request (R7), now through the shared activation and the audit.
CREATE OR REPLACE FUNCTION public.guardian_decide_link_request(_request uuid, _approve boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _r public.guardian_link_requests;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT * INTO _r FROM public.guardian_link_requests WHERE id = _request AND status = 'pending' FOR UPDATE;
  IF NOT FOUND OR _me IN (_r.parent_user_id, _r.child_user_id) OR NOT public.is_guardian_of(_me, _r.child_user_id) THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND: nothing to decide.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT _approve OR NOT private_sec.guardian_eligible(_r.parent_user_id) OR public.blocks_exist_between(_r.parent_user_id, _r.child_user_id) THEN
    PERFORM private_sec.guardian_write_begin(jsonb_build_object('actor_role', 'guardian'));
    UPDATE public.guardian_link_requests SET status = 'declined', decided_by = _me, decided_at = now() WHERE id = _request;
    PERFORM private_sec.guardian_write_end();
    RETURN 'declined';
  END IF;
  PERFORM private_sec.guardian_activate(_r, _me, 'guardian', 'existing_guardian_approval', NULL);
  RETURN 'approved';
END $$;
REVOKE ALL ON FUNCTION public.guardian_decide_link_request(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardian_decide_link_request(uuid, boolean) TO authenticated, service_role;

-- Staff decline a claim (with a reason that the parties can read in the audit).
CREATE OR REPLACE FUNCTION public.staff_decline_guardian_claim(_request uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _why text := btrim(COALESCE(_reason, ''));
BEGIN
  IF _me IS NULL OR NOT public.is_moderator(_me) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only BallaCity staff decide guardian claims.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(_why) < 4 OR length(_why) > 500 THEN RAISE EXCEPTION 'REASON_REQUIRED: give a reason (4 to 500 characters).'; END IF;
  PERFORM private_sec.guardian_write_begin(jsonb_build_object('actor_role', 'staff', 'reason', _why));
  UPDATE public.guardian_link_requests SET status = 'declined', decided_by = _me, decided_at = now(), decision_reason = _why
   WHERE id = _request AND status = 'pending' AND _me NOT IN (parent_user_id, child_user_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND: nothing to decline.' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM private_sec.guardian_write_end();
END $$;
REVOKE ALL ON FUNCTION public.staff_decline_guardian_claim(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_decline_guardian_claim(uuid, text) TO authenticated;

-- The child (or the claimant) withdraws a pending claim: a leaked or unwanted invitation is undone by the person it was used on.
CREATE OR REPLACE FUNCTION public.withdraw_guardian_claim(_request uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED: sign in first.' USING ERRCODE = 'insufficient_privilege'; END IF;
  PERFORM private_sec.guardian_write_begin('{}'::jsonb);
  UPDATE public.guardian_link_requests SET status = 'withdrawn', decided_by = _me, decided_at = now()
   WHERE id = _request AND status = 'pending' AND _me IN (child_user_id, parent_user_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND: nothing to cancel.' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM private_sec.guardian_write_end();
END $$;
REVOKE ALL ON FUNCTION public.withdraw_guardian_claim(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_guardian_claim(uuid) TO authenticated;

-- ------------------------------------------------------------------------------------------------------------------------------ recovery
-- Staff revoke a link (a fraudulent or mistaken guardian). The guardian's consent record is withdrawn as revoke_guardian_link does.
CREATE OR REPLACE FUNCTION public.staff_revoke_guardian_link(_link uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _l public.guardian_links; _why text := btrim(COALESCE(_reason, ''));
BEGIN
  IF _me IS NULL OR NOT public.is_moderator(_me) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only BallaCity staff revoke guardian links.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(_why) < 4 OR length(_why) > 500 THEN RAISE EXCEPTION 'REASON_REQUIRED: give a reason (4 to 500 characters).'; END IF;
  SELECT * INTO _l FROM public.guardian_links WHERE id = _link AND status = 'active' FOR UPDATE;
  IF NOT FOUND OR _me IN (_l.parent_user_id, _l.child_user_id) THEN
    RAISE EXCEPTION 'LINK_NOT_FOUND: no active link to revoke.' USING ERRCODE = 'no_data_found';
  END IF;
  -- the audit records the guardian's age band and eligibility at the moment of revocation
  PERFORM private_sec.guardian_write_begin(jsonb_build_object('actor_role', 'staff', 'reason', _why,
                                                              'method', CASE WHEN private_sec.guardian_eligible(_l.parent_user_id)
                                                                             THEN 'staff_revocation' ELSE 'staff_revocation_ineligible_guardian' END));
  UPDATE public.guardian_links SET status = 'revoked' WHERE id = _link;
  PERFORM private_sec.guardian_write_end();
  UPDATE public.parental_consents
     SET status = 'revoked', revoked_at = now(), revoked_reason = 'Guardian link revoked by BallaCity staff', updated_at = now()
   WHERE child_user_id = _l.child_user_id AND parent_user_id = _l.parent_user_id AND status <> 'revoked';
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_l.parent_user_id, 'guardian_link', 'Guardian connection removed', 'BallaCity removed your guardian connection. Contact support with questions.', '/parent'),
         (_l.child_user_id, 'guardian_link', 'Guardian connection removed', 'BallaCity removed a parent or guardian connection from your account.', '/settings');
END $$;
REVOKE ALL ON FUNCTION public.staff_revoke_guardian_link(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_revoke_guardian_link(uuid, text) TO authenticated;

-- Staff restore a wrongly revoked link, with a fresh verification (method + evidence reference), re-checking the guardian and the child.
CREATE OR REPLACE FUNCTION public.staff_restore_guardian_link(_link uuid, _reason text, _evidence_ref text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _l public.guardian_links; _why text := btrim(COALESCE(_reason, '')); _ref text := btrim(COALESCE(_evidence_ref, ''));
BEGIN
  IF _me IS NULL OR NOT public.is_moderator(_me) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only BallaCity staff restore guardian links.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(_why) < 4 OR length(_why) > 500 THEN RAISE EXCEPTION 'REASON_REQUIRED: give a reason (4 to 500 characters).'; END IF;
  IF length(_ref) < 4 OR length(_ref) > 200 THEN
    RAISE EXCEPTION 'EVIDENCE_REQUIRED: record a reference to the evidence you checked (4 to 200 characters).';
  END IF;
  SELECT * INTO _l FROM public.guardian_links WHERE id = _link AND status = 'revoked' FOR UPDATE;
  IF NOT FOUND OR _me IN (_l.parent_user_id, _l.child_user_id) THEN
    RAISE EXCEPTION 'LINK_NOT_FOUND: no revoked link to restore.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT private_sec.guardian_eligible(_l.parent_user_id) THEN
    RAISE EXCEPTION 'GUARDIAN_NOT_ELIGIBLE: the guardian must be a verified adult in good standing.';
  END IF;
  IF COALESCE(public.age_cohort_of(_l.child_user_id), 'unknown') = 'adult' THEN
    RAISE EXCEPTION 'CHILD_NOT_MINOR: this account is no longer a minor.';
  END IF;
  IF public.blocks_exist_between(_l.parent_user_id, _l.child_user_id) THEN
    RAISE EXCEPTION 'BLOCKED: one of them has blocked the other.';
  END IF;
  PERFORM private_sec.guardian_write_begin(jsonb_build_object('actor_role', 'staff', 'reason', _why, 'evidence_ref', _ref, 'method', 'staff_restoration'));
  UPDATE public.guardian_links SET status = 'active', verified_at = now(), verified_by = _me, verification_method = 'staff_restoration' WHERE id = _link;
  PERFORM private_sec.guardian_write_end();
  PERFORM private_sec.guardian_apply_consent(_l.child_user_id, _l.parent_user_id, _l.relationship, _me, '{}'::jsonb,
                                             jsonb_build_object('source', 'staff_restoration', 'link_id', _link));
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_l.parent_user_id, 'guardian_link', 'Guardian connection restored', 'BallaCity restored your guardian connection.', '/parent'),
         (_l.child_user_id, 'guardian_link', 'Guardian connection restored', 'BallaCity restored a parent or guardian connection on your account.', '/settings');
END $$;
REVOKE ALL ON FUNCTION public.staff_restore_guardian_link(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_restore_guardian_link(uuid, text, text) TO authenticated;

-- ------------------------------------------------------------------------------------------------------------------------------ staff queue
CREATE OR REPLACE FUNCTION public.staff_guardian_claims()
RETURNS TABLE(request_id uuid, kind text, source text, relationship text, signals text[], created_at timestamptz,
              child_user_id uuid, child_name text, child_cohort text, guardian_user_id uuid, guardian_name text, guardian_email text,
              guardian_cohort text, guardian_eligible boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT r.id, r.kind, r.source, r.relationship,
           ARRAY(SELECT DISTINCT unnest(r.signals || COALESCE(private_sec.guardian_claim_signals(r.parent_user_id, r.child_user_id), '{}'))),
           r.created_at, r.child_user_id, cp.display_name, COALESCE(cp.age_cohort, 'unknown'),
           r.parent_user_id, gp.display_name, gu.email::text, COALESCE(gp.age_cohort, 'unknown'), private_sec.guardian_eligible(r.parent_user_id)
      FROM public.guardian_link_requests r
      LEFT JOIN public.profiles cp ON cp.id = r.child_user_id
      LEFT JOIN public.profiles gp ON gp.id = r.parent_user_id
      LEFT JOIN auth.users gu ON gu.id = r.parent_user_id
     WHERE r.status = 'pending' AND auth.uid() NOT IN (r.child_user_id, r.parent_user_id)
     ORDER BY r.created_at
     LIMIT 200;
END $$;
REVOKE ALL ON FUNCTION public.staff_guardian_claims() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_guardian_claims() TO authenticated;

-- SEC-2 containment: this migration adds policies that name wrapped helpers (is_moderator, is_guardian_of) by their public name; re-wrap so
-- they point at the private copies.
DO $$ BEGIN IF to_regprocedure('private_sec.wrap_oracle_helpers()') IS NOT NULL THEN PERFORM private_sec.wrap_oracle_helpers(); END IF; END $$;
