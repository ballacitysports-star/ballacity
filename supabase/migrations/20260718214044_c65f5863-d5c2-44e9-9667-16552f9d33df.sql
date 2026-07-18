
-- Teams table for persistent team/coach organizations
CREATE TABLE public.teams (
  id TEXT PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('team','coach')),
  name TEXT NOT NULL,
  handle TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  founded INTEGER,
  sports TEXT[] NOT NULL DEFAULT '{}',
  bio TEXT NOT NULL DEFAULT '',
  achievements TEXT[] NOT NULL DEFAULT '{}',
  accent TEXT NOT NULL DEFAULT '#a3ff12',
  avatar TEXT NOT NULL DEFAULT '',
  cover TEXT NOT NULL DEFAULT '',
  league TEXT,
  home_court TEXT,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  staff JSONB NOT NULL DEFAULT '[]'::jsonb,
  credentials TEXT[] NOT NULL DEFAULT '{}',
  rate_per_hour INTEGER,
  skill_min INTEGER NOT NULL DEFAULT 1 CHECK (skill_min BETWEEN 1 AND 5),
  skill_max INTEGER NOT NULL DEFAULT 5 CHECK (skill_max BETWEEN 1 AND 5),
  followers INTEGER NOT NULL DEFAULT 0,
  verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX teams_owner_id_idx ON public.teams(owner_id);
CREATE INDEX teams_kind_idx ON public.teams(kind);

GRANT SELECT ON public.teams TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO authenticated;
GRANT ALL ON public.teams TO service_role;

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teams are publicly readable"
  ON public.teams FOR SELECT
  USING (true);

CREATE POLICY "Owners can insert their teams"
  ON public.teams FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners can update their teams"
  ON public.teams FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners can delete their teams"
  ON public.teams FOR DELETE
  TO authenticated
  USING (auth.uid() = owner_id);

CREATE TRIGGER teams_touch_updated_at
  BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
