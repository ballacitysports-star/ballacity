-- 1) account_profiles
CREATE TABLE IF NOT EXISTS public.account_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('player','team','trainer','gym')),
  ref_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS account_profiles_player_uniq
  ON public.account_profiles (user_id) WHERE kind = 'player';
CREATE UNIQUE INDEX IF NOT EXISTS account_profiles_ref_uniq
  ON public.account_profiles (kind, ref_id) WHERE ref_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS account_profiles_user_idx ON public.account_profiles (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_profiles TO authenticated;
GRANT ALL ON public.account_profiles TO service_role;

ALTER TABLE public.account_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own account profiles select" ON public.account_profiles;
CREATE POLICY "own account profiles select" ON public.account_profiles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "own account profiles insert" ON public.account_profiles;
CREATE POLICY "own account profiles insert" ON public.account_profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "own account profiles delete" ON public.account_profiles;
CREATE POLICY "own account profiles delete" ON public.account_profiles
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 2) active profile pointer
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_profile_id uuid;

-- 3) drop the single-type locks
DROP TRIGGER IF EXISTS enforce_account_type_lock_trg ON public.profiles;
DROP TRIGGER IF EXISTS enforce_single_linked_team_trg ON public.teams;
DROP TRIGGER IF EXISTS enforce_single_linked_org_trg ON public.trainer_orgs;
DROP TRIGGER IF EXISTS enforce_team_owner_account_type_trg ON public.teams;
DROP TRIGGER IF EXISTS enforce_org_owner_account_type_trg ON public.trainer_orgs;

-- 4) backfill
INSERT INTO public.account_profiles (user_id, kind, ref_id)
SELECT p.id, 'player', NULL FROM public.profiles p
ON CONFLICT DO NOTHING;

INSERT INTO public.account_profiles (user_id, kind, ref_id)
SELECT t.owner_id,
       CASE WHEN t.kind = 'coach' THEN 'trainer' ELSE 'team' END,
       t.id
FROM public.teams t
WHERE t.owner_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.account_profiles (user_id, kind, ref_id)
SELECT o.owner_id, 'gym', o.id::text
FROM public.trainer_orgs o
WHERE o.owner_id IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE public.profiles p
SET active_profile_id = ap.id
FROM public.account_profiles ap
WHERE ap.user_id = p.id
  AND ap.kind = COALESCE(p.account_type, 'player')
  AND p.active_profile_id IS NULL;

UPDATE public.profiles p
SET active_profile_id = ap.id
FROM public.account_profiles ap
WHERE ap.user_id = p.id AND ap.kind = 'player'
  AND p.active_profile_id IS NULL;

-- 5) keep in sync
CREATE OR REPLACE FUNCTION public.sync_account_profile_team()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.account_profiles
    WHERE ref_id = OLD.id
      AND kind = CASE WHEN OLD.kind = 'coach' THEN 'trainer' ELSE 'team' END;
    RETURN OLD;
  END IF;
  IF NEW.owner_id IS NOT NULL THEN
    INSERT INTO public.account_profiles (user_id, kind, ref_id)
    VALUES (NEW.owner_id,
            CASE WHEN NEW.kind = 'coach' THEN 'trainer' ELSE 'team' END,
            NEW.id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_account_profile_team_trg ON public.teams;
CREATE TRIGGER sync_account_profile_team_trg
AFTER INSERT OR UPDATE OF owner_id, kind OR DELETE ON public.teams
FOR EACH ROW EXECUTE FUNCTION public.sync_account_profile_team();

CREATE OR REPLACE FUNCTION public.sync_account_profile_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.account_profiles WHERE ref_id = OLD.id::text AND kind = 'gym';
    RETURN OLD;
  END IF;
  IF NEW.owner_id IS NOT NULL THEN
    INSERT INTO public.account_profiles (user_id, kind, ref_id)
    VALUES (NEW.owner_id, 'gym', NEW.id::text)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_account_profile_org_trg ON public.trainer_orgs;
CREATE TRIGGER sync_account_profile_org_trg
AFTER INSERT OR UPDATE OF owner_id OR DELETE ON public.trainer_orgs
FOR EACH ROW EXECUTE FUNCTION public.sync_account_profile_org();

-- ensure new users get a player entry
CREATE OR REPLACE FUNCTION public.sync_account_profile_player()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _id uuid;
BEGIN
  INSERT INTO public.account_profiles (user_id, kind, ref_id)
  VALUES (NEW.id, 'player', NULL)
  ON CONFLICT DO NOTHING
  RETURNING id INTO _id;
  IF _id IS NOT NULL THEN
    UPDATE public.profiles SET active_profile_id = _id WHERE id = NEW.id AND active_profile_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_account_profile_player_trg ON public.profiles;
CREATE TRIGGER sync_account_profile_player_trg
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_account_profile_player();

REVOKE EXECUTE ON FUNCTION public.sync_account_profile_team() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_account_profile_org() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_account_profile_player() FROM PUBLIC, anon;