
-- 1) Prevent multiple linked profiles per owner (teams: one per kind; orgs: one total)
CREATE OR REPLACE FUNCTION public.enforce_single_linked_team()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.teams
    WHERE owner_id = NEW.owner_id
      AND kind = NEW.kind
      AND id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'You already have a % profile. Only one is allowed per account.',
      CASE WHEN NEW.kind = 'coach' THEN 'trainer' ELSE 'team' END
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_single_linked_team_trg ON public.teams;
CREATE TRIGGER enforce_single_linked_team_trg
BEFORE INSERT OR UPDATE OF owner_id, kind ON public.teams
FOR EACH ROW EXECUTE FUNCTION public.enforce_single_linked_team();

CREATE OR REPLACE FUNCTION public.enforce_single_linked_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.trainer_orgs
    WHERE owner_id = NEW.owner_id
      AND id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'You already have a gym organization. Only one is allowed per account.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_single_linked_org_trg ON public.trainer_orgs;
CREATE TRIGGER enforce_single_linked_org_trg
BEFORE INSERT OR UPDATE OF owner_id ON public.trainer_orgs
FOR EACH ROW EXECUTE FUNCTION public.enforce_single_linked_org();

-- 2) Lock profiles.account_type once a linked profile exists
CREATE OR REPLACE FUNCTION public.enforce_account_type_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.account_type IS DISTINCT FROM OLD.account_type THEN
    IF EXISTS (SELECT 1 FROM public.teams WHERE owner_id = NEW.id)
       OR EXISTS (SELECT 1 FROM public.trainer_orgs WHERE owner_id = NEW.id) THEN
      RAISE EXCEPTION 'Cannot change account type while a linked team, trainer, or gym profile exists. Delete the linked profile first.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_account_type_lock_trg ON public.profiles;
CREATE TRIGGER enforce_account_type_lock_trg
BEFORE UPDATE OF account_type ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.enforce_account_type_lock();
