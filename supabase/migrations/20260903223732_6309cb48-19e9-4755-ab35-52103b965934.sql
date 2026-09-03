CREATE OR REPLACE FUNCTION public.guard_birthday_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('openrun.birthday_review', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Account deletion cascades from auth.users; by the time this fires the
    -- owning user row is already gone, so erasure must be allowed through.
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'BIRTHDAY_LOCKED: a stored date of birth cannot be removed. Request a birthday correction instead.';
  END IF;

  IF NEW.birthday IS DISTINCT FROM OLD.birthday THEN
    RAISE EXCEPTION 'BIRTHDAY_LOCKED: your date of birth cannot be changed after registration. Request a birthday correction instead.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.guard_birthday_immutability() FROM PUBLIC, anon, authenticated;