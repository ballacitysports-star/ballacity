-- Rating system, phase 3: AI analysis of reviews. Rows are written only by the
-- service role (server functions that already passed the AI gate); everyone
-- reads what they can already see.

CREATE TABLE IF NOT EXISTS public.review_ai_analysis (
  review_id uuid PRIMARY KEY REFERENCES public.reviews(id) ON DELETE CASCADE,
  traits text[] NOT NULL DEFAULT '{}',
  sentiment numeric(3,2) CHECK (sentiment BETWEEN -1 AND 1),
  mismatch boolean NOT NULL DEFAULT false,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.review_ai_analysis TO anon, authenticated;
GRANT ALL ON public.review_ai_analysis TO service_role;
ALTER TABLE public.review_ai_analysis ENABLE ROW LEVEL SECURITY;
-- Visible exactly when the underlying review is (reviews' own RLS applies).
CREATE POLICY "Analysis follows review visibility" ON public.review_ai_analysis
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.reviews r WHERE r.id = review_id));

CREATE TABLE IF NOT EXISTS public.reputation_insights (
  reviewee_id text NOT NULL,
  reviewee_kind text NOT NULL CHECK (reviewee_kind IN ('player','trainer','team','host')),
  summary text NOT NULL,
  strengths text[] NOT NULL DEFAULT '{}',
  growth text[] NOT NULL DEFAULT '{}',
  review_count int NOT NULL DEFAULT 0,
  model text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reviewee_id, reviewee_kind)
);
GRANT SELECT ON public.reputation_insights TO anon, authenticated;
GRANT ALL ON public.reputation_insights TO service_role;
ALTER TABLE public.reputation_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Insights are public" ON public.reputation_insights FOR SELECT USING (true);

-- Trait mention counts feeding the sportsmanship badges (badges.ts).
CREATE OR REPLACE FUNCTION public.player_trait_counts(_user uuid)
RETURNS TABLE (respectful int, communicative int, fair_play int, positive int, on_time int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    count(*) FILTER (WHERE 'respectful' = ANY (a.traits))::int,
    count(*) FILTER (WHERE 'communicative' = ANY (a.traits))::int,
    count(*) FILTER (WHERE 'fairPlay' = ANY (a.traits))::int,
    count(*) FILTER (WHERE 'positive' = ANY (a.traits))::int,
    count(*) FILTER (WHERE 'onTime' = ANY (a.traits))::int
  FROM public.reviews r
  JOIN public.review_ai_analysis a ON a.review_id = r.id
  WHERE r.reviewee_kind = 'player' AND r.reviewee_id = _user::text
    AND NOT r.flagged AND NOT r.is_private AND NOT a.mismatch;
$$;
REVOKE ALL ON FUNCTION public.player_trait_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.player_trait_counts(uuid) TO authenticated;
