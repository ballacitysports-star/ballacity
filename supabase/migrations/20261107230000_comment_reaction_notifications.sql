-- Comment and reaction notifications (backlog P1-5).
--
-- Comments and reactions on team posts, games and highlight reels have never told the
-- owner anything ("comment" and "reaction" exist as notification types in the app, but
-- nothing writes them). This adds both, and closes two gaps found while doing so.
--
-- 0. Games: the shared owner lookup never found a game's host (game ids are text, not
--    uuids), so the minor-content comment rule never applied to games and no game host
--    could be notified. Fixed below.
--
-- 1. Reactions follow the same rule as comments on a minor's content. Comments may only
--    be written by someone private_sec.can_comment_on_minor_content allows (the minor,
--    their verified guardian, or a teammate). The reaction INSERT policy checked only
--    that you react as yourself, so any signed-in account could react to a minor's post,
--    reel or game. Once reactions notify, that would let a stranger reach a minor. The
--    policy now uses the same check as comments. Existing reaction rows are not touched.
--
-- 2. Comment notification. When a comment first becomes visible (approved, not hidden,
--    not deleted), the owner of what it is on gets type 'comment'. Not sent when:
--      * the commenter is the owner;
--      * there is a block either way;
--      * the comment rule no longer allows that commenter;
--      * the owner already has this exact text from this commenter on this item, so an
--        approved -> held -> approved round trip does not repeat it.
--    An edit that changes the text goes back to moderation and, once approved, notifies
--    with the new text.
--
-- 3. Reaction notification. When a reaction is added, the owner gets type 'reaction',
--    with the same exclusions. At most one per reactor per item per day, so tapping
--    several emoji (or toggling one) does not flood the owner.
--
-- Both are in-app rows only, like the other database-written notifications; push and the
-- minors' quiet hours are unchanged. The owner is the author of a team post, the host of a
-- game, or the owner of a reel (private_sec.comment_subject_owner).

-- ---------------------------------------------------------------- 0. game owner lookup
-- private_sec.comment_subject_owner cast every subject id to uuid before looking it up.
-- Game ids are text and are not uuids (none of production's games has a uuid id), so the
-- cast failed and a game's owner always came back NULL. can_comment_on_minor_content
-- treats a NULL owner as "not a minor's content", so the comment rule never applied to a
-- game hosted by a teen, and nothing could find a game's host to notify. Games are now
-- looked up by their text id; posts and reels keep the uuid path.
CREATE OR REPLACE FUNCTION private_sec.comment_subject_owner(_subject_type text, _subject_id text)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE sid uuid; owner_id uuid;
BEGIN
  IF _subject_type = 'game' THEN
    SELECT host_id INTO owner_id FROM public.hosted_games WHERE id = _subject_id;
    RETURN owner_id;
  END IF;

  BEGIN
    sid := _subject_id::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;

  IF _subject_type = 'highlight_reel' THEN
    SELECT user_id INTO owner_id FROM public.highlight_reels WHERE id = sid;
  ELSIF _subject_type = 'team_post' THEN
    SELECT author_id INTO owner_id FROM public.team_posts WHERE id = sid;
  END IF;

  RETURN owner_id;
END $$;

-- ---------------------------------------------------------------- 1. reaction policy
DROP POLICY IF EXISTS "Users can add their own reactions" ON public.post_reactions;
CREATE POLICY "Users can add their own reactions" ON public.post_reactions
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND private_sec.can_comment_on_minor_content(
      auth.uid(), private_sec.comment_subject_owner(subject_type, subject_id))
  );

-- ---------------------------------------------------------------- shared helpers
-- Where a notification about a subject should open, and what to call it.
CREATE OR REPLACE FUNCTION private_sec.engagement_subject_link(_subject_type text, _subject_id text)
RETURNS TABLE (link text, noun text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _team text;
BEGIN
  IF _subject_type = 'team_post' THEN
    BEGIN
      SELECT p.team_id INTO _team FROM public.team_posts p WHERE p.id = _subject_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN;
    END;
    IF _team IS NULL THEN RETURN; END IF;
    RETURN QUERY SELECT '/teams/' || _team, 'post'::text;
  ELSIF _subject_type = 'game' THEN
    RETURN QUERY SELECT '/games/' || _subject_id, 'game'::text;
  ELSIF _subject_type = 'highlight_reel' THEN
    RETURN QUERY SELECT '/reels/' || _subject_id, 'highlight'::text;
  END IF;
END $$;

REVOKE ALL ON FUNCTION private_sec.engagement_subject_link(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.engagement_subject_link(text, text) TO service_role;

-- Whether _actor may notify _owner about _actor's activity on their content.
CREATE OR REPLACE FUNCTION private_sec.may_notify_engagement(_actor uuid, _owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _owner IS NOT NULL
     AND _actor IS DISTINCT FROM _owner
     AND NOT public.blocks_exist_between(_actor, _owner)
     AND private_sec.can_comment_on_minor_content(_actor, _owner);
$$;

REVOKE ALL ON FUNCTION private_sec.may_notify_engagement(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.may_notify_engagement(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------- 2. comments
CREATE OR REPLACE FUNCTION public.notify_on_post_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner uuid;
  _who text;
  _link text;
  _noun text;
  _body text;
BEGIN
  IF NEW.moderation_status <> 'approved' OR NEW.hidden_at IS NOT NULL OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.moderation_status = 'approved' THEN
    RETURN NEW;
  END IF;

  _owner := private_sec.comment_subject_owner(NEW.subject_type, NEW.subject_id);
  IF NOT private_sec.may_notify_engagement(NEW.author_id, _owner) THEN
    RETURN NEW;
  END IF;
  SELECT s.link, s.noun INTO _link, _noun
  FROM private_sec.engagement_subject_link(NEW.subject_type, NEW.subject_id) s;
  IF _link IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(p.display_name, 'Someone') INTO _who FROM public.profiles p WHERE p.id = NEW.author_id;
  _who := COALESCE(_who, 'Someone');
  _body := left(NEW.body, 200);

  IF EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = _owner AND n.type = 'comment' AND n.link = _link
      AND n.title = _who || ' commented on your ' || _noun AND n.body = _body
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_owner, 'comment', _who || ' commented on your ' || _noun, _body, _link);
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.notify_on_post_comment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_on_post_comment() TO service_role;

DROP TRIGGER IF EXISTS post_comments_notify_owner ON public.post_comments;
CREATE TRIGGER post_comments_notify_owner
AFTER INSERT OR UPDATE OF moderation_status ON public.post_comments
FOR EACH ROW EXECUTE FUNCTION public.notify_on_post_comment();

-- ---------------------------------------------------------------- 3. reactions
CREATE OR REPLACE FUNCTION public.notify_on_post_reaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner uuid;
  _who text;
  _link text;
  _noun text;
BEGIN
  _owner := private_sec.comment_subject_owner(NEW.subject_type, NEW.subject_id);
  IF NOT private_sec.may_notify_engagement(NEW.user_id, _owner) THEN
    RETURN NEW;
  END IF;
  SELECT s.link, s.noun INTO _link, _noun
  FROM private_sec.engagement_subject_link(NEW.subject_type, NEW.subject_id) s;
  IF _link IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(p.display_name, 'Someone') INTO _who FROM public.profiles p WHERE p.id = NEW.user_id;
  _who := COALESCE(_who, 'Someone');

  IF EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = _owner AND n.type = 'reaction' AND n.link = _link
      AND left(n.title, length(_who || ' reacted to your ' || _noun)) = _who || ' reacted to your ' || _noun
      AND n.created_at > now() - interval '1 day'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_owner, 'reaction', _who || ' reacted to your ' || _noun || ' ' || NEW.emoji, NULL, _link);
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.notify_on_post_reaction() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_on_post_reaction() TO service_role;

DROP TRIGGER IF EXISTS post_reactions_notify_owner ON public.post_reactions;
CREATE TRIGGER post_reactions_notify_owner
AFTER INSERT ON public.post_reactions
FOR EACH ROW EXECUTE FUNCTION public.notify_on_post_reaction();
