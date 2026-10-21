-- Pair a device: a managing guardian hands a managed child's phone a
-- one-time sign-in link, so the child can open their own profile without an
-- email or password.
--
-- Only a SHA-256 hash of the token is stored, so a database read never yields
-- a usable link. A link is single-use, expires after 15 minutes, and is
-- revoked when the guardian makes a new one or disconnects the child's
-- devices. The table is reachable only through the app's server functions
-- (service role): the guardian's own token must never be able to read or
-- forge a row, because a row is a way into the child's account.

CREATE TABLE IF NOT EXISTS public.managed_pair_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS managed_pair_links_child_idx
  ON public.managed_pair_links (child_user_id, created_at DESC);

ALTER TABLE public.managed_pair_links ENABLE ROW LEVEL SECURITY;

-- No policies on purpose: with RLS on and no grant, only the service role
-- (which bypasses RLS) can read or write.
REVOKE ALL ON public.managed_pair_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.managed_pair_links TO service_role;
