ALTER TABLE public.profiles
  ALTER COLUMN account_type DROP DEFAULT,
  ALTER COLUMN account_type DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_account_type_valid'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_account_type_valid
      CHECK (account_type IS NULL OR account_type IN ('player', 'team', 'trainer', 'gym'));
  END IF;
END $$;