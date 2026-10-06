-- Age groups a coach / trainer works with (ids: youth, teen, adult), used by
-- the /trainers directory filter. Empty = not specified.
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS age_groups text[] NOT NULL DEFAULT '{}';
