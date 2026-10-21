-- Rating system, phase 4: per-sport skill ratings.
-- Peer votes ("below / at / above this game's level") are the only new user
-- input; ratings are computed server-side from self-level + votes + video
-- analysis and stored here. Adults only: nobody under 18 is rated by peers.

CREATE TABLE IF NOT EXISTS public.skill_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id text NOT NULL,
  voter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sport text NOT NULL,
  vote smallint NOT NULL CHECK (vote IN (-1, 0, 1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, voter_id, subject_id),
  CHECK (voter_id <> subject_id)
);
CREATE INDEX IF NOT EXISTS skill_votes_subject_idx ON public.skill_votes (subject_id, sport, created_at DESC);
GRANT SELECT, INSERT ON public.skill_votes TO authenticated;
GRANT ALL ON public.skill_votes TO service_role;
ALTER TABLE public.skill_votes ENABLE ROW LEVEL SECURITY;
-- Votes are anonymous: only the voter can read their own; ratings are public.
CREATE POLICY "Voters read own votes" ON public.skill_votes
  FOR SELECT TO authenticated USING (voter_id = auth.uid());
CREATE POLICY "Vote as self" ON public.skill_votes
  FOR INSERT TO authenticated WITH CHECK (voter_id = auth.uid());

CREATE OR REPLACE FUNCTION public.enforce_skill_vote()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;  -- service role

  IF public.age_cohort_of(NEW.voter_id) <> 'adult' OR public.age_cohort_of(NEW.subject_id) <> 'adult' THEN
    RAISE EXCEPTION 'Skill ratings are only available between adults.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO e FROM public.review_eligibility(NEW.voter_id, 'player', NEW.subject_id::text) x
   WHERE x.game_id = NEW.game_id LIMIT 1;
  IF NOT FOUND OR e.sport IS NULL THEN
    RAISE EXCEPTION 'You can only rate people you played with in a game.' USING ERRCODE = '42501';
  END IF;
  IF e.happened_at < now() - interval '14 days' THEN
    RAISE EXCEPTION 'The 14-day window for this game has closed.' USING ERRCODE = 'P0001';
  END IF;

  NEW.sport := e.sport;
  NEW.created_at := now();

  IF (SELECT count(*) FROM public.skill_votes v
       WHERE v.voter_id = NEW.voter_id AND v.created_at > now() - interval '1 day') >= 40 THEN
    RAISE EXCEPTION 'Daily limit reached.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enforce_skill_vote_trg ON public.skill_votes;
CREATE TRIGGER enforce_skill_vote_trg BEFORE INSERT ON public.skill_votes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_skill_vote();

CREATE TABLE IF NOT EXISTS public.skill_ratings (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sport text NOT NULL,
  mu numeric(5,1) NOT NULL,
  sigma numeric(5,1) NOT NULL,
  low smallint NOT NULL,
  high smallint NOT NULL,
  status text NOT NULL CHECK (status IN ('provisional','developing','established')),
  label text NOT NULL,
  self_tier text,
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,   -- contributions + counts, no individual votes
  report jsonb,                                 -- AI scouting report (owner-requested)
  report_at timestamptz,
  hidden boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sport)
);
GRANT SELECT ON public.skill_ratings TO anon, authenticated;
GRANT ALL ON public.skill_ratings TO service_role;
ALTER TABLE public.skill_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Skill ratings visible unless hidden" ON public.skill_ratings
  FOR SELECT USING (hidden = false OR user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.set_skill_rating_hidden(_sport text, _hidden boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.skill_ratings SET hidden = _hidden WHERE user_id = auth.uid() AND sport = _sport;
$$;
REVOKE ALL ON FUNCTION public.set_skill_rating_hidden(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_skill_rating_hidden(text, boolean) TO authenticated;
