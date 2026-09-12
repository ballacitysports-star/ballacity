-- Teams and gyms that nobody owns yet, and the path for a real owner to take one over.
--
-- Until now a team or gym could only exist if its owner created it: `owner_id` was
-- NOT NULL on both tables and every INSERT policy demanded `owner_id = auth.uid()`.
-- So a moderator could not seed a directory of the gyms and teams that plainly exist
-- in a city, and an owner arriving later had no way to take over an entry.
--
-- An unclaimed listing is a real row with `owner_id IS NULL` — not a staging table —
-- so it is browsable and linkable from the moment it is created. That works without
-- touching a single trigger, because all three ownership triggers already guard on
-- `IF NEW.owner_id IS NOT NULL`: `sync_account_profile_team`, `sync_account_profile_org`
-- (20260804040157) and `team_owner_membership` (20260902021445). An unclaimed row
-- therefore has no account profile and no roster row, and the NULL -> uuid transition
-- on approval creates both.
--
-- That the moderator never lands on the roster is the point, not a side effect:
-- roster membership grants messaging and media access to every minor on the team,
-- since child_controls.messaging = 'teammates' resolves through shares_team() over
-- team_members.

-- ============ 1. unclaimed columns ============

ALTER TABLE public.teams        ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE public.trainer_orgs ALTER COLUMN owner_id DROP NOT NULL;

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS listed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS listed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

ALTER TABLE public.trainer_orgs
  ADD COLUMN IF NOT EXISTS listed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS listed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS teams_unclaimed_idx
  ON public.teams (created_at DESC) WHERE owner_id IS NULL;
CREATE INDEX IF NOT EXISTS trainer_orgs_unclaimed_idx
  ON public.trainer_orgs (created_at DESC) WHERE owner_id IS NULL;

-- A moderator may edit a listing only while it is unclaimed. The existing owner
-- policies need no change — `auth.uid() = owner_id` is already false for a NULL owner.
CREATE POLICY "moderators edit unclaimed teams"
  ON public.teams FOR UPDATE TO authenticated
  USING (owner_id IS NULL AND public.is_moderator(auth.uid()))
  WITH CHECK (owner_id IS NULL AND public.is_moderator(auth.uid()));

CREATE POLICY "moderators edit unclaimed orgs"
  ON public.trainer_orgs FOR UPDATE TO authenticated
  USING (owner_id IS NULL AND public.is_moderator(auth.uid()))
  WITH CHECK (owner_id IS NULL AND public.is_moderator(auth.uid()));

-- The policy above cannot stop a moderator handing themselves ownership, and adding
-- `WITH CHECK (owner_id IS NULL)` does not help. Postgres ORs USING across all
-- permissive policies and ORs WITH CHECK across them as a separate group, so an
-- UPDATE only needs *some* policy to admit the old row and *some* policy to admit the
-- new one — they need not be the same policy. A moderator editing an unclaimed row
-- passes USING here, and then passes the owner policy's own
-- `WITH CHECK (auth.uid() = owner_id)` by setting themselves as the owner. Verified:
-- the plain UPDATE succeeded until this trigger existed.
--
-- So the column is pinned with a trigger, for the same reason
-- guard_team_member_role_change exists — a WITH CHECK cannot see OLD. Ownership can
-- therefore only change inside a routine that opens one of the two flags below:
-- approve_listing_claim, or the existing transfer_team_ownership.
CREATE OR REPLACE FUNCTION public.guard_listing_owner_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id THEN RETURN NEW; END IF;
  IF coalesce(current_setting('app.listing_claim', true), '') = 'on'
     OR coalesce(current_setting('app.team_transfer', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'OWNER_SET_BY_CLAIM_ONLY';
END $$;
REVOKE EXECUTE ON FUNCTION public.guard_listing_owner_change() FROM anon, authenticated;

CREATE TRIGGER guard_teams_owner_change
  BEFORE UPDATE OF owner_id ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.guard_listing_owner_change();

CREATE TRIGGER guard_trainer_orgs_owner_change
  BEFORE UPDATE OF owner_id ON public.trainer_orgs
  FOR EACH ROW EXECUTE FUNCTION public.guard_listing_owner_change();

-- ============ 2. claims ============

-- Polymorphic because `teams.id` is text and `trainer_orgs.id` is uuid, so no single
-- foreign key can span both. `account_profiles.ref_id text` already holds ids from
-- both tables the same way. The cost is paid back with an existence check in the
-- validate trigger and the two cleanup triggers at the end of this file.
CREATE TABLE public.listing_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL CHECK (subject_type IN ('team','gym')),
  subject_id   text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message text,
  evidence_url text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','denied','withdrawn')),
  denial_reason text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One open claim per person per listing. Competing claims from different people are
-- allowed on purpose — the moderator picks, and approval auto-denies the rest.
CREATE UNIQUE INDEX listing_claims_one_open_per_user
  ON public.listing_claims (subject_type, subject_id, user_id) WHERE status = 'pending';
CREATE INDEX listing_claims_queue_idx ON public.listing_claims (status, created_at DESC);
CREATE INDEX listing_claims_subject_idx ON public.listing_claims (subject_type, subject_id);

-- No DELETE: withdrawing is a status change, so the trail survives.
GRANT SELECT, INSERT, UPDATE ON public.listing_claims TO authenticated;
GRANT ALL ON public.listing_claims TO service_role;
ALTER TABLE public.listing_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "listing_claims claimant read"
  ON public.listing_claims FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "listing_claims moderator read"
  ON public.listing_claims FOR SELECT TO authenticated
  USING (public.is_moderator(auth.uid()));

CREATE POLICY "listing_claims claimant insert"
  ON public.listing_claims FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Withdrawal is the only direct write. Approve and deny are deliberately absent from
-- RLS so they can only happen through the RPCs below, which are audited by the caller.
CREATE POLICY "listing_claims claimant withdraw"
  ON public.listing_claims FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending')
  WITH CHECK (user_id = auth.uid() AND status = 'withdrawn');

CREATE TRIGGER listing_claims_touch_updated_at
  BEFORE UPDATE ON public.listing_claims
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.validate_listing_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _owner uuid;
  _found boolean := false;
  _uuid uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000'; END IF;
    IF NEW.user_id <> auth.uid() THEN
      RAISE EXCEPTION 'USER_MISMATCH' USING ERRCODE='42501';
    END IF;

    NEW.status := 'pending';
    NEW.denial_reason := NULL;
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;

    IF NEW.message IS NOT NULL AND length(NEW.message) > 1000 THEN
      RAISE EXCEPTION 'MESSAGE_TOO_LONG';
    END IF;

    IF NEW.subject_type = 'team' THEN
      SELECT owner_id, true INTO _owner, _found FROM public.teams WHERE id = NEW.subject_id;
    ELSE
      -- subject_id is text for both kinds, so a gym id that is not uuid-shaped is a
      -- bad reference rather than a server error.
      BEGIN
        _uuid := NEW.subject_id::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'LISTING_NOT_FOUND';
      END;
      SELECT owner_id, true INTO _owner, _found FROM public.trainer_orgs WHERE id = _uuid;
    END IF;

    IF NOT COALESCE(_found, false) THEN RAISE EXCEPTION 'LISTING_NOT_FOUND'; END IF;
    IF _owner IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_CLAIMED'; END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.subject_type <> OLD.subject_type
       OR NEW.subject_id <> OLD.subject_id
       OR NEW.user_id <> OLD.user_id THEN
      RAISE EXCEPTION 'IMMUTABLE_FIELDS' USING ERRCODE='42501';
    END IF;
    IF NEW.denial_reason IS NOT NULL AND length(NEW.denial_reason) > 500 THEN
      RAISE EXCEPTION 'REASON_TOO_LONG';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER listing_claims_validate
  BEFORE INSERT OR UPDATE ON public.listing_claims
  FOR EACH ROW EXECUTE FUNCTION public.validate_listing_claim();

-- ============ 3. moderator creates a listing ============

-- These bypass both the `owner_id = auth.uid()` INSERT policies and the account-type
-- gate that restricts gym creation to `gym` accounts, which is exactly why they are
-- definer RPCs rather than a client insert.

CREATE OR REPLACE FUNCTION public.create_unclaimed_team(
  _id text, _kind text, _name text, _handle text,
  _city text DEFAULT '', _sports text[] DEFAULT '{}'
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000'; END IF;
  IF NOT public.is_moderator(_me) THEN RAISE EXCEPTION 'NOT_MODERATOR' USING ERRCODE='42501'; END IF;
  IF _kind NOT IN ('team','coach') THEN RAISE EXCEPTION 'INVALID_KIND'; END IF;
  IF btrim(COALESCE(_name, '')) = '' THEN RAISE EXCEPTION 'NAME_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM public.teams WHERE id = _id) THEN RAISE EXCEPTION 'ID_TAKEN'; END IF;

  INSERT INTO public.teams (id, owner_id, kind, name, handle, city, sports, listed_by, listed_at)
  VALUES (_id, NULL, _kind, btrim(_name), _handle, COALESCE(_city, ''),
          COALESCE(_sports, '{}'), _me, now());
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.create_unclaimed_gym(
  _name text, _handle text, _city text DEFAULT NULL, _category text DEFAULT NULL,
  _address text DEFAULT NULL, _website text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid(); _id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000'; END IF;
  IF NOT public.is_moderator(_me) THEN RAISE EXCEPTION 'NOT_MODERATOR' USING ERRCODE='42501'; END IF;
  IF btrim(COALESCE(_name, '')) = '' THEN RAISE EXCEPTION 'NAME_REQUIRED'; END IF;

  BEGIN
    INSERT INTO public.trainer_orgs
      (owner_id, name, handle, city, category, address, website, listed_by, listed_at)
    VALUES (NULL, btrim(_name), _handle, _city, _category, _address, _website, _me, now())
    RETURNING id INTO _id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'HANDLE_TAKEN';
  END;
  RETURN _id;
END $$;

-- ============ 4. claim lifecycle ============

CREATE OR REPLACE FUNCTION public.submit_listing_claim(
  _type text, _id text, _message text DEFAULT NULL, _evidence text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid(); _claim uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000'; END IF;

  -- The validate trigger does the real work; this wrapper exists so the partial
  -- unique index surfaces as a house error code instead of a raw 23505.
  BEGIN
    INSERT INTO public.listing_claims (subject_type, subject_id, user_id, message, evidence_url)
    VALUES (_type, _id, _me, NULLIF(btrim(COALESCE(_message, '')), ''),
            NULLIF(btrim(COALESCE(_evidence, '')), ''))
    RETURNING id INTO _claim;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'CLAIM_ALREADY_PENDING';
  END;

  RETURN _claim;
END $$;

CREATE OR REPLACE FUNCTION public.approve_listing_claim(_claim uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _c public.listing_claims%ROWTYPE;
  _owner uuid;
  _name text;
  _link text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000'; END IF;
  IF NOT public.is_moderator(_me) THEN RAISE EXCEPTION 'NOT_MODERATOR' USING ERRCODE='42501'; END IF;

  -- FOR UPDATE on both the claim and the subject: two moderators approving competing
  -- claims on the same listing must serialise, or both would set owner_id.
  SELECT * INTO _c FROM public.listing_claims WHERE id = _claim FOR UPDATE;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'CLAIM_NOT_FOUND'; END IF;
  IF _c.status <> 'pending' THEN RAISE EXCEPTION 'CLAIM_NOT_PENDING'; END IF;

  IF _c.subject_type = 'team' THEN
    SELECT owner_id, name INTO _owner, _name
      FROM public.teams WHERE id = _c.subject_id FOR UPDATE;
    IF _name IS NULL THEN RAISE EXCEPTION 'LISTING_NOT_FOUND'; END IF;
    IF _owner IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_CLAIMED'; END IF;

    -- team_owner_membership upserts team_members.role = 'owner'; its ON CONFLICT DO
    -- UPDATE path is an UPDATE, which guard_team_member_role_change_trg would reject
    -- with OWNER_ROLE_FIXED when the claimant already sits on the roster as a player.
    -- Transaction-local, so it cannot leak past this call.
    PERFORM set_config('app.team_transfer', 'on', true);
    PERFORM set_config('app.listing_claim', 'on', true);

    UPDATE public.teams SET owner_id = _c.user_id, claimed_at = now(), updated_at = now()
      WHERE id = _c.subject_id;
    _link := '/teams/' || _c.subject_id;
  ELSE
    SELECT owner_id, name INTO _owner, _name
      FROM public.trainer_orgs WHERE id = _c.subject_id::uuid FOR UPDATE;
    IF _name IS NULL THEN RAISE EXCEPTION 'LISTING_NOT_FOUND'; END IF;
    IF _owner IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_CLAIMED'; END IF;

    PERFORM set_config('app.listing_claim', 'on', true);
    UPDATE public.trainer_orgs SET owner_id = _c.user_id, claimed_at = now(), updated_at = now()
      WHERE id = _c.subject_id::uuid;
    _link := '/orgs/' || _c.subject_id;
  END IF;

  -- account_profiles is deliberately untouched: unlike transfer_team_ownership there
  -- is no existing row to move, because sync_account_profile_* skipped it while
  -- owner_id was NULL. The NULL -> uuid transition creates it.

  UPDATE public.listing_claims
    SET status = 'approved', reviewed_by = _me, reviewed_at = now()
    WHERE id = _claim;

  UPDATE public.listing_claims
    SET status = 'denied',
        denial_reason = 'Listing was claimed by another user.',
        reviewed_by = _me, reviewed_at = now()
    WHERE subject_type = _c.subject_type AND subject_id = _c.subject_id
      AND status = 'pending' AND id <> _claim;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_c.user_id, 'listing_claim', 'You now manage ' || _name,
          'Your claim was approved. ' || _name || ' is yours to manage.', _link);
END $$;

CREATE OR REPLACE FUNCTION public.deny_listing_claim(_claim uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _c public.listing_claims%ROWTYPE;
  _name text;
  _link text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000'; END IF;
  IF NOT public.is_moderator(_me) THEN RAISE EXCEPTION 'NOT_MODERATOR' USING ERRCODE='42501'; END IF;

  SELECT * INTO _c FROM public.listing_claims WHERE id = _claim FOR UPDATE;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'CLAIM_NOT_FOUND'; END IF;
  IF _c.status <> 'pending' THEN RAISE EXCEPTION 'CLAIM_NOT_PENDING'; END IF;

  UPDATE public.listing_claims
    SET status = 'denied',
        denial_reason = NULLIF(btrim(COALESCE(_reason, '')), ''),
        reviewed_by = _me, reviewed_at = now()
    WHERE id = _claim;

  IF _c.subject_type = 'team' THEN
    SELECT name INTO _name FROM public.teams WHERE id = _c.subject_id;
    _link := '/teams/' || _c.subject_id;
  ELSE
    SELECT name INTO _name FROM public.trainer_orgs WHERE id = _c.subject_id::uuid;
    _link := '/orgs/' || _c.subject_id;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_c.user_id, 'listing_claim',
          'Your claim on ' || COALESCE(_name, 'a listing') || ' was declined',
          NULLIF(btrim(COALESCE(_reason, '')), ''), _link);
END $$;

CREATE OR REPLACE FUNCTION public.withdraw_listing_claim(_claim uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid(); _c public.listing_claims%ROWTYPE;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='28000'; END IF;
  SELECT * INTO _c FROM public.listing_claims WHERE id = _claim FOR UPDATE;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'CLAIM_NOT_FOUND'; END IF;
  IF _c.user_id <> _me THEN RAISE EXCEPTION 'NOT_CLAIM_OWNER' USING ERRCODE='42501'; END IF;
  IF _c.status <> 'pending' THEN RAISE EXCEPTION 'CLAIM_NOT_PENDING'; END IF;

  UPDATE public.listing_claims SET status = 'withdrawn' WHERE id = _claim;
END $$;

REVOKE EXECUTE ON FUNCTION public.create_unclaimed_team(text, text, text, text, text, text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_unclaimed_gym(text, text, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.submit_listing_claim(text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.approve_listing_claim(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.deny_listing_claim(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.withdraw_listing_claim(uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.create_unclaimed_team(text, text, text, text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_unclaimed_gym(text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_listing_claim(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_listing_claim(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deny_listing_claim(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_listing_claim(uuid) TO authenticated;

-- ============ 5. orphan cleanup ============

-- The polymorphic subject_id cannot carry a foreign key, so deletes are swept by hand.
CREATE OR REPLACE FUNCTION public.cleanup_listing_claims()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'teams' THEN
    DELETE FROM public.listing_claims WHERE subject_type = 'team' AND subject_id = OLD.id;
  ELSE
    DELETE FROM public.listing_claims WHERE subject_type = 'gym' AND subject_id = OLD.id::text;
  END IF;
  RETURN OLD;
END $$;
REVOKE EXECUTE ON FUNCTION public.cleanup_listing_claims() FROM anon, authenticated;

CREATE TRIGGER teams_cleanup_listing_claims
  AFTER DELETE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_listing_claims();

CREATE TRIGGER trainer_orgs_cleanup_listing_claims
  AFTER DELETE ON public.trainer_orgs
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_listing_claims();
