
-- 1. Add account_type column, nullable initially
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_type text;

-- 2. Backfill existing users based on what they own (priority: gym > trainer > team > player)
UPDATE public.profiles p
SET account_type = CASE
  WHEN EXISTS (SELECT 1 FROM public.trainer_orgs o WHERE o.owner_id = p.id) THEN 'gym'
  WHEN EXISTS (SELECT 1 FROM public.teams t WHERE t.owner_id = p.id AND t.kind = 'coach') THEN 'trainer'
  WHEN EXISTS (SELECT 1 FROM public.teams t WHERE t.owner_id = p.id AND t.kind <> 'coach') THEN 'team'
  ELSE 'player'
END
WHERE account_type IS NULL;

-- 3. Enforce constraints
ALTER TABLE public.profiles
  ALTER COLUMN account_type SET NOT NULL,
  ALTER COLUMN account_type SET DEFAULT 'player';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_account_type_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_account_type_check
  CHECK (account_type IN ('player','team','trainer','gym'));

-- 4. Update handle_new_user to read account_type from signup metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _type text;
BEGIN
  _type := COALESCE(NEW.raw_user_meta_data->>'account_type', 'player');
  IF _type NOT IN ('player','team','trainer','gym') THEN
    _type := 'player';
  END IF;

  INSERT INTO public.profiles (id, display_name, avatar_initials, account_type)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1), 'Player'),
    UPPER(LEFT(COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'name', NEW.email, 'P'), 2)),
    _type
  );
  RETURN NEW;
END;
$function$;

-- 5. Helper function
CREATE OR REPLACE FUNCTION public.get_account_type(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT account_type FROM public.profiles WHERE id = _user_id;
$function$;

-- 6. Ownership gate: enforce team ownership matches account type
CREATE OR REPLACE FUNCTION public.enforce_team_owner_account_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _type text;
  _required text;
BEGIN
  IF NEW.owner_id IS NULL THEN RETURN NEW; END IF;
  SELECT account_type INTO _type FROM public.profiles WHERE id = NEW.owner_id;
  IF _type IS NULL THEN RETURN NEW; END IF;

  _required := CASE WHEN NEW.kind = 'coach' THEN 'trainer' ELSE 'team' END;

  IF _type <> _required THEN
    RAISE EXCEPTION 'Only % accounts can own a %. Your account is a %.', _required, _required, _type
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_team_owner_account_type_trg ON public.teams;
CREATE TRIGGER enforce_team_owner_account_type_trg
  BEFORE INSERT ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.enforce_team_owner_account_type();

-- 7. Ownership gate: only gym accounts can create trainer_orgs
CREATE OR REPLACE FUNCTION public.enforce_org_owner_account_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _type text;
BEGIN
  IF NEW.owner_id IS NULL THEN RETURN NEW; END IF;
  SELECT account_type INTO _type FROM public.profiles WHERE id = NEW.owner_id;
  IF _type IS NOT NULL AND _type <> 'gym' THEN
    RAISE EXCEPTION 'Only gym accounts can create an organization. Your account is a %.', _type
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_org_owner_account_type_trg ON public.trainer_orgs;
CREATE TRIGGER enforce_org_owner_account_type_trg
  BEFORE INSERT ON public.trainer_orgs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_org_owner_account_type();
