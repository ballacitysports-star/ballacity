-- P2-2 (database layer): one private "coach" identity per person who coaches.
--
-- A person who coaches, manages or owns several teams has no cross-team identity: a
-- "trainer" is a bookable business profile and "coach" is only a roster role on one
-- team. Phase 0 audit section 7.3 D: add `coach` to account_profiles.kind, backed by
-- team_members.role in ('owner','manager','coach'), with no new table.
--
-- Private by decision (owner, 2026-11-06): this is an entry in the person's own
-- account switcher only. It is not listed in Discover and nobody else can read it:
-- account_profiles keeps its existing "own rows only" SELECT policy, untouched here.
--
-- Server-managed: the row exists exactly while the person holds one of those roles on
-- at least one team. A trigger on team_members keeps it in step. Clients cannot
-- create, change or delete a coach row themselves (RESTRICTIVE policies below), so
-- no one can give themselves a coach identity without a real roster role.
--
-- The app ignores account profile kinds it does not know (isAccountType), so this
-- migration changes nothing on screen until the switcher learns the new kind.
-- Rollback: docs/rollbacks/20261106190000_coach_identity.down.sql.

ALTER TABLE public.account_profiles DROP CONSTRAINT IF EXISTS account_profiles_kind_check;
ALTER TABLE public.account_profiles ADD CONSTRAINT account_profiles_kind_check
  CHECK (kind IN ('player', 'team', 'trainer', 'gym', 'parent', 'coach'));

-- One coach identity per person, covering every team they coach.
CREATE UNIQUE INDEX IF NOT EXISTS account_profiles_coach_uniq
  ON public.account_profiles (user_id) WHERE kind = 'coach';

-- Clients may not create, edit or delete coach rows; only the sync below does.
DROP POLICY IF EXISTS "coach profiles are server managed (insert)" ON public.account_profiles;
CREATE POLICY "coach profiles are server managed (insert)" ON public.account_profiles
  AS RESTRICTIVE FOR INSERT TO authenticated, anon
  WITH CHECK (kind <> 'coach');
DROP POLICY IF EXISTS "coach profiles are server managed (update)" ON public.account_profiles;
CREATE POLICY "coach profiles are server managed (update)" ON public.account_profiles
  AS RESTRICTIVE FOR UPDATE TO authenticated, anon
  USING (kind <> 'coach') WITH CHECK (kind <> 'coach');
DROP POLICY IF EXISTS "coach profiles are server managed (delete)" ON public.account_profiles;
CREATE POLICY "coach profiles are server managed (delete)" ON public.account_profiles
  AS RESTRICTIVE FOR DELETE TO authenticated, anon
  USING (kind <> 'coach');

-- Create or remove `_user`'s coach identity to match their current roster roles.
CREATE OR REPLACE FUNCTION private_sec.sync_coach_profile(_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _removed uuid;
BEGIN
  IF _user IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.user_id = _user AND tm.role IN ('owner', 'manager', 'coach')
  ) THEN
    INSERT INTO public.account_profiles (user_id, kind, ref_id)
    VALUES (_user, 'coach', NULL)
    ON CONFLICT DO NOTHING;
    RETURN;
  END IF;

  DELETE FROM public.account_profiles
  WHERE user_id = _user AND kind = 'coach'
  RETURNING id INTO _removed;

  -- If they were acting as the coach identity, fall back to their player profile.
  -- (default_profile_id is a foreign key ON DELETE SET NULL, so it clears itself.)
  IF _removed IS NOT NULL THEN
    UPDATE public.profiles p
    SET active_profile_id = (
      SELECT ap.id FROM public.account_profiles ap
      WHERE ap.user_id = _user AND ap.kind = 'player'
      LIMIT 1
    )
    WHERE p.id = _user AND p.active_profile_id = _removed;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION private_sec.sync_coach_profile(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private_sec.team_members_sync_coach_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM private_sec.sync_coach_profile(NEW.user_id);
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM private_sec.sync_coach_profile(OLD.user_id);
  ELSIF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    PERFORM private_sec.sync_coach_profile(OLD.user_id);
  END IF;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION private_sec.team_members_sync_coach_profile() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_team_members_sync_coach_profile ON public.team_members;
CREATE TRIGGER zz_team_members_sync_coach_profile
  AFTER INSERT OR UPDATE OF role, user_id OR DELETE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION private_sec.team_members_sync_coach_profile();

-- Backfill everyone who already coaches, manages or owns a team.
INSERT INTO public.account_profiles (user_id, kind, ref_id)
SELECT DISTINCT tm.user_id, 'coach', NULL::text
FROM public.team_members tm
WHERE tm.role IN ('owner', 'manager', 'coach')
ON CONFLICT DO NOTHING;
