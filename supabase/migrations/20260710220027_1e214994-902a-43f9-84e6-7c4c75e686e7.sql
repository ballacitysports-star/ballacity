-- Fix false "already sent a request" errors on the invite/contact flow.
-- The old constraint permanently blocked a user from ever sending another
-- invite/contact to the same player's availability, even for a different
-- game or after the first was declined/withdrawn.
ALTER TABLE public.availability_contact_requests
  DROP CONSTRAINT IF EXISTS availability_contact_requests_availability_id_from_user_id_key;

-- Only block a *second pending* request for the same (availability, sender,
-- kind, game). Once the previous one is accepted/declined/withdrawn, or when
-- it's an invite for a different game, a new request is allowed.
CREATE UNIQUE INDEX IF NOT EXISTS acr_unique_pending_per_target
  ON public.availability_contact_requests (
    availability_id, from_user_id, kind, COALESCE(game_id, '')
  )
  WHERE status = 'pending';
