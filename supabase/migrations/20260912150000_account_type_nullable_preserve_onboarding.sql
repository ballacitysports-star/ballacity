-- Corrects 20260911001000, which fixed the right bug the wrong way.
--
-- That migration made handle_new_user insert COALESCE(_type, 'player') so a
-- signup carrying no account_type in its metadata would stop failing the
-- NOT NULL constraint added by 20260724193311. It does stop the failure. It
-- also destroys the signal the app routes on.
--
-- `account_type IS NULL` is how this codebase knows an account has not chosen
-- what it is yet. resolveOnboardingStatus() returns
-- `needsOnboarding: accountType === null`, AccountTypeScreen bounces out as
-- soon as the column holds a valid type, and __root.tsx says exactly why it
-- matters: "so social sign-ins can never land on the feed as a default".
-- Writing 'player' at insert time therefore makes every new Google and Apple
-- user skip the account-type picker and land on the feed as a player — a team,
-- gym or trainer signing up socially would be silently mis-typed with no way
-- back through the flow.
--
-- The NOT NULL constraint is the actual defect, and only the dev project has
-- it: production's profiles.account_type has always been nullable with no
-- default, which is why OAuth signup works there and why the E2E project was
-- the only place the break appeared. Rather than deform handle_new_user to
-- satisfy a constraint that production never had, this drops the constraint
-- and the DEFAULT, aligning dev with production, and restores the insert to
-- pass _type through as NULL when metadata omits it.
--
-- src/integrations/supabase/types.ts already declares the column
-- `string | null`, so the generated types describe the schema after this
-- migration, not before it.
--
-- Dropping the DEFAULT as well as the NOT NULL is deliberate. The default
-- never applied — handle_new_user names the column explicitly and a DEFAULT
-- only fills a column an INSERT omits — so it did nothing except look like a
-- safety net while the onboarding signal was silently overwritten. Leaving it
-- in place would re-arm the same trap for the next writer who omits the column.
--
-- No-op on production; on the dev project it removes both.

ALTER TABLE public.profiles ALTER COLUMN account_type DROP NOT NULL;
ALTER TABLE public.profiles ALTER COLUMN account_type DROP DEFAULT;

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
    -- Left NULL on purpose when metadata carries no type: that is what tells
    -- getOnboardingStatus the account still has to pick one. Onboarding sets it.
    _type
  );

  INSERT INTO public.privacy_preferences (user_id, profile_visibility)
  VALUES (NEW.id, public.default_profile_visibility_for(NEW.id))
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;
