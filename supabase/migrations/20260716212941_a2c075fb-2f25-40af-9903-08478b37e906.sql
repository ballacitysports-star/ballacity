
-- user_blocks
CREATE TABLE public.user_blocks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX user_blocks_blocker_idx ON public.user_blocks (blocker_id);
CREATE INDEX user_blocks_blocked_idx ON public.user_blocks (blocked_id);
GRANT SELECT, INSERT, DELETE ON public.user_blocks TO authenticated;
GRANT ALL ON public.user_blocks TO service_role;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read their own blocks" ON public.user_blocks
  FOR SELECT TO authenticated USING (auth.uid() = blocker_id);
CREATE POLICY "Users create their own blocks" ON public.user_blocks
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = blocker_id);
CREATE POLICY "Users delete their own blocks" ON public.user_blocks
  FOR DELETE TO authenticated USING (auth.uid() = blocker_id);

-- Cleanup follows when a block happens (both directions)
CREATE OR REPLACE FUNCTION public.remove_follows_on_block()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.follows
  WHERE (follower_id = NEW.blocker_id AND followee_id = NEW.blocked_id)
     OR (follower_id = NEW.blocked_id AND followee_id = NEW.blocker_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_blocks_cleanup_follows
AFTER INSERT ON public.user_blocks
FOR EACH ROW EXECUTE FUNCTION public.remove_follows_on_block();

-- Prevent creating follows against a block in either direction
CREATE OR REPLACE FUNCTION public.prevent_follow_when_blocked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = NEW.follower_id AND blocked_id = NEW.followee_id)
       OR (blocker_id = NEW.followee_id AND blocked_id = NEW.follower_id)
  ) THEN
    RAISE EXCEPTION 'Cannot follow: a block exists between these users.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER follows_block_guard
BEFORE INSERT ON public.follows
FOR EACH ROW EXECUTE FUNCTION public.prevent_follow_when_blocked();

-- user_reports
CREATE TABLE public.user_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reported_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (reporter_id <> reported_id),
  CHECK (reason IN ('spam','harassment','inappropriate','impersonation','safety','other')),
  CHECK (status IN ('pending','reviewing','actioned','dismissed'))
);
CREATE INDEX user_reports_reporter_idx ON public.user_reports (reporter_id);
CREATE INDEX user_reports_reported_idx ON public.user_reports (reported_id);
GRANT SELECT, INSERT ON public.user_reports TO authenticated;
GRANT ALL ON public.user_reports TO service_role;
ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read their own submitted reports" ON public.user_reports
  FOR SELECT TO authenticated USING (auth.uid() = reporter_id);
CREATE POLICY "Users create their own reports" ON public.user_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = reporter_id
    AND length(coalesce(details, '')) <= 1000
  );
CREATE POLICY "Admins read all reports" ON public.user_reports
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
