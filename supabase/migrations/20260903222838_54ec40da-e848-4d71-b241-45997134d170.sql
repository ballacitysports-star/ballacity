CREATE OR REPLACE FUNCTION public.enforce_minor_handle_safety()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _kept boolean;
BEGIN
  -- A handle the member did not just type (auto-generated at signup, or
  -- unchanged while the cohort resolves) is sanitised rather than blocking the
  -- flow. Values the member actively sets are still rejected.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.username IS NOT DISTINCT FROM OLD.username
       AND public.minor_handle_unsafe(NEW.username, NEW.age_cohort) THEN
      NEW.username := 'baller' || substr(replace(NEW.id::text, '-', ''), 1, 8);
    END IF;
    IF NEW.display_name IS NOT DISTINCT FROM OLD.display_name
       AND public.minor_handle_unsafe(NEW.display_name, NEW.age_cohort) THEN
      NEW.display_name := 'Player';
    END IF;
  ELSE
    IF public.minor_handle_unsafe(NEW.username, NEW.age_cohort) THEN
      NEW.username := 'baller' || substr(replace(NEW.id::text, '-', ''), 1, 8);
    END IF;
    IF public.minor_handle_unsafe(NEW.display_name, NEW.age_cohort) THEN
      NEW.display_name := 'Player';
    END IF;
    RETURN NEW;
  END IF;

  IF public.minor_handle_unsafe(NEW.username, NEW.age_cohort)
     OR public.minor_handle_unsafe(NEW.display_name, NEW.age_cohort) THEN
    RAISE EXCEPTION 'MINOR_HANDLE_UNSAFE: remove personal details (email, phone, address or date of birth) from the name or username.';
  END IF;
  RETURN NEW;
END $$;