CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _type text;
BEGIN
  _type := NEW.raw_user_meta_data->>'account_type';
  IF _type IS NOT NULL AND _type NOT IN ('player','team','trainer','gym') THEN
    _type := NULL;
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