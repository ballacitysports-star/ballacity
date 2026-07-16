
CREATE TABLE public.follows (
  follower_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  followee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);

CREATE INDEX follows_followee_idx ON public.follows(followee_id);
CREATE INDEX follows_follower_idx ON public.follows(follower_id);

GRANT SELECT ON public.follows TO anon, authenticated;
GRANT INSERT, DELETE ON public.follows TO authenticated;
GRANT ALL ON public.follows TO service_role;

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Follows are readable by anyone"
  ON public.follows FOR SELECT
  USING (true);

CREATE POLICY "Users can follow as themselves"
  ON public.follows FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = follower_id);

CREATE POLICY "Users can unfollow their own follows"
  ON public.follows FOR DELETE
  TO authenticated
  USING (auth.uid() = follower_id);

CREATE OR REPLACE FUNCTION public.notify_on_follow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name text;
BEGIN
  SELECT COALESCE(display_name, 'Someone') INTO _name
  FROM public.profiles WHERE id = NEW.follower_id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (
    NEW.followee_id,
    'follow',
    COALESCE(_name, 'Someone') || ' started following you',
    NULL,
    '/players/' || NEW.follower_id::text
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER after_insert_follow
AFTER INSERT ON public.follows
FOR EACH ROW EXECUTE FUNCTION public.notify_on_follow();
