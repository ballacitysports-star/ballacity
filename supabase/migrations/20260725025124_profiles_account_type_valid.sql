-- Back-filled into git on 2026-10-01. NOT authored in this change.
--
-- Production's supabase_migrations.schema_migrations records this migration
-- as version 20260725025124 (name 20260725025123_dc6f1a08-f936-4a43-9806-
-- de61c4ed9c77, created_by apikey@lovable.dev), but no branch of this
-- repository ever held a file for it, so a database rebuilt from
-- supabase/migrations/ would have lacked both the constraint and the column
-- changes below. Found while widening profiles.account_type for a 'parent'
-- value in 20261001130000_parent_account_type.sql: that migration's own
-- `ALTER TABLE ... DROP CONSTRAINT profiles_account_type_check` would have
-- left THIS constraint (same four-value list, added here almost two months
-- earlier) still rejecting 'parent' had it gone unnoticed.
--
-- Everything below the blank line after this header is production's stored
-- statement, byte for byte: md5 a25e6248b2cbf8c887a9f3df7c29b6a5, equal to
-- md5(array_to_string(statements, E'\n')) for that version in production.
-- The version in the file name is production's exact version, so the CLI's
-- history check sees it as already applied instead of wanting to replay it.
--
-- Its own DROP DEFAULT/DROP NOT NULL duplicates what 20260912150000 (already
-- in this repo) does again a month and a half later — harmless, both are
-- idempotent — but is kept verbatim rather than trimmed, since this file's
-- whole purpose is to match production's stored statement exactly.

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
