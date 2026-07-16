CREATE OR REPLACE FUNCTION public.notify_on_unfollow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name text;
BEGIN
  SELECT COALESCE(display_name, 'Someone') INTO _name
  FROM public.profiles WHERE id = OLD.follower_id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (
    OLD.followee_id,
    'unfollow',
    COALESCE(_name, 'Someone') || ' unfollowed you',
    NULL,
    '/players/' || OLD.follower_id::text
  );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS after_delete_follow ON public.follows;
CREATE TRIGGER after_delete_follow
AFTER DELETE ON public.follows
FOR EACH ROW EXECUTE FUNCTION public.notify_on_unfollow();