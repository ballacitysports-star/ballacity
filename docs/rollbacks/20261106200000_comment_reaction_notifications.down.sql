-- ROLLBACK for supabase/migrations/20261106200000_comment_reaction_notifications.sql (P1-5).
-- NOT a migration (outside supabase/migrations). It removes comment and reaction notifications AND reopens two
-- gaps: any signed-in account can react to a minor's content again, and the comment rule again ignores games
-- hosted by a minor (their host is not found). It refuses to run unless the session confirms:
--     PGOPTIONS="-c app.confirm_reopen_minor_reactions=yes" psql ... -f <this file>
-- Notifications already delivered stay. No other row is changed.
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_reopen_minor_reactions', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this lets strangers react to minors'' content and comment on games a minor hosts. Set app.confirm_reopen_minor_reactions=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS post_reactions_notify_owner ON public.post_reactions;
DROP TRIGGER IF EXISTS post_comments_notify_owner ON public.post_comments;
DROP FUNCTION IF EXISTS public.notify_on_post_reaction();
DROP FUNCTION IF EXISTS public.notify_on_post_comment();
DROP FUNCTION IF EXISTS private_sec.may_notify_engagement(uuid, uuid);
DROP FUNCTION IF EXISTS private_sec.engagement_subject_link(text, text);

DROP POLICY IF EXISTS "Users can add their own reactions" ON public.post_reactions;
CREATE POLICY "Users can add their own reactions" ON public.post_reactions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION private_sec.comment_subject_owner(_subject_type text, _subject_id text)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE sid uuid; owner_id uuid;
BEGIN
  BEGIN
    sid := _subject_id::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;

  IF _subject_type = 'highlight_reel' THEN
    SELECT user_id INTO owner_id FROM public.highlight_reels WHERE id = sid;
  ELSIF _subject_type = 'team_post' THEN
    SELECT author_id INTO owner_id FROM public.team_posts WHERE id = sid;
  ELSIF _subject_type = 'game' THEN
    SELECT host_id INTO owner_id FROM public.hosted_games WHERE id = sid;
  END IF;

  RETURN owner_id;
END $$;

COMMIT;
