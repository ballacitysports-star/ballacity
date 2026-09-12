-- Signing up without an account_type in user metadata failed outright.
--
-- 20260724193311 made profiles.account_type NOT NULL and gave it DEFAULT 'player'.
-- The default never applies, because handle_new_user names the column explicitly
-- and passes the metadata value, and a DEFAULT only fills a column that the INSERT
-- omits — an explicit NULL overrides it. So any signup whose metadata carries no
-- account_type hit "null value in column account_type violates not-null constraint",
-- which Supabase's auth API surfaces as the opaque "Database error creating new user".
--
-- Two real paths send no account_type:
--   - OAuth. src/routes/auth.tsx stashes the chosen type client-side via
--     setPendingAccountType and applies it after the session returns, so the
--     auth.users row is created without it. Google and Apple signup therefore
--     failed for every new user.
--   - The Admin API (auth.admin.createUser), which is how e2e/global-setup.ts
--     provisions fixture accounts — the reason CI could not seed them.
--
-- Email signup was unaffected: that form does pass account_type, which is why the
-- break was invisible outside OAuth.
--
-- Reproduced by replaying the full migration chain against Postgres 16 and calling
-- INSERT INTO auth.users with metadata that omits account_type; fixed here and
-- re-verified for the no-type, valid-type and junk-type cases.
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
    -- Same value the column default already declares. Onboarding still moves the
    -- account to its real type afterwards; this only stops the insert failing.
    COALESCE(_type, 'player')
  );

  INSERT INTO public.privacy_preferences (user_id, profile_visibility)
  VALUES (NEW.id, public.default_profile_visibility_for(NEW.id))
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;
