-- Lets scheduled-job endpoints verify the shared worker secret against the
-- copy in Vault, so the secret doesn't also have to be mirrored into the
-- app's environment. Only the service role (the app's server) may call it,
-- and it returns a boolean — the value itself never leaves the database.
CREATE OR REPLACE FUNCTION public.check_worker_secret(_provided text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT COALESCE(
    _provided IS NOT NULL
    AND length(_provided) > 0
    AND EXISTS (
      SELECT 1 FROM vault.decrypted_secrets s
       WHERE s.name = 'reels_worker_secret'
         AND s.decrypted_secret = _provided
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.check_worker_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_worker_secret(text) TO service_role;
