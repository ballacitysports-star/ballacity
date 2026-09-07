-- 1. Private schema for internal helper functions (not exposed through the API)
CREATE SCHEMA IF NOT EXISTS private_sec;
REVOKE ALL ON SCHEMA private_sec FROM PUBLIC;
GRANT USAGE ON SCHEMA private_sec TO anon, authenticated, service_role;

-- 2. Recreate helpers inside the private schema (identical logic)
CREATE OR REPLACE FUNCTION private_sec.profile_visibility_of(_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT pp.profile_visibility FROM public.privacy_preferences pp WHERE pp.user_id = _user),
    public.default_profile_visibility_for(_user)
  );
$$;

CREATE OR REPLACE FUNCTION private_sec.reel_publicly_visible(_reel_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE public.reel_audience(_reel_id)
    WHEN 'public' THEN true
    WHEN 'members' THEN auth.uid() IS NOT NULL
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION private_sec.comment_subject_owner(_subject_type text, _subject_id text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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

CREATE OR REPLACE FUNCTION private_sec.can_comment_on_minor_content(_commenter uuid, _content_owner uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cohort text;
BEGIN
  IF _content_owner IS NULL THEN RETURN true; END IF;

  cohort := public.age_cohort_of(_content_owner);
  IF cohort NOT IN ('child_under_13','teen_13_15','teen_16_17') THEN
    RETURN true;
  END IF;

  IF _commenter IS NULL THEN RETURN false; END IF;

  IF _commenter = _content_owner THEN RETURN true; END IF;
  IF public.is_guardian_of(_commenter, _content_owner) THEN RETURN true; END IF;
  IF public.shares_team(_commenter, _content_owner) THEN RETURN true; END IF;

  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION private_sec.roster_row_visible(_team_id text, _member_user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cohort text; caller uuid;
BEGIN
  IF _member_user_id IS NULL THEN RETURN true; END IF;

  cohort := public.age_cohort_of(_member_user_id);

  IF cohort NOT IN ('child_under_13','teen_13_15','teen_16_17') THEN
    RETURN true;
  END IF;

  caller := auth.uid();

  IF cohort = 'teen_16_17' AND caller IS NOT NULL THEN RETURN true; END IF;

  IF caller IS NULL THEN RETURN false; END IF;
  IF caller = _member_user_id THEN RETURN true; END IF;
  IF public.is_guardian_of(caller, _member_user_id) THEN RETURN true; END IF;
  IF public.is_team_manager(_team_id, caller) THEN RETURN true; END IF;

  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION private_sec.visible_avatars(_ids uuid[])
RETURNS TABLE(id uuid, display_name text, avatar_initials text, avatar_url text, avatar_visibility text, avatar_hidden boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.id,
    p.display_name,
    p.avatar_initials,
    CASE
      WHEN coalesce(p.avatar_url, p.avatar_url_private) IS NULL THEN NULL
      WHEN p.id = auth.uid() THEN coalesce(p.avatar_url, p.avatar_url_private)
      WHEN p.avatar_visibility = 'public' THEN coalesce(p.avatar_url, p.avatar_url_private)
      WHEN p.avatar_visibility = 'members' AND auth.uid() IS NOT NULL
        THEN coalesce(p.avatar_url, p.avatar_url_private)
      WHEN p.avatar_visibility = 'game_members'
        AND auth.uid() IS NOT NULL
        AND public.shares_game_or_chat(auth.uid(), p.id)
        THEN coalesce(p.avatar_url, p.avatar_url_private)
      ELSE NULL
    END AS avatar_url,
    p.avatar_visibility,
    (
      coalesce(p.avatar_url, p.avatar_url_private) IS NOT NULL
      AND NOT (
        p.id = auth.uid()
        OR p.avatar_visibility = 'public'
        OR (p.avatar_visibility = 'members' AND auth.uid() IS NOT NULL)
        OR (
          p.avatar_visibility = 'game_members'
          AND auth.uid() IS NOT NULL
          AND public.shares_game_or_chat(auth.uid(), p.id)
        )
      )
    ) AS avatar_hidden
  FROM public.profiles p
  WHERE p.id = ANY(_ids)
    AND p.suspended_at IS NULL;
$$;

REVOKE ALL ON FUNCTION private_sec.profile_visibility_of(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private_sec.reel_publicly_visible(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private_sec.comment_subject_owner(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private_sec.can_comment_on_minor_content(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private_sec.roster_row_visible(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private_sec.visible_avatars(uuid[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION private_sec.profile_visibility_of(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private_sec.reel_publicly_visible(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private_sec.comment_subject_owner(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private_sec.can_comment_on_minor_content(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private_sec.roster_row_visible(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private_sec.visible_avatars(uuid[]) TO anon, authenticated, service_role;

-- 3. Point existing policies at the private helpers
DROP POLICY IF EXISTS "Public profiles viewable by anon" ON public.profiles;
CREATE POLICY "Public profiles viewable by anon"
ON public.profiles FOR SELECT TO anon
USING (private_sec.profile_visibility_of(id) = 'public');

DROP POLICY IF EXISTS "Profiles viewable by members" ON public.profiles;
CREATE POLICY "Profiles viewable by members"
ON public.profiles FOR SELECT TO authenticated
USING (id = auth.uid() OR private_sec.profile_visibility_of(id) IN ('public','members'));

DROP POLICY IF EXISTS "Anyone can view visible completed reels" ON public.highlight_reels;
CREATE POLICY "Anyone can view visible completed reels"
ON public.highlight_reels FOR SELECT TO anon, authenticated
USING (hidden_at IS NULL AND status = 'completed' AND private_sec.reel_publicly_visible(id));

DROP POLICY IF EXISTS "Comments are readable by permitted viewers" ON public.post_comments;
CREATE POLICY "Comments are readable by permitted viewers"
ON public.post_comments FOR SELECT TO anon, authenticated
USING (private_sec.can_comment_on_minor_content(auth.uid(), private_sec.comment_subject_owner(subject_type, subject_id)));

DROP POLICY IF EXISTS "Users can insert their own comments" ON public.post_comments;
CREATE POLICY "Users can insert their own comments"
ON public.post_comments FOR INSERT TO authenticated
WITH CHECK (auth.uid() = author_id
  AND private_sec.can_comment_on_minor_content(auth.uid(), private_sec.comment_subject_owner(subject_type, subject_id)));

DROP POLICY IF EXISTS "team_members_read" ON public.team_members;
CREATE POLICY "team_members_read"
ON public.team_members FOR SELECT TO anon, authenticated
USING (
  EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_members.team_id AND t.hidden_at IS NULL)
  AND private_sec.roster_row_visible(team_id, user_id)
);

-- 4. Drop the policy-only helpers from the exposed schema
DROP FUNCTION IF EXISTS public.reel_publicly_visible(uuid);
DROP FUNCTION IF EXISTS public.comment_subject_owner(text, text);
DROP FUNCTION IF EXISTS public.can_comment_on_minor_content(uuid, uuid);
DROP FUNCTION IF EXISTS public.roster_row_visible(text, uuid);

-- 5. Keep the two API-called names, but as SECURITY INVOKER wrappers
CREATE OR REPLACE FUNCTION public.profile_visibility_of(_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT private_sec.profile_visibility_of(_user);
$$;

CREATE OR REPLACE FUNCTION public.visible_avatars(_ids uuid[])
RETURNS TABLE(id uuid, display_name text, avatar_initials text, avatar_url text, avatar_visibility text, avatar_hidden boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT * FROM private_sec.visible_avatars(_ids);
$$;

REVOKE ALL ON FUNCTION public.profile_visibility_of(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.visible_avatars(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_visibility_of(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.visible_avatars(uuid[]) TO anon, authenticated, service_role;