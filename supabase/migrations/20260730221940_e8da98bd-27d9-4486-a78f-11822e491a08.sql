CREATE TABLE public.feed_preferences (
  user_id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  saved_views jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.feed_preferences TO authenticated;
GRANT ALL ON public.feed_preferences TO service_role;

ALTER TABLE public.feed_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own feed preferences"
ON public.feed_preferences
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER feed_preferences_touch_updated_at
BEFORE UPDATE ON public.feed_preferences
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();