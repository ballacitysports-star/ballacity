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
--   9. Finalization (owner requirements, independent review of PR #279):
--      * Two-person rule. A claim is SUSPICIOUS when it has a relationship signal, the redeemer's names do not plausibly match the
--        invitation's child_name, the claimant has other pending or declined claims, the method is 'other', it was reopened on appeal, or it
--        is an account recovery or the restoration of a link revoked for suspected fraud. A suspicious claim needs a first review and then a
--        second review by a different staff member; the link is activated only by the second. Nobody who is a party, submitted the claim
--        or declined it before an appeal may review it. A non-suspicious claim still needs one verifier who is not a party.
--      * Evidence references are case references: 8 to 64 characters matching ^[A-Z]{2,10}-[0-9]{4,}(-[A-Z0-9]{1,20})?$ (e.g. GV-20261104,
--        ZD-48213-B), never free text, a URL, an e-mail address or a document.
--      * The staff queue shows the invitation's child_name next to the redeemer's profile names, with a name_match flag.
--      * Appeals: the claimant or the child files one appeal per staff-declined claim (30-day window, 3 per 30 days); a staff member other
--        than the decliner decides it; an upheld appeal reopens the claim, which then needs two reviewers. Audited.
--      * Recovery: account recovery re-links only to a verified identity through the two-person rule; restoring a link revoked for
--        suspected fraud needs two staff; a compromised guardian's authority is suspended at once (every link 'suspended', device pairings
--        revoked, no new activation) until a different staff member lifts the hold (reinstate, or revoke).
--      * has_guardian_link no longer counts a managed_accounts row on its own: only an active, verified link counts, so a staff revocation
--        or suspension of a managed child's guardian takes effect. notify_guardians_of and create_device_pairing follow the same rule.
--      * The adult-eligibility check (and child-still-a-minor) runs inside guardian_activate, so every activation path runs it.
--      Operations: docs/privacy/guardian-verification-operations.md.
--
-- NOT CHANGED: is_guardian_of (already requires status = 'active' AND verified_at IS NOT NULL; a pending claim lives in guardian_link_requests
-- and is never a guardian_links row), existing guardian_links rows, managed-child provisioning, revoke_guardian_link.
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
     OR to_regprocedure('public.notify_guardians_of(uuid,text,text,text,text)') IS NULL
     OR to_regclass('public.managed_device_pairings') IS NULL
     OR to_regprocedure('public.create_device_pairing(uuid,text,text,integer)') IS NULL THEN
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
-- Two-person review, separation of submission and verification, appeals and recovery (see the header, item 9).
ALTER TABLE public.guardian_link_requests ADD COLUMN IF NOT EXISTS submitted_by uuid;              -- staff who opened a recovery claim
ALTER TABLE public.guardian_link_requests ADD COLUMN IF NOT EXISTS suspicion text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.guardian_link_requests ADD COLUMN IF NOT EXISTS first_review_by uuid;
ALTER TABLE public.guardian_link_requests ADD COLUMN IF NOT EXISTS first_review_at timestamptz;
ALTER TABLE public.guardian_link_requests ADD COLUMN IF NOT EXISTS first_review_method text;
ALTER TABLE public.guardian_link_requests ADD COLUMN IF NOT EXISTS first_review_evidence_ref text;
ALTER TABLE public.guardian_link_requests ADD COLUMN IF NOT EXISTS second_review_by uuid;
ALTER TABLE public.guardian_link_requests ADD COLUMN IF NOT EXISTS decided_role text;              -- 'staff' or 'guardian' for a decline
ALTER TABLE public.guardian_link_requests ADD COLUMN IF NOT EXISTS barred_reviewer uuid;           -- the decliner, once an appeal reopens it
ALTER TABLE public.guardian_link_requests ADD COLUMN IF NOT EXISTS recovery_link_id uuid;          -- the link a recovery replaces or restores
ALTER TABLE public.guardian_link_requests DROP CONSTRAINT IF EXISTS guardian_link_requests_kind_check;
ALTER TABLE public.guardian_link_requests ADD CONSTRAINT guardian_link_requests_kind_check
  CHECK (kind IN ('first_guardian', 'additional_guardian', 'account_recovery', 'link_restoration'));
ALTER TABLE public.guardian_link_requests DROP CONSTRAINT IF EXISTS guardian_link_requests_source_check;
ALTER TABLE public.guardian_link_requests ADD CONSTRAINT guardian_link_requests_source_check CHECK (source IN ('family_invite', 'consent_email', 'staff_recovery'));
ALTER TABLE public.guardian_link_requests DROP CONSTRAINT IF EXISTS guardian_link_requests_review_check;
ALTER TABLE public.guardian_link_requests ADD CONSTRAINT guardian_link_requests_review_check
  CHECK (second_review_by IS NULL OR (first_review_by IS NOT NULL AND second_review_by <> first_review_by));
-- 'suspended': a compromised guardian's authority is held pending review. Every guardian gate requires status = 'active', so it grants nothing.
ALTER TABLE public.guardian_links DROP CONSTRAINT IF EXISTS guardian_links_status_check;
ALTER TABLE public.guardian_links ADD CONSTRAINT guardian_links_status_check CHECK (status IN ('active', 'revoked', 'suspended'));
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
  child_user_id uuid,                -- NULL only for a guardian-wide action (an authority suspension and its lifting)
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

-- Appeals against a staff decline: one per claim, filed by the claimant or the child, decided by staff other than the decliner.
CREATE TABLE IF NOT EXISTS public.guardian_claim_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES public.guardian_link_requests(id) ON DELETE CASCADE,
  child_user_id uuid NOT NULL,
  claimant_user_id uuid NOT NULL,
  filed_by uuid NOT NULL,
  filed_role text NOT NULL CHECK (filed_role IN ('claimant', 'child')),
  reason text NOT NULL,
  decliner uuid,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'upheld', 'rejected')),
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (decided_by IS NULL OR decliner IS NULL OR decided_by <> decliner)
);
CREATE INDEX IF NOT EXISTS guardian_claim_appeals_open_idx ON public.guardian_claim_appeals (created_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS guardian_claim_appeals_filer_idx ON public.guardian_claim_appeals (filed_by, created_at DESC);
ALTER TABLE public.guardian_claim_appeals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guardian_claim_appeals FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.guardian_claim_appeals TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.guardian_claim_appeals TO service_role;
DROP POLICY IF EXISTS "Staff and the parties read guardian claim appeals" ON public.guardian_claim_appeals;
CREATE POLICY "Staff and the parties read guardian claim appeals" ON public.guardian_claim_appeals FOR SELECT TO authenticated
  USING (child_user_id = auth.uid() OR claimant_user_id = auth.uid() OR public.is_moderator(auth.uid()));

-- A compromised guardian account: guardian authority is held (every link 'suspended', no new activation) until staff lift the hold.
CREATE TABLE IF NOT EXISTS public.guardian_authority_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  placed_by uuid NOT NULL,
  placed_at timestamptz NOT NULL DEFAULT now(),
  suspended_links uuid[] NOT NULL DEFAULT '{}',
  lifted_by uuid,
  lifted_at timestamptz,
  lift_reason text,
  lift_evidence_ref text,
  outcome text CHECK (outcome IN ('reinstated', 'revoked')),
  CHECK (lifted_by IS NULL OR lifted_by <> placed_by)
);
CREATE UNIQUE INDEX IF NOT EXISTS guardian_authority_holds_one_open ON public.guardian_authority_holds (guardian_user_id) WHERE lifted_at IS NULL;
ALTER TABLE public.guardian_authority_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guardian_authority_holds FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.guardian_authority_holds TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.guardian_authority_holds TO service_role;
DROP POLICY IF EXISTS "Staff and the guardian read authority holds" ON public.guardian_authority_holds;
CREATE POLICY "Staff and the guardian read authority holds" ON public.guardian_authority_holds FOR SELECT TO authenticated
  USING (guardian_user_id = auth.uid() OR public.is_moderator(auth.uid()));

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

-- An adult who may hold guardian authority: a known adult age not under review, not suspended, never a managed (credential-less) account,
-- and not under a guardian-authority hold (a compromised account, pending review).
CREATE OR REPLACE FUNCTION private_sec.guardian_eligible(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = _user AND p.age_cohort = 'adult' AND NOT COALESCE(p.age_review_required, false) AND p.suspended_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.managed_accounts m WHERE m.child_user_id = _user)
     AND NOT EXISTS (SELECT 1 FROM public.guardian_authority_holds h WHERE h.guardian_user_id = _user AND h.lifted_at IS NULL)
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

-- An evidence reference is a case reference in the support system, never the evidence: 8 to 64 characters, a 2-10 letter prefix, a hyphen,
-- at least 4 digits and an optional suffix (GV-20261104, ZD-48213-B). Free text, URLs, e-mail addresses and file names do not match.
-- Returns the normalized (upper-case, trimmed) reference, or NULL when it does not match.
CREATE OR REPLACE FUNCTION private_sec.guardian_case_ref(_ref text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE WHEN length(v) BETWEEN 8 AND 64 AND v ~ '^[A-Z]{2,10}-[0-9]{4,}(-[A-Z0-9]{1,20})?$' THEN v END
    FROM (SELECT upper(btrim(COALESCE(_ref, ''))) AS v) x
$$;
REVOKE ALL ON FUNCTION private_sec.guardian_case_ref(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.guardian_case_ref(text) TO service_role;

-- Does the name the inviter typed plausibly name this account? Any word of one (2+ letters) equals a word of the other, or one starts with
-- the other with at least 3 letters in common (Sam / Samantha, Alex / Alexander). NULL when there is no invitation name to compare.
-- Deliberately loose: a mismatch does not refuse anything, it only routes the claim to two reviewers.
CREATE OR REPLACE FUNCTION private_sec.guardian_name_plausible(_invite_name text, _names text[])
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $$
DECLARE a text; b text; n text;
BEGIN
  IF _invite_name IS NULL OR btrim(_invite_name) = '' THEN RETURN NULL; END IF;
  FOREACH a IN ARRAY regexp_split_to_array(lower(_invite_name), '[^[:alpha:]]+') LOOP
    CONTINUE WHEN length(a) < 2;
    FOREACH n IN ARRAY COALESCE(_names, '{}'::text[]) LOOP
      CONTINUE WHEN n IS NULL;
      FOREACH b IN ARRAY regexp_split_to_array(lower(n), '[^[:alpha:]]+') LOOP
        CONTINUE WHEN length(b) < 2;
        IF a = b OR (least(length(a), length(b)) >= 3 AND (starts_with(a, b) OR starts_with(b, a))) THEN RETURN true; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION private_sec.guardian_name_plausible(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.guardian_name_plausible(text, text[]) TO service_role;

-- The invitation's child_name compared with the redeemer's display name and username (NULL: no invitation, e.g. a consent-email claim).
CREATE OR REPLACE FUNCTION private_sec.guardian_claim_name_match(_r public.guardian_link_requests)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT private_sec.guardian_name_plausible(
           (SELECT i.child_name FROM public.minor_invites i WHERE i.id = _r.invite_id),
           (SELECT ARRAY[p.display_name, p.username] FROM public.profiles p WHERE p.id = _r.child_user_id))
$$;
REVOKE ALL ON FUNCTION private_sec.guardian_claim_name_match(public.guardian_link_requests) FROM PUBLIC, anon, authenticated;

-- Why a claim needs two reviewers (empty: one verifier is enough). The reasons stored on the claim (a first review, an appeal, a recovery)
-- are kept; the live ones are recomputed, so a relationship or another claim that appears while the claim waits still counts.
CREATE OR REPLACE FUNCTION private_sec.guardian_claim_suspicion(_r public.guardian_link_requests, _method text)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _out text[] := COALESCE(_r.suspicion, '{}'::text[]);
BEGIN
  IF cardinality(_r.signals) > 0 OR cardinality(COALESCE(private_sec.guardian_claim_signals(_r.parent_user_id, _r.child_user_id), '{}'::text[])) > 0 THEN
    _out := _out || 'relationship_signals'::text;
  END IF;
  IF private_sec.guardian_claim_name_match(_r) IS FALSE THEN
    _out := _out || 'name_mismatch'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.guardian_link_requests o
              WHERE o.parent_user_id = _r.parent_user_id AND o.id <> _r.id AND o.status IN ('pending', 'declined')) THEN
    _out := _out || 'other_claims'::text;
  END IF;
  IF _method = 'other' THEN
    _out := _out || 'method_other'::text;
  END IF;
  IF _r.kind IN ('account_recovery', 'link_restoration') THEN
    _out := _out || _r.kind;
  END IF;
  RETURN ARRAY(SELECT DISTINCT x FROM unnest(_out) x ORDER BY x);
END $$;
REVOKE ALL ON FUNCTION private_sec.guardian_claim_suspicion(public.guardian_link_requests, text) FROM PUBLIC, anon, authenticated;

-- Staff who may not review a claim: its parties, the staff member who submitted it, and (after an appeal) the staff member who declined it.
CREATE OR REPLACE FUNCTION private_sec.guardian_claim_conflict(_r public.guardian_link_requests, _me uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT _me IN (_r.parent_user_id, _r.child_user_id) OR _me IS NOT DISTINCT FROM _r.submitted_by OR _me IS NOT DISTINCT FROM _r.barred_reviewer
$$;
REVOKE ALL ON FUNCTION private_sec.guardian_claim_conflict(public.guardian_link_requests, uuid) FROM PUBLIC, anon, authenticated;

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
-- Appeals and authority holds: the same rule (clients have no write grant at all; this covers a definer path that forgets the flag).
DROP TRIGGER IF EXISTS a0_protect_guardian_claim_appeal_write_trg ON public.guardian_claim_appeals;
CREATE TRIGGER a0_protect_guardian_claim_appeal_write_trg BEFORE INSERT OR UPDATE ON public.guardian_claim_appeals
  FOR EACH ROW EXECUTE FUNCTION public.protect_guardian_link_request_write();
DROP TRIGGER IF EXISTS a0_protect_guardian_authority_hold_write_trg ON public.guardian_authority_holds;
CREATE TRIGGER a0_protect_guardian_authority_hold_write_trg BEFORE INSERT OR UPDATE ON public.guardian_authority_holds
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
      _action := CASE WHEN NEW.status = 'revoked' THEN 'link_revoked'
                      WHEN OLD.status = 'revoked' AND NEW.status = 'active' THEN 'link_restored'
                      WHEN NEW.status = 'suspended' THEN 'link_suspended'
                      WHEN OLD.status = 'suspended' AND NEW.status = 'active' THEN 'link_reinstated'
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
                                               'guardian_cohort', public.age_cohort_of(_row.parent_user_id), 'signals', _ctx -> 'signals')
                            || COALESCE(_ctx -> 'detail', '{}'::jsonb)));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.audit_guardian_link_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_audit_guardian_link_change_trg ON public.guardian_links;
CREATE TRIGGER zz_audit_guardian_link_change_trg AFTER INSERT OR UPDATE OR DELETE ON public.guardian_links
  FOR EACH ROW EXECUTE FUNCTION public.audit_guardian_link_change();

CREATE OR REPLACE FUNCTION public.audit_guardian_link_request_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _ctx jsonb := COALESCE(NULLIF(current_setting('app.guardian_audit', true), ''), '{}')::jsonb; _action text;
        _method text; _ref text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _action := 'claim_created';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    _action := CASE WHEN NEW.status = 'pending' THEN 'claim_reopened' ELSE 'claim_' || NEW.status END;
  ELSIF NEW.first_review_by IS NOT NULL AND OLD.first_review_by IS NULL THEN
    _action := 'claim_first_review';      -- the first of a two-person approval: recorded, nothing activated
  ELSE
    RETURN NULL;
  END IF;
  IF _action = 'claim_first_review' THEN
    _method := NEW.first_review_method; _ref := NEW.first_review_evidence_ref;
  ELSIF _action = 'claim_approved' THEN
    _method := COALESCE(NEW.verification_method, _ctx ->> 'method'); _ref := COALESCE(NEW.evidence_ref, _ctx ->> 'evidence_ref');
  ELSE
    _method := _ctx ->> 'method'; _ref := _ctx ->> 'evidence_ref';
  END IF;
  INSERT INTO public.guardian_link_audit (child_user_id, guardian_user_id, request_id, action, from_status, to_status, actor_id, actor_role,
                                          method, evidence_ref, reason, detail)
  VALUES (NEW.child_user_id, NEW.parent_user_id, NEW.id, _action,
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END, NEW.status,
          auth.uid(), private_sec.guardian_audit_actor_role(_ctx, NEW.parent_user_id, NEW.child_user_id),
          _method, _ref,
          COALESCE(_ctx ->> 'reason', CASE WHEN _action = 'claim_declined' THEN NEW.decision_reason END),
          jsonb_strip_nulls(jsonb_build_object('kind', NEW.kind, 'source', NEW.source, 'signals', to_jsonb(NEW.signals),
                                               'invite_id', NEW.invite_id, 'relationship', NEW.relationship,
                                               'suspicion', CASE WHEN cardinality(NEW.suspicion) > 0 THEN to_jsonb(NEW.suspicion) END,
                                               'submitted_by', NEW.submitted_by, 'first_review_by', NEW.first_review_by,
                                               'second_review_by', NEW.second_review_by, 'barred_reviewer', NEW.barred_reviewer,
                                               'recovery_link_id', NEW.recovery_link_id))
            || COALESCE(_ctx -> 'detail', '{}'::jsonb));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.audit_guardian_link_request_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_audit_guardian_link_request_change_trg ON public.guardian_link_requests;
CREATE TRIGGER zz_audit_guardian_link_request_change_trg AFTER INSERT OR UPDATE ON public.guardian_link_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_guardian_link_request_change();

CREATE OR REPLACE FUNCTION public.audit_guardian_claim_appeal_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _ctx jsonb := COALESCE(NULLIF(current_setting('app.guardian_audit', true), ''), '{}')::jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
  INSERT INTO public.guardian_link_audit (child_user_id, guardian_user_id, request_id, action, from_status, to_status, actor_id, actor_role,
                                          reason, detail)
  VALUES (NEW.child_user_id, NEW.claimant_user_id, NEW.request_id,
          CASE WHEN TG_OP = 'INSERT' THEN 'appeal_filed' ELSE 'appeal_' || NEW.status END,
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END, NEW.status,
          auth.uid(), COALESCE(NULLIF(_ctx ->> 'actor_role', ''), CASE WHEN TG_OP = 'INSERT' THEN NEW.filed_role ELSE 'staff' END),
          CASE WHEN TG_OP = 'INSERT' THEN NEW.reason ELSE NEW.decision_reason END,
          jsonb_strip_nulls(jsonb_build_object('appeal_id', NEW.id, 'decliner', NEW.decliner, 'filed_by', NEW.filed_by)));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.audit_guardian_claim_appeal_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_audit_guardian_claim_appeal_change_trg ON public.guardian_claim_appeals;
CREATE TRIGGER zz_audit_guardian_claim_appeal_change_trg AFTER INSERT OR UPDATE ON public.guardian_claim_appeals
  FOR EACH ROW EXECUTE FUNCTION public.audit_guardian_claim_appeal_change();

CREATE OR REPLACE FUNCTION public.audit_guardian_authority_hold_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.lifted_at IS NULL OR OLD.lifted_at IS NOT NULL) THEN RETURN NULL; END IF;
  INSERT INTO public.guardian_link_audit (child_user_id, guardian_user_id, action, actor_id, actor_role, evidence_ref, reason, detail)
  VALUES (NULL, NEW.guardian_user_id,
          CASE WHEN TG_OP = 'INSERT' THEN 'guardian_authority_suspended' ELSE 'guardian_authority_hold_lifted' END,
          auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'service' ELSE 'staff' END,
          CASE WHEN TG_OP = 'UPDATE' THEN NEW.lift_evidence_ref END,
          CASE WHEN TG_OP = 'INSERT' THEN NEW.reason ELSE NEW.lift_reason END,
          jsonb_strip_nulls(jsonb_build_object('hold_id', NEW.id, 'placed_by', NEW.placed_by, 'outcome', NEW.outcome,
                                               'suspended_links', to_jsonb(NEW.suspended_links))));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.audit_guardian_authority_hold_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_audit_guardian_authority_hold_change_trg ON public.guardian_authority_holds;
CREATE TRIGGER zz_audit_guardian_authority_hold_change_trg AFTER INSERT OR UPDATE ON public.guardian_authority_holds
  FOR EACH ROW EXECUTE FUNCTION public.audit_guardian_authority_hold_change();

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
-- Shared by every activation path (staff verification, the second review of a two-person approval, a current guardian's approval, a
-- fraud-revocation restoration, an account recovery). Callers hold the request row locked. The adult-eligibility check runs HERE, so no path
-- can activate a guardian who is not an eligible adult today, or a child who is no longer a minor.
DROP FUNCTION IF EXISTS private_sec.guardian_activate(public.guardian_link_requests, uuid, text, text, text);
CREATE OR REPLACE FUNCTION private_sec.guardian_activate(_r public.guardian_link_requests, _actor uuid, _actor_role text, _method text,
                                                         _evidence text, _detail jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _link uuid; _second uuid := CASE WHEN _r.first_review_by IS NOT NULL THEN _actor END; _old public.guardian_links;
BEGIN
  IF NOT private_sec.guardian_eligible(_r.parent_user_id) THEN
    RAISE EXCEPTION 'GUARDIAN_NOT_ELIGIBLE: the guardian must be a verified adult in good standing.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF COALESCE(public.age_cohort_of(_r.child_user_id), 'unknown') = 'adult' THEN
    RAISE EXCEPTION 'CHILD_NOT_MINOR: this account is no longer a minor.';
  END IF;
  IF public.blocks_exist_between(_r.parent_user_id, _r.child_user_id) THEN
    RAISE EXCEPTION 'BLOCKED: one of them has blocked the other.';
  END IF;
  IF _r.first_review_by IS NOT NULL AND _r.first_review_by = _actor THEN
    RAISE EXCEPTION 'SECOND_REVIEWER_REQUIRED: a different staff member must make the second review.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM private_sec.guardian_write_begin(jsonb_build_object(
    'actor_role', _actor_role, 'method', _method, 'evidence_ref', _evidence, 'request_id', _r.id, 'signals', to_jsonb(_r.signals),
    'reason', _detail ->> 'reason',
    'detail', jsonb_strip_nulls(jsonb_build_object('kind', _r.kind,
                                                   'suspicion', CASE WHEN cardinality(_r.suspicion) > 0 THEN to_jsonb(_r.suspicion) END,
                                                   'first_review_by', _r.first_review_by, 'second_review_by', _second))
              || (COALESCE(_detail, '{}'::jsonb) - 'reason')));
  INSERT INTO public.guardian_links (parent_user_id, child_user_id, relationship, status, verified_at, verified_by, verification_method)
  VALUES (_r.parent_user_id, _r.child_user_id, _r.relationship, 'active', now(), _actor, _method)
  ON CONFLICT (parent_user_id, child_user_id)
    DO UPDATE SET status = 'active', verified_at = now(), verified_by = EXCLUDED.verified_by, verification_method = EXCLUDED.verification_method
  RETURNING id INTO _link;
  UPDATE public.guardian_link_requests
     SET status = 'approved', decided_by = _actor, decided_at = now(), verification_method = _method, evidence_ref = _evidence,
         second_review_by = _second, suspicion = COALESCE(_r.suspicion, '{}'), signals = COALESCE(_r.signals, '{}')
   WHERE id = _r.id;
  -- account recovery: the lost account's link ends as the verified account's link begins
  IF _r.kind = 'account_recovery' AND _r.recovery_link_id IS NOT NULL THEN
    -- the lost account is presumed compromised: restoring its link later needs two staff members
    PERFORM set_config('app.guardian_audit', jsonb_build_object('actor_role', _actor_role, 'method', 'account_recovery', 'request_id', _r.id,
                                                                'reason', 'Replaced by a verified account (account recovery)',
                                                                'detail', jsonb_build_object('suspected_fraud', true))::text, true);
    UPDATE public.guardian_links SET status = 'revoked'
     WHERE id = _r.recovery_link_id AND child_user_id = _r.child_user_id AND status IN ('active', 'suspended')
    RETURNING * INTO _old;
    IF _old.id IS NOT NULL THEN
      UPDATE public.parental_consents
         SET status = 'revoked', revoked_at = now(), revoked_reason = 'Guardian account replaced through account recovery', updated_at = now()
       WHERE child_user_id = _old.child_user_id AND parent_user_id = _old.parent_user_id AND status <> 'revoked';
      UPDATE public.managed_device_pairings SET status = 'revoked', revoked_at = now(), revoked_by = _actor
       WHERE child_user_id = _old.child_user_id AND created_by = _old.parent_user_id AND status = 'linked';
    END IF;
  END IF;
  PERFORM private_sec.guardian_write_end();

  PERFORM private_sec.guardian_apply_consent(_r.child_user_id, _r.parent_user_id, _r.relationship, _actor, COALESCE(_r.consent_versions, '{}'::jsonb),
                                             jsonb_build_object('source', 'guardian_verification', 'request_id', _r.id, 'verified_by_role', _actor_role));
  INSERT INTO public.child_controls (child_user_id, updated_by) VALUES (_r.child_user_id, _r.parent_user_id) ON CONFLICT (child_user_id) DO NOTHING;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_r.parent_user_id, 'guardian_link',
          CASE _r.kind WHEN 'link_restoration' THEN 'Guardian connection restored' WHEN 'account_recovery' THEN 'Guardian access recovered'
                       ELSE 'Family invitation accepted' END,
          'You are now linked as a parent or guardian.', '/parent'),
         (_r.child_user_id, 'guardian_link', 'Parent or guardian connected', 'Your parent or guardian was verified and is now connected.', '/settings');
  RETURN _link;
END $$;
REVOKE ALL ON FUNCTION private_sec.guardian_activate(public.guardian_link_requests, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Shared input checks for staff verification steps.
CREATE OR REPLACE FUNCTION private_sec.guardian_verification_method_ok(_method text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT _method IS NOT NULL AND _method IN ('government_id', 'consent_document', 'video_call', 'school_or_league_record', 'court_order', 'other')
$$;
REVOKE ALL ON FUNCTION private_sec.guardian_verification_method_ok(text) FROM PUBLIC, anon, authenticated;

-- (a) Staff verification: a moderator, admin or superadmin who is not a party (nor the submitter, nor a decliner barred after an appeal)
-- records how they verified the guardian and a case reference to the evidence (never the evidence itself).
--   * A claim with no suspicion reason is activated by this one verifier ('activated').
--   * A suspicious claim (guardian_claim_suspicion) is only recorded as the FIRST review ('second_review_required'); a different staff member
--     calling this again makes the second review and only that activates the link. Both reviews are audited.
DROP FUNCTION IF EXISTS public.staff_verify_guardian_claim(uuid, text, text, boolean);
CREATE FUNCTION public.staff_verify_guardian_claim(_request uuid, _method text, _evidence_ref text, _acknowledge_signals boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _r public.guardian_link_requests; _ref text := private_sec.guardian_case_ref(_evidence_ref); _susp text[];
BEGIN
  IF _me IS NULL OR NOT public.is_moderator(_me) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only BallaCity staff verify guardians.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO _r FROM public.guardian_link_requests WHERE id = _request AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND: nothing to verify.' USING ERRCODE = 'no_data_found'; END IF;
  IF private_sec.guardian_claim_conflict(_r, _me) THEN
    RAISE EXCEPTION 'CONFLICT_OF_INTEREST: a party, the submitter or the staff member who declined it cannot verify this claim.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _r.first_review_by = _me THEN
    RAISE EXCEPTION 'SECOND_REVIEWER_REQUIRED: you made the first review; a different staff member must make the second.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT private_sec.guardian_verification_method_ok(_method) THEN
    RAISE EXCEPTION 'METHOD_INVALID: choose how the guardian was verified.';
  END IF;
  IF _ref IS NULL THEN
    RAISE EXCEPTION 'EVIDENCE_REQUIRED: record the case reference (8 to 64 characters, like GV-20261104 or ZD-48213-B), never the document.';
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
  _susp := private_sec.guardian_claim_suspicion(_r, _method);

  IF _r.first_review_by IS NULL AND cardinality(_susp) > 0 THEN
    PERFORM private_sec.guardian_write_begin(jsonb_build_object('actor_role', 'staff'));
    UPDATE public.guardian_link_requests
       SET first_review_by = _me, first_review_at = now(), first_review_method = _method, first_review_evidence_ref = _ref,
           suspicion = _susp, signals = _r.signals
     WHERE id = _r.id;
    PERFORM private_sec.guardian_write_end();
    RETURN 'second_review_required';
  END IF;

  _r.suspicion := _susp;
  PERFORM private_sec.guardian_activate(_r, _me, 'staff', _method, _ref, '{}'::jsonb);
  RETURN 'activated';
END $$;
REVOKE ALL ON FUNCTION public.staff_verify_guardian_claim(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_verify_guardian_claim(uuid, text, text, boolean) TO authenticated;

-- A current verified guardian approves or declines a pending first- or additional-guardian request (R7), through the shared activation and
-- the audit. Recovery and restoration requests are staff-only.
CREATE OR REPLACE FUNCTION public.guardian_decide_link_request(_request uuid, _approve boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _r public.guardian_link_requests;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT * INTO _r FROM public.guardian_link_requests WHERE id = _request AND status = 'pending' FOR UPDATE;
  IF NOT FOUND OR _me IN (_r.parent_user_id, _r.child_user_id) OR NOT public.is_guardian_of(_me, _r.child_user_id)
     OR _r.kind NOT IN ('first_guardian', 'additional_guardian') THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND: nothing to decide.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT _approve OR NOT private_sec.guardian_eligible(_r.parent_user_id) OR public.blocks_exist_between(_r.parent_user_id, _r.child_user_id) THEN
    PERFORM private_sec.guardian_write_begin(jsonb_build_object('actor_role', 'guardian'));
    UPDATE public.guardian_link_requests SET status = 'declined', decided_by = _me, decided_at = now(), decided_role = 'guardian' WHERE id = _request;
    PERFORM private_sec.guardian_write_end();
    RETURN 'declined';
  END IF;
  PERFORM private_sec.guardian_activate(_r, _me, 'guardian', 'existing_guardian_approval', NULL, '{}'::jsonb);
  RETURN 'approved';
END $$;
REVOKE ALL ON FUNCTION public.guardian_decide_link_request(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardian_decide_link_request(uuid, boolean) TO authenticated, service_role;

-- Staff decline a claim (with a reason that the parties can read in the audit). One staff member may decline: it grants nothing.
CREATE OR REPLACE FUNCTION public.staff_decline_guardian_claim(_request uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _why text := btrim(COALESCE(_reason, '')); _r public.guardian_link_requests;
BEGIN
  IF _me IS NULL OR NOT public.is_moderator(_me) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only BallaCity staff decide guardian claims.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(_why) < 4 OR length(_why) > 500 THEN RAISE EXCEPTION 'REASON_REQUIRED: give a reason (4 to 500 characters).'; END IF;
  SELECT * INTO _r FROM public.guardian_link_requests WHERE id = _request AND status = 'pending' FOR UPDATE;
  IF NOT FOUND OR private_sec.guardian_claim_conflict(_r, _me) THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND: nothing to decline.' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM private_sec.guardian_write_begin(jsonb_build_object('actor_role', 'staff', 'reason', _why));
  UPDATE public.guardian_link_requests SET status = 'declined', decided_by = _me, decided_at = now(), decided_role = 'staff', decision_reason = _why
   WHERE id = _request;
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

-- ------------------------------------------------------------------------------------------------------------------------------ appeals
-- The claimant or the child appeals a claim BallaCity staff declined: one appeal per claim, within 30 days of the decline, at most 3 appeals
-- per person in 30 days. A guardian's own decline of an additional guardian is a family decision and is not appealable here (support).
CREATE OR REPLACE FUNCTION public.file_guardian_claim_appeal(_request uuid, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _r public.guardian_link_requests; _why text := btrim(COALESCE(_reason, '')); _role text; _id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED: sign in first.' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT * INTO _r FROM public.guardian_link_requests WHERE id = _request FOR UPDATE;
  IF NOT FOUND OR _me NOT IN (_r.parent_user_id, _r.child_user_id) THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND: nothing to appeal.' USING ERRCODE = 'no_data_found';
  END IF;
  IF length(_why) < 20 OR length(_why) > 1000 THEN
    RAISE EXCEPTION 'APPEAL_REASON_REQUIRED: explain why the decision was wrong (20 to 1000 characters).';
  END IF;
  IF _r.status <> 'declined' OR _r.decided_role IS DISTINCT FROM 'staff' THEN
    RAISE EXCEPTION 'APPEAL_NOT_AVAILABLE: only a claim BallaCity declined can be appealed.';
  END IF;
  IF _r.decided_at < now() - interval '30 days' THEN
    RAISE EXCEPTION 'APPEAL_WINDOW_CLOSED: appeals are accepted for 30 days after the decision. Contact support.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.guardian_claim_appeals a WHERE a.request_id = _r.id) THEN
    RAISE EXCEPTION 'APPEAL_EXISTS: this decision was already appealed.';
  END IF;
  IF (SELECT count(*) FROM public.guardian_claim_appeals a WHERE a.filed_by = _me AND a.created_at > now() - interval '30 days') >= 3 THEN
    RAISE EXCEPTION 'APPEAL_RATE_LIMITED: you filed several appeals recently. Contact support.';
  END IF;
  _role := CASE WHEN _me = _r.child_user_id THEN 'child' ELSE 'claimant' END;
  PERFORM private_sec.guardian_write_begin(jsonb_build_object('actor_role', _role));
  INSERT INTO public.guardian_claim_appeals (request_id, child_user_id, claimant_user_id, filed_by, filed_role, reason, decliner)
  VALUES (_r.id, _r.child_user_id, _r.parent_user_id, _me, _role, _why, _r.decided_by)
  RETURNING id INTO _id;
  PERFORM private_sec.guardian_write_end();
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_me, 'guardian_link', 'Appeal received',
          'A BallaCity team member who did not make the first decision will review your appeal.', '/settings');
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.file_guardian_claim_appeal(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.file_guardian_claim_appeal(uuid, text) TO authenticated;

-- Staff other than the decliner decide an appeal. Upheld: the claim goes back to the queue as pending, marked reopened_on_appeal (so it needs
-- two reviewers) and with the decliner barred from reviewing it. Rejected: the decline stands. Nothing is activated here.
CREATE OR REPLACE FUNCTION public.staff_decide_guardian_claim_appeal(_appeal uuid, _uphold boolean, _reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _a public.guardian_claim_appeals; _r public.guardian_link_requests; _why text := btrim(COALESCE(_reason, ''));
        _status text := CASE WHEN _uphold THEN 'upheld' ELSE 'rejected' END;
BEGIN
  IF _me IS NULL OR NOT public.is_moderator(_me) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only BallaCity staff decide appeals.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _uphold IS NULL THEN RAISE EXCEPTION 'DECISION_REQUIRED: uphold or reject the appeal.'; END IF;
  IF length(_why) < 4 OR length(_why) > 500 THEN RAISE EXCEPTION 'REASON_REQUIRED: give a reason (4 to 500 characters).'; END IF;
  SELECT * INTO _a FROM public.guardian_claim_appeals WHERE id = _appeal AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'APPEAL_NOT_FOUND: no open appeal.' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO _r FROM public.guardian_link_requests WHERE id = _a.request_id FOR UPDATE;
  IF _me IN (_a.child_user_id, _a.claimant_user_id) OR _me IS NOT DISTINCT FROM _a.decliner OR _me IS NOT DISTINCT FROM _r.submitted_by THEN
    RAISE EXCEPTION 'CONFLICT_OF_INTEREST: the staff member who declined the claim, or a party, cannot decide its appeal.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _uphold AND EXISTS (SELECT 1 FROM public.guardian_link_requests q
                          WHERE q.child_user_id = _r.child_user_id AND q.parent_user_id = _r.parent_user_id AND q.status = 'pending') THEN
    RAISE EXCEPTION 'CLAIM_ALREADY_OPEN: a newer claim between them is already waiting; review that one.';
  END IF;
  PERFORM private_sec.guardian_write_begin(jsonb_build_object('actor_role', 'staff', 'reason', _why,
                                                              'detail', jsonb_build_object('appeal_id', _a.id)));
  UPDATE public.guardian_claim_appeals SET status = _status, decided_by = _me, decided_at = now(), decision_reason = _why WHERE id = _a.id;
  IF _uphold THEN
    UPDATE public.guardian_link_requests
       SET status = 'pending', barred_reviewer = _r.decided_by, decided_by = NULL, decided_at = NULL, decided_role = NULL, decision_reason = NULL,
           first_review_by = NULL, first_review_at = NULL, first_review_method = NULL, first_review_evidence_ref = NULL, second_review_by = NULL,
           suspicion = ARRAY(SELECT DISTINCT x FROM unnest(_r.suspicion || ARRAY['reopened_on_appeal']) x ORDER BY x)
     WHERE id = _r.id;
  END IF;
  PERFORM private_sec.guardian_write_end();
  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT DISTINCT u, 'guardian_link', CASE WHEN _uphold THEN 'Appeal accepted: verification reopened' ELSE 'Appeal decided' END,
         CASE WHEN _uphold THEN 'BallaCity will review this parent or guardian request again. Nothing changes until it is verified.'
              ELSE 'BallaCity reviewed the appeal and the earlier decision stands. Contact support with questions.' END, '/settings'
    FROM unnest(ARRAY[_a.child_user_id, _a.claimant_user_id]) u;
  RETURN _status;
END $$;
REVOKE ALL ON FUNCTION public.staff_decide_guardian_claim_appeal(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_decide_guardian_claim_appeal(uuid, boolean, text) TO authenticated;

-- ------------------------------------------------------------------------------------------------------------------------------ recovery
-- Staff revoke a link (a fraudulent or mistaken guardian), active or suspended. The guardian's consent record is withdrawn as
-- revoke_guardian_link does, and the guardian's open device pairings for that child are revoked. _suspected_fraud marks the revocation in
-- the audit; restoring such a link then needs two staff members.
DROP FUNCTION IF EXISTS public.staff_revoke_guardian_link(uuid, text);
CREATE OR REPLACE FUNCTION public.staff_revoke_guardian_link(_link uuid, _reason text, _suspected_fraud boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _l public.guardian_links; _why text := btrim(COALESCE(_reason, ''));
BEGIN
  IF _me IS NULL OR NOT public.is_moderator(_me) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only BallaCity staff revoke guardian links.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(_why) < 4 OR length(_why) > 500 THEN RAISE EXCEPTION 'REASON_REQUIRED: give a reason (4 to 500 characters).'; END IF;
  SELECT * INTO _l FROM public.guardian_links WHERE id = _link AND status IN ('active', 'suspended') FOR UPDATE;
  IF NOT FOUND OR _me IN (_l.parent_user_id, _l.child_user_id) THEN
    RAISE EXCEPTION 'LINK_NOT_FOUND: no active link to revoke.' USING ERRCODE = 'no_data_found';
  END IF;
  -- the audit records the guardian's age band and eligibility at the moment of revocation, and whether fraud is suspected
  PERFORM private_sec.guardian_write_begin(jsonb_build_object('actor_role', 'staff', 'reason', _why,
                                                              'method', CASE WHEN private_sec.guardian_eligible(_l.parent_user_id)
                                                                             THEN 'staff_revocation' ELSE 'staff_revocation_ineligible_guardian' END,
                                                              'detail', jsonb_strip_nulls(jsonb_build_object(
                                                                'suspected_fraud', CASE WHEN COALESCE(_suspected_fraud, false)
                                                                                          -- a suspended link, or one whose guardian is under an
                                                                                          -- open hold, is revoked during a security review
                                                                                          OR _l.status = 'suspended'
                                                                                          OR EXISTS (SELECT 1 FROM public.guardian_authority_holds h
                                                                                                      WHERE h.guardian_user_id = _l.parent_user_id
                                                                                                        AND h.lifted_at IS NULL)
                                                                                        THEN true END))));
  UPDATE public.guardian_links SET status = 'revoked' WHERE id = _link;
  PERFORM private_sec.guardian_write_end();
  UPDATE public.parental_consents
     SET status = 'revoked', revoked_at = now(), revoked_reason = 'Guardian link revoked by BallaCity staff', updated_at = now()
   WHERE child_user_id = _l.child_user_id AND parent_user_id = _l.parent_user_id AND status <> 'revoked';
  UPDATE public.managed_device_pairings SET status = 'revoked', revoked_at = now(), revoked_by = _me
   WHERE child_user_id = _l.child_user_id AND created_by = _l.parent_user_id AND status = 'linked';
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_l.parent_user_id, 'guardian_link', 'Guardian connection removed', 'BallaCity removed your guardian connection. Contact support with questions.', '/parent'),
         (_l.child_user_id, 'guardian_link', 'Guardian connection removed', 'BallaCity removed a parent or guardian connection from your account.', '/settings');
END $$;
REVOKE ALL ON FUNCTION public.staff_revoke_guardian_link(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_revoke_guardian_link(uuid, text, boolean) TO authenticated;

-- Does restoring this link need two staff members? Fail-safe: true when ANY of these holds, so no compromise path can be undone by one person:
--   * any revocation of the link was recorded as suspected fraud (a staff revocation that said so, a revocation of a suspended link or
--     during an open hold, a hold lifted with the outcome 'revoked', or an account recovery that replaced the guardian's account);
--   * any revocation of the link came from account recovery (also covers audit rows written before the flag was added);
--   * the link was ever suspended by a hold that was not lifted with 'reinstated';
--   * the guardian has an open hold, or a hold lifted with the outcome 'revoked'.
CREATE OR REPLACE FUNCTION private_sec.guardian_link_revoked_for_fraud(_link uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.guardian_link_audit a
                  WHERE a.link_id = _link AND a.action = 'link_revoked'
                    AND (COALESCE((a.detail ->> 'suspected_fraud')::boolean, false) OR a.method = 'account_recovery'))
      OR EXISTS (SELECT 1 FROM public.guardian_authority_holds h
                  WHERE _link = ANY (h.suspended_links) AND h.outcome IS DISTINCT FROM 'reinstated')
      OR EXISTS (SELECT 1 FROM public.guardian_links g JOIN public.guardian_authority_holds h ON h.guardian_user_id = g.parent_user_id
                  WHERE g.id = _link AND (h.lifted_at IS NULL OR h.outcome = 'revoked'))
$$;
REVOKE ALL ON FUNCTION private_sec.guardian_link_revoked_for_fraud(uuid) FROM PUBLIC, anon, authenticated;

-- Staff restore a wrongly revoked link, with a fresh verification (case reference), re-checking the guardian and the child. When the
-- revocation was for suspected fraud this is a two-person approval: the first call records the first review in a 'link_restoration'
-- request ('second_review_required'); a different staff member's call (or staff_verify_guardian_claim on that request) restores it.
DROP FUNCTION IF EXISTS public.staff_restore_guardian_link(uuid, text, text);
CREATE FUNCTION public.staff_restore_guardian_link(_link uuid, _reason text, _evidence_ref text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _l public.guardian_links; _why text := btrim(COALESCE(_reason, '')); _ref text := private_sec.guardian_case_ref(_evidence_ref);
        _r public.guardian_link_requests; _rid uuid;
BEGIN
  IF _me IS NULL OR NOT public.is_moderator(_me) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only BallaCity staff restore guardian links.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(_why) < 4 OR length(_why) > 500 THEN RAISE EXCEPTION 'REASON_REQUIRED: give a reason (4 to 500 characters).'; END IF;
  IF _ref IS NULL THEN
    RAISE EXCEPTION 'EVIDENCE_REQUIRED: record the case reference (8 to 64 characters, like GV-20261104 or ZD-48213-B), never the document.';
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

  IF private_sec.guardian_link_revoked_for_fraud(_link) THEN
    SELECT * INTO _r FROM public.guardian_link_requests
     WHERE kind = 'link_restoration' AND recovery_link_id = _link AND status = 'pending' FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM private_sec.guardian_write_begin(jsonb_build_object('actor_role', 'staff', 'reason', _why));
      INSERT INTO public.guardian_link_requests (child_user_id, parent_user_id, relationship, kind, source, recovery_link_id, suspicion)
      VALUES (_l.child_user_id, _l.parent_user_id, _l.relationship, 'link_restoration', 'staff_recovery', _link,
              ARRAY['fraud_revocation', 'link_restoration'])
      RETURNING id INTO _rid;
      UPDATE public.guardian_link_requests
         SET first_review_by = _me, first_review_at = now(), first_review_method = 'staff_restoration', first_review_evidence_ref = _ref
       WHERE id = _rid;
      PERFORM private_sec.guardian_write_end();
      RETURN 'second_review_required';
    END IF;
    IF _r.first_review_by = _me OR private_sec.guardian_claim_conflict(_r, _me) THEN
      RAISE EXCEPTION 'SECOND_REVIEWER_REQUIRED: you made the first review; a different staff member must make the second.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    _r.suspicion := private_sec.guardian_claim_suspicion(_r, 'staff_restoration');
    PERFORM private_sec.guardian_activate(_r, _me, 'staff', 'staff_restoration', _ref, jsonb_build_object('reason', _why));
    RETURN 'restored';
  END IF;

  PERFORM private_sec.guardian_write_begin(jsonb_build_object('actor_role', 'staff', 'reason', _why, 'evidence_ref', _ref, 'method', 'staff_restoration'));
  UPDATE public.guardian_links SET status = 'active', verified_at = now(), verified_by = _me, verification_method = 'staff_restoration' WHERE id = _link;
  PERFORM private_sec.guardian_write_end();
  PERFORM private_sec.guardian_apply_consent(_l.child_user_id, _l.parent_user_id, _l.relationship, _me, '{}'::jsonb,
                                             jsonb_build_object('source', 'staff_restoration', 'link_id', _link));
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_l.parent_user_id, 'guardian_link', 'Guardian connection restored', 'BallaCity restored your guardian connection.', '/parent'),
         (_l.child_user_id, 'guardian_link', 'Guardian connection restored', 'BallaCity restored a parent or guardian connection on your account.', '/settings');
  RETURN 'restored';
END $$;
REVOKE ALL ON FUNCTION public.staff_restore_guardian_link(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_restore_guardian_link(uuid, text, text) TO authenticated;

-- Account recovery: a guardian who lost access to their account is re-linked ONLY to a new account that is a verified adult (confirmed e-mail,
-- adult age, in good standing). Staff open an 'account_recovery' claim for the new account; it is always suspicious, so two OTHER staff
-- members (the submitter may not review it) verify it through staff_verify_guardian_claim. Activation revokes the lost account's link.
CREATE OR REPLACE FUNCTION public.staff_open_guardian_recovery(_old_link uuid, _new_guardian uuid, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _l public.guardian_links; _why text := btrim(COALESCE(_reason, '')); _id uuid;
BEGIN
  IF _me IS NULL OR NOT public.is_moderator(_me) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only BallaCity staff open account recoveries.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(_why) < 4 OR length(_why) > 500 THEN RAISE EXCEPTION 'REASON_REQUIRED: give a reason (4 to 500 characters).'; END IF;
  SELECT * INTO _l FROM public.guardian_links WHERE id = _old_link;
  IF NOT FOUND THEN RAISE EXCEPTION 'LINK_NOT_FOUND: no guardian link to recover.' USING ERRCODE = 'no_data_found'; END IF;
  IF _me IN (_l.parent_user_id, _l.child_user_id) OR _me = _new_guardian THEN
    RAISE EXCEPTION 'CONFLICT_OF_INTEREST: a party cannot open their own recovery.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _new_guardian IS NULL OR _new_guardian IN (_l.parent_user_id, _l.child_user_id) THEN
    RAISE EXCEPTION 'RECOVERY_INVALID: recovery links a different, new adult account.';
  END IF;
  IF NOT private_sec.guardian_eligible(_new_guardian)
     OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _new_guardian AND u.email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'GUARDIAN_NOT_ELIGIBLE: the new account must be a verified adult with a confirmed e-mail, in good standing.';
  END IF;
  IF COALESCE(public.age_cohort_of(_l.child_user_id), 'unknown') = 'adult' THEN
    RAISE EXCEPTION 'CHILD_NOT_MINOR: this account is no longer a minor.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.guardian_links g WHERE g.parent_user_id = _new_guardian AND g.child_user_id = _l.child_user_id) THEN
    RAISE EXCEPTION 'ALREADY_LINKED: that account was linked to this child before; use restore instead.';
  END IF;
  PERFORM private_sec.guardian_write_begin(jsonb_build_object('actor_role', 'staff', 'reason', _why));
  INSERT INTO public.guardian_link_requests (child_user_id, parent_user_id, relationship, kind, source, submitted_by, recovery_link_id, suspicion, signals)
  VALUES (_l.child_user_id, _new_guardian, _l.relationship, 'account_recovery', 'staff_recovery', _me, _old_link, ARRAY['account_recovery'],
          COALESCE(private_sec.guardian_claim_signals(_new_guardian, _l.child_user_id), '{}'))
  RETURNING id INTO _id;
  PERFORM private_sec.guardian_write_end();
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_new_guardian, 'guardian_link', 'Account recovery under review',
          'BallaCity is verifying your identity before your guardian access moves to this account. Nothing changes until it is verified.', '/parent');
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.staff_open_guardian_recovery(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_open_guardian_recovery(uuid, uuid, text) TO authenticated;

-- A compromised guardian account: one staff member suspends the guardian's authority at once (removing authority is always safe). Every
-- active link becomes 'suspended' (no guardian gate accepts it), open device pairings are revoked, and guardian_eligible is false while the
-- hold is open, so no claim, restoration or recovery can activate this account. Consent records are left as they are (the child did nothing).
CREATE OR REPLACE FUNCTION public.staff_suspend_guardian_authority(_guardian uuid, _reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _why text := btrim(COALESCE(_reason, '')); _links uuid[]; _hold uuid;
BEGIN
  IF _me IS NULL OR NOT public.is_moderator(_me) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only BallaCity staff suspend guardian authority.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(_why) < 4 OR length(_why) > 500 THEN RAISE EXCEPTION 'REASON_REQUIRED: give a reason (4 to 500 characters).'; END IF;
  IF _guardian IS NULL OR _me = _guardian
     OR EXISTS (SELECT 1 FROM public.guardian_links g WHERE g.parent_user_id = _guardian AND g.child_user_id = _me) THEN
    RAISE EXCEPTION 'CONFLICT_OF_INTEREST: a party cannot act on this guardian.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM public.guardian_authority_holds h WHERE h.guardian_user_id = _guardian AND h.lifted_at IS NULL) THEN
    RAISE EXCEPTION 'HOLD_EXISTS: this guardian is already suspended.';
  END IF;
  PERFORM 1 FROM public.guardian_links g WHERE g.parent_user_id = _guardian AND g.status = 'active' FOR UPDATE;
  SELECT COALESCE(array_agg(g.id ORDER BY g.id), '{}') INTO _links
    FROM public.guardian_links g WHERE g.parent_user_id = _guardian AND g.status = 'active';
  PERFORM private_sec.guardian_write_begin(jsonb_build_object('actor_role', 'staff', 'reason', _why, 'method', 'staff_suspension'));
  INSERT INTO public.guardian_authority_holds (guardian_user_id, reason, placed_by, suspended_links)
  VALUES (_guardian, _why, _me, _links) RETURNING id INTO _hold;
  UPDATE public.guardian_links SET status = 'suspended' WHERE id = ANY (_links);
  PERFORM private_sec.guardian_write_end();
  UPDATE public.managed_device_pairings SET status = 'revoked', revoked_at = now(), revoked_by = _me
   WHERE created_by = _guardian AND status = 'linked';
  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT u, 'guardian_link', 'Guardian access paused',
         'BallaCity paused a parent or guardian connection while we check the account''s security. Contact support with questions.', '/settings'
    FROM (SELECT _guardian AS u UNION SELECT g.child_user_id FROM public.guardian_links g WHERE g.id = ANY (_links)) x;
  RETURN cardinality(_links);
END $$;
REVOKE ALL ON FUNCTION public.staff_suspend_guardian_authority(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_suspend_guardian_authority(uuid, text) TO authenticated;

-- After the review, a DIFFERENT staff member lifts the hold: reinstate (a case reference is required; each suspended link is re-verified,
-- or revoked if the child is no longer a minor or a block exists) or revoke every suspended link (recorded as suspected fraud, so restoring
-- one later needs two staff members).
CREATE OR REPLACE FUNCTION public.staff_lift_guardian_suspension(_guardian uuid, _reinstate boolean, _reason text, _evidence_ref text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _why text := btrim(COALESCE(_reason, '')); _ref text := private_sec.guardian_case_ref(_evidence_ref);
        _h public.guardian_authority_holds; _l public.guardian_links; _n integer := 0;
BEGIN
  IF _me IS NULL OR NOT public.is_moderator(_me) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only BallaCity staff lift a guardian suspension.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _reinstate IS NULL THEN RAISE EXCEPTION 'DECISION_REQUIRED: reinstate or revoke.'; END IF;
  IF length(_why) < 4 OR length(_why) > 500 THEN RAISE EXCEPTION 'REASON_REQUIRED: give a reason (4 to 500 characters).'; END IF;
  IF _reinstate AND _ref IS NULL THEN
    RAISE EXCEPTION 'EVIDENCE_REQUIRED: record the case reference (8 to 64 characters, like GV-20261104 or ZD-48213-B), never the document.';
  END IF;
  SELECT * INTO _h FROM public.guardian_authority_holds WHERE guardian_user_id = _guardian AND lifted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HOLD_NOT_FOUND: this guardian is not suspended.' USING ERRCODE = 'no_data_found'; END IF;
  IF _me = _guardian OR EXISTS (SELECT 1 FROM public.guardian_links g WHERE g.parent_user_id = _guardian AND g.child_user_id = _me) THEN
    RAISE EXCEPTION 'CONFLICT_OF_INTEREST: a party cannot act on this guardian.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _me = _h.placed_by THEN
    RAISE EXCEPTION 'SECOND_REVIEWER_REQUIRED: a different staff member than the one who suspended must lift it.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM private_sec.guardian_write_begin(jsonb_build_object('actor_role', 'staff', 'reason', _why));
  UPDATE public.guardian_authority_holds
     SET lifted_by = _me, lifted_at = now(), lift_reason = _why, lift_evidence_ref = _ref,
         outcome = CASE WHEN _reinstate THEN 'reinstated' ELSE 'revoked' END
   WHERE id = _h.id;
  IF _reinstate AND NOT private_sec.guardian_eligible(_guardian) THEN
    RAISE EXCEPTION 'GUARDIAN_NOT_ELIGIBLE: the guardian must be a verified adult in good standing.';
  END IF;
  FOR _l IN SELECT * FROM public.guardian_links WHERE id = ANY (_h.suspended_links) AND status = 'suspended' FOR UPDATE LOOP
    IF _reinstate AND COALESCE(public.age_cohort_of(_l.child_user_id), 'unknown') <> 'adult'
       AND NOT public.blocks_exist_between(_l.parent_user_id, _l.child_user_id) THEN
      PERFORM set_config('app.guardian_audit', jsonb_build_object('actor_role', 'staff', 'reason', _why, 'evidence_ref', _ref,
                                                                  'method', 'staff_reinstatement',
                                                                  'detail', jsonb_build_object('hold_id', _h.id, 'suspended_by', _h.placed_by))::text, true);
      UPDATE public.guardian_links SET status = 'active', verified_at = now(), verified_by = _me, verification_method = 'staff_reinstatement'
       WHERE id = _l.id;
      _n := _n + 1;
    ELSE
      PERFORM set_config('app.guardian_audit', jsonb_build_object('actor_role', 'staff', 'reason', _why, 'method', 'staff_revocation',
                                                                  'detail', jsonb_build_object('hold_id', _h.id, 'suspected_fraud', NOT _reinstate))::text, true);
      UPDATE public.guardian_links SET status = 'revoked' WHERE id = _l.id;
      UPDATE public.parental_consents
         SET status = 'revoked', revoked_at = now(), revoked_reason = 'Guardian link revoked by BallaCity staff', updated_at = now()
       WHERE child_user_id = _l.child_user_id AND parent_user_id = _l.parent_user_id AND status <> 'revoked';
    END IF;
  END LOOP;
  PERFORM private_sec.guardian_write_end();
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_guardian, 'guardian_link', CASE WHEN _reinstate THEN 'Guardian access restored' ELSE 'Guardian connection removed' END,
          CASE WHEN _reinstate THEN 'BallaCity finished its security review and restored your guardian access.'
               ELSE 'BallaCity finished its security review and removed your guardian connection. Contact support with questions.' END, '/parent');
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.staff_lift_guardian_suspension(uuid, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_lift_guardian_suspension(uuid, boolean, text, text) TO authenticated;

-- ------------------------------------------------------------------------------------------------------------------------------ managed children
-- has_guardian_link used to count a managed_accounts row on its own, so a managed child whose guardian staff revoked (or suspended) still
-- "had a guardian" for messaging. provision_managed_child always writes an active, verified link (20260930120000), so the link alone is the
-- truth: a managed child counts as guarded exactly while the managing guardian's link is active and verified.
CREATE OR REPLACE FUNCTION private_sec.has_guardian_link(_minor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.guardian_links gl
                  WHERE gl.child_user_id = _minor AND gl.status = 'active' AND gl.verified_at IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION private_sec.has_guardian_link(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.has_guardian_link(uuid) TO service_role;

-- The same for notifications about a child: only guardians with an active, verified link (the managing guardian has one unless it was
-- revoked or suspended).
CREATE OR REPLACE FUNCTION public.notify_guardians_of(_player uuid, _type text, _title text, _body text, _link text)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT DISTINCT g.parent_user_id, _type, left(_title, 200), _body, _link
    FROM public.guardian_links g
   WHERE g.child_user_id = _player AND g.status = 'active' AND g.verified_at IS NOT NULL AND g.parent_user_id <> _player;
$$;

-- Device pairing signs a device in as the managed child, so it needs the managing guardian's link to be active and verified (unchanged from
-- drizzle 0002 otherwise).
CREATE OR REPLACE FUNCTION public.create_device_pairing(_child_user_id uuid, _code_hash text, _device_label text DEFAULT NULL::text, _ttl_minutes integer DEFAULT 10)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  -- SEC-4: a revoked or suspended managing guardian keeps the managed_accounts row but has no authority
  IF NOT EXISTS (
    SELECT 1 FROM public.guardian_links g
    WHERE g.parent_user_id = _guardian AND g.child_user_id = _child_user_id AND g.status = 'active' AND g.verified_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'NOT_MANAGED: that profile is not managed by your account.';
  END IF;

  IF _code_hash IS NULL OR length(_code_hash) <> 64 THEN
    RAISE EXCEPTION 'PAIRING_INVALID: could not create a pairing code.';
  END IF;
  IF COALESCE(_ttl_minutes, 0) <= 0 OR _ttl_minutes > 60 THEN
    RAISE EXCEPTION 'PAIRING_INVALID: invalid pairing code lifetime.';
  END IF;

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

-- ------------------------------------------------------------------------------------------------------------------------------ staff queue
-- Pending claims for staff, with the invitation's child_name beside the redeemer's profile names (name_match false: they do not plausibly
-- match; NULL: no invitation), the suspicion reasons and where the two-person review stands. can_review is false when the caller may not
-- review this claim (submitter, decliner barred after an appeal, or the first reviewer waiting for someone else).
DROP FUNCTION IF EXISTS public.staff_guardian_claims();
CREATE FUNCTION public.staff_guardian_claims()
RETURNS TABLE(request_id uuid, kind text, source text, relationship text, signals text[], created_at timestamptz,
              child_user_id uuid, child_name text, child_username text, child_cohort text, invite_child_name text, name_match boolean,
              guardian_user_id uuid, guardian_name text, guardian_email text, guardian_cohort text, guardian_eligible boolean,
              suspicion text[], review_stage text, first_review_by uuid, first_reviewer_name text, first_review_at timestamptz,
              first_review_method text, can_review boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid();
BEGIN
  IF _me IS NULL OR NOT public.is_moderator(_me) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT r.id, r.kind, r.source, r.relationship,
           ARRAY(SELECT DISTINCT unnest(r.signals || COALESCE(private_sec.guardian_claim_signals(r.parent_user_id, r.child_user_id), '{}'))),
           r.created_at, r.child_user_id, cp.display_name, cp.username, COALESCE(cp.age_cohort, 'unknown'),
           inv.child_name, private_sec.guardian_claim_name_match(r),
           r.parent_user_id, gp.display_name, gu.email::text, COALESCE(gp.age_cohort, 'unknown'), private_sec.guardian_eligible(r.parent_user_id),
           s.susp,
           CASE WHEN r.first_review_by IS NOT NULL THEN 'second_review' WHEN cardinality(s.susp) > 0 THEN 'first_review' ELSE 'single_review' END,
           r.first_review_by, fp.display_name, r.first_review_at, r.first_review_method,
           NOT private_sec.guardian_claim_conflict(r, _me) AND r.first_review_by IS DISTINCT FROM _me
      FROM public.guardian_link_requests r
      CROSS JOIN LATERAL (SELECT private_sec.guardian_claim_suspicion(r, NULL) AS susp) s
      LEFT JOIN public.minor_invites inv ON inv.id = r.invite_id
      LEFT JOIN public.profiles cp ON cp.id = r.child_user_id
      LEFT JOIN public.profiles gp ON gp.id = r.parent_user_id
      LEFT JOIN public.profiles fp ON fp.id = r.first_review_by
      LEFT JOIN auth.users gu ON gu.id = r.parent_user_id
     WHERE r.status = 'pending' AND _me NOT IN (r.child_user_id, r.parent_user_id)
     ORDER BY r.created_at
     LIMIT 200;
END $$;
REVOKE ALL ON FUNCTION public.staff_guardian_claims() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_guardian_claims() TO authenticated;

-- Open appeals for staff, without the ones the caller declined (or is a party to).
CREATE OR REPLACE FUNCTION public.staff_guardian_claim_appeals()
RETURNS TABLE(appeal_id uuid, request_id uuid, filed_role text, appeal_reason text, filed_at timestamptz, decline_reason text,
              declined_at timestamptz, kind text, child_user_id uuid, child_name text, invite_child_name text, guardian_user_id uuid,
              guardian_name text, guardian_email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid();
BEGIN
  IF _me IS NULL OR NOT public.is_moderator(_me) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT a.id, a.request_id, a.filed_role, a.reason, a.created_at, r.decision_reason, r.decided_at, r.kind,
           a.child_user_id, cp.display_name, inv.child_name, a.claimant_user_id, gp.display_name, gu.email::text
      FROM public.guardian_claim_appeals a
      JOIN public.guardian_link_requests r ON r.id = a.request_id
      LEFT JOIN public.minor_invites inv ON inv.id = r.invite_id
      LEFT JOIN public.profiles cp ON cp.id = a.child_user_id
      LEFT JOIN public.profiles gp ON gp.id = a.claimant_user_id
      LEFT JOIN auth.users gu ON gu.id = a.claimant_user_id
     WHERE a.status = 'open' AND _me NOT IN (a.child_user_id, a.claimant_user_id) AND a.decliner IS DISTINCT FROM _me
     ORDER BY a.created_at
     LIMIT 200;
END $$;
REVOKE ALL ON FUNCTION public.staff_guardian_claim_appeals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_guardian_claim_appeals() TO authenticated;

-- SEC-2 containment: this migration adds policies that name wrapped helpers (is_moderator, is_guardian_of) by their public name; re-wrap so
-- they point at the private copies.
DO $$ BEGIN IF to_regprocedure('private_sec.wrap_oracle_helpers()') IS NOT NULL THEN PERFORM private_sec.wrap_oracle_helpers(); END IF; END $$;
