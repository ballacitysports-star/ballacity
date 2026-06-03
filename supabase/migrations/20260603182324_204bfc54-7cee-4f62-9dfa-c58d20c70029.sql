
-- Profiles
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE,
  display_name TEXT NOT NULL DEFAULT 'Player',
  avatar_initials TEXT,
  bio TEXT,
  sport TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Reviews
CREATE TABLE public.reviews (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('player','trainer','team','host')),
  reviewee_kind TEXT NOT NULL CHECK (reviewee_kind IN ('player','trainer','team','host')),
  reviewee_id TEXT NOT NULL,
  reviewee_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  title TEXT,
  body TEXT NOT NULL,
  context TEXT,
  verified BOOLEAN NOT NULL DEFAULT false,
  is_private BOOLEAN NOT NULL DEFAULT false,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  flagged BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reviews_reviewee_idx ON public.reviews(reviewee_id);
GRANT SELECT ON public.reviews TO anon;
GRANT SELECT, INSERT ON public.reviews TO authenticated;
GRANT ALL ON public.reviews TO service_role;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public reviews are viewable by everyone" ON public.reviews FOR SELECT USING (is_private = false AND flagged = false);
CREATE POLICY "Reviewees view their private reviews" ON public.reviews FOR SELECT TO authenticated USING (is_private = true AND reviewee_id = auth.uid()::text);
CREATE POLICY "Authors view their own reviews" ON public.reviews FOR SELECT TO authenticated USING (reviewer_id = auth.uid());
CREATE POLICY "Users can write reviews as themselves" ON public.reviews FOR INSERT TO authenticated WITH CHECK (reviewer_id = auth.uid());

-- Review helpful (unique vote per user)
CREATE TABLE public.review_helpfuls (
  review_id UUID NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, user_id)
);
GRANT SELECT, INSERT, DELETE ON public.review_helpfuls TO authenticated;
GRANT ALL ON public.review_helpfuls TO service_role;
ALTER TABLE public.review_helpfuls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View own helpful votes" ON public.review_helpfuls FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Vote as self" ON public.review_helpfuls FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Unvote as self" ON public.review_helpfuls FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Trigger to maintain helpful_count
CREATE OR REPLACE FUNCTION public.bump_helpful_count() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.reviews SET helpful_count = helpful_count + 1 WHERE id = NEW.review_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.reviews SET helpful_count = GREATEST(helpful_count - 1, 0) WHERE id = OLD.review_id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_review_helpfuls_count AFTER INSERT OR DELETE ON public.review_helpfuls FOR EACH ROW EXECUTE FUNCTION public.bump_helpful_count();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_initials)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1), 'Player'),
    UPPER(LEFT(COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'name', NEW.email, 'P'), 2))
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at trigger for profiles
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
