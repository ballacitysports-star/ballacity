-- Listing discovery: finding teams, gyms and trainers on the public web and
-- queueing them for a superadmin to approve.
--
--   listing_discovery_runs   one row per run: what it is looking for, what is
--                            left to do, and the counts so far
--   listing_discovery_pages  every address already read, so a second run skips
--                            what the first covered
--   listing_candidates       what a page said, waiting for a person's decision
--
-- Nothing here is readable or writable from the app's client: RLS is on with no
-- policies, and only the service role (server functions that first check the
-- caller is a superadmin) has access. Approving a candidate creates an ordinary
-- unclaimed listing through create_unclaimed_team / create_unclaimed_gym.

CREATE TABLE IF NOT EXISTS public.listing_discovery_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  area_id       text NOT NULL,
  types         text[] NOT NULL,
  status        text NOT NULL DEFAULT 'running'
                CHECK (status IN ('running', 'done', 'failed', 'cancelled')),
  -- Search and map lookups still to do, then pages still to read.
  tasks         jsonb NOT NULL DEFAULT '[]'::jsonb,
  pages         jsonb NOT NULL DEFAULT '[]'::jsonb,
  seen_hosts    text[] NOT NULL DEFAULT '{}',
  max_pages     integer NOT NULL DEFAULT 80 CHECK (max_pages BETWEEN 1 AND 200),
  pages_done    integer NOT NULL DEFAULT 0,
  stats         jsonb NOT NULL DEFAULT '{}'::jsonb,
  log           jsonb NOT NULL DEFAULT '[]'::jsonb,
  error         text,
  -- A step holds this while it works, so two open tabs cannot run one step twice.
  lock_until    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);

CREATE TABLE IF NOT EXISTS public.listing_discovery_pages (
  url         text PRIMARY KEY,
  host        text NOT NULL,
  run_id      uuid REFERENCES public.listing_discovery_runs(id) ON DELETE SET NULL,
  outcome     text NOT NULL,
  candidates  integer NOT NULL DEFAULT 0,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.listing_candidates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              uuid REFERENCES public.listing_discovery_runs(id) ON DELETE SET NULL,
  subject_type        text NOT NULL CHECK (subject_type IN ('gym', 'team', 'coach')),
  name                text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  city                text,
  state               text,
  -- Business addresses of gyms only; trainers never get one.
  address             text,
  website             text,
  sports              text[] NOT NULL DEFAULT '{}',
  category            text,
  description         text,
  source              text NOT NULL CHECK (source IN ('osm', 'search')),
  -- The page the facts were read from.
  source_url          text NOT NULL,
  confidence          numeric(3, 2) NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  fingerprint         text NOT NULL,
  -- { kind, id, name, score } of a listing or candidate this may repeat.
  duplicate_of        jsonb,
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected')),
  reject_reason       text,
  reviewed_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at         timestamptz,
  created_listing_id  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- A rejected candidate keeps its row, so rediscovering it does not bring it back.
  CONSTRAINT listing_candidates_fingerprint_key UNIQUE (subject_type, fingerprint)
);

CREATE INDEX IF NOT EXISTS listing_candidates_review_idx
  ON public.listing_candidates (status, subject_type, confidence DESC);
CREATE INDEX IF NOT EXISTS listing_discovery_pages_host_idx
  ON public.listing_discovery_pages (host, fetched_at DESC);
CREATE INDEX IF NOT EXISTS listing_discovery_runs_status_idx
  ON public.listing_discovery_runs (status, created_at DESC);

ALTER TABLE public.listing_discovery_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_discovery_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_candidates      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.listing_discovery_runs  FROM anon, authenticated;
REVOKE ALL ON public.listing_discovery_pages FROM anon, authenticated;
REVOKE ALL ON public.listing_candidates      FROM anon, authenticated;
GRANT ALL ON public.listing_discovery_runs  TO service_role;
GRANT ALL ON public.listing_discovery_pages TO service_role;
GRANT ALL ON public.listing_candidates      TO service_role;
