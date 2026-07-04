
CREATE TABLE public.hosted_games (
  id text PRIMARY KEY,
  host_id uuid NOT NULL,
  sport text NOT NULL,
  title text NOT NULL,
  date timestamptz NOT NULL,
  duration text NOT NULL DEFAULT '90 min',
  location text NOT NULL DEFAULT 'TBD',
  neighborhood text NOT NULL DEFAULT '',
  distance_mi numeric NOT NULL DEFAULT 0,
  lat numeric NOT NULL DEFAULT 50,
  lng numeric NOT NULL DEFAULT 50,
  max_players integer NOT NULL DEFAULT 10,
  joined integer NOT NULL DEFAULT 0,
  skill text NOT NULL DEFAULT 'All Levels',
  price numeric NOT NULL DEFAULT 0,
  indoor boolean NOT NULL DEFAULT false,
  is_private boolean NOT NULL DEFAULT false,
  urgent boolean NOT NULL DEFAULT false,
  trending boolean NOT NULL DEFAULT false,
  image text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  equipment text[] NOT NULL DEFAULT '{}',
  status text,
  joins_closed boolean NOT NULL DEFAULT false,
  host_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.hosted_games TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hosted_games TO authenticated;
GRANT ALL ON public.hosted_games TO service_role;

ALTER TABLE public.hosted_games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view hosted games"
  ON public.hosted_games FOR SELECT
  USING (true);

CREATE POLICY "Hosts can insert their games"
  ON public.hosted_games FOR INSERT
  TO authenticated
  WITH CHECK (host_id = auth.uid());

CREATE POLICY "Hosts can update their games"
  ON public.hosted_games FOR UPDATE
  TO authenticated
  USING (host_id = auth.uid())
  WITH CHECK (host_id = auth.uid());

CREATE POLICY "Hosts can delete their games"
  ON public.hosted_games FOR DELETE
  TO authenticated
  USING (host_id = auth.uid());

CREATE TRIGGER hosted_games_touch_updated_at
  BEFORE UPDATE ON public.hosted_games
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.hosted_games;
ALTER TABLE public.hosted_games REPLICA IDENTITY FULL;

CREATE INDEX hosted_games_host_id_idx ON public.hosted_games(host_id);
CREATE INDEX hosted_games_date_idx ON public.hosted_games(date);
