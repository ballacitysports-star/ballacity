-- Team announcements notify the team (backlog P1-6).
--
-- Only a team manager can post an announcement (policy "team_posts member insert"), and
-- every post starts pending until moderation approves it. Until now an approved
-- announcement reached nobody: members saw it only if they opened the team page.
--
-- When an announcement first becomes visible (moderation_status turns 'approved' and the
-- post is not hidden), every member of the team gets an in-app notification. Except:
--   * the author;
--   * anyone with a block either way with the author;
--   * anyone who already got this announcement. A post can go approved -> held -> approved
--     again, so the check is by team link and title.
-- The notification carries the team name and the announcement's title and opening text,
-- which moderation has already approved. Members are already guardian-gated (a minor
-- joins a team only with guardian approval), so no new path to a minor is opened.
-- Push delivery and the minors' quiet hours are unchanged: like the other
-- database-written notifications, this is an in-app row only.

CREATE OR REPLACE FUNCTION public.notify_team_on_announcement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _team text;
  _title text;
  _link text;
BEGIN
  IF NEW.kind <> 'announcement' OR NEW.moderation_status <> 'approved' OR NEW.hidden_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.moderation_status = 'approved' THEN
    RETURN NEW;
  END IF;

  SELECT t.name INTO _team FROM public.teams t WHERE t.id = NEW.team_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  _title := left(_team || ': ' || NEW.title, 200);
  _link := '/teams/' || NEW.team_id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT m.user_id, 'team_announcement', _title, nullif(left(NEW.body, 280), ''), _link
  FROM public.team_members m
  WHERE m.team_id = NEW.team_id
    AND m.user_id <> NEW.author_id
    AND NOT public.blocks_exist_between(m.user_id, NEW.author_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = m.user_id
        AND n.type = 'team_announcement'
        AND n.link = _link
        AND n.title = _title
    );
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.notify_team_on_announcement() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_team_on_announcement() TO service_role;

DROP TRIGGER IF EXISTS team_posts_notify_announcement ON public.team_posts;
CREATE TRIGGER team_posts_notify_announcement
AFTER INSERT OR UPDATE OF moderation_status ON public.team_posts
FOR EACH ROW EXECUTE FUNCTION public.notify_team_on_announcement();
