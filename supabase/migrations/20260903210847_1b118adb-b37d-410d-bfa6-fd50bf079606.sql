-- 1. Immutable family activity log ------------------------------------------
CREATE TABLE public.family_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  child_user_id uuid NOT NULL,
  action text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.family_audit_log TO authenticated;
GRANT ALL ON public.family_audit_log TO service_role;

ALTER TABLE public.family_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family and moderators can read family activity"
ON public.family_audit_log FOR SELECT TO authenticated
USING (
  child_user_id = auth.uid()
  OR public.is_guardian_of(auth.uid(), child_user_id)
  OR public.is_moderator(auth.uid())
);

CREATE INDEX family_audit_log_child_idx ON public.family_audit_log (child_user_id, created_at DESC);
CREATE INDEX family_audit_log_actor_idx ON public.family_audit_log (actor_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.family_audit_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'family_audit_log is append-only';
END;
$$;

CREATE TRIGGER family_audit_log_no_update
BEFORE UPDATE OR DELETE ON public.family_audit_log
FOR EACH ROW EXECUTE FUNCTION public.family_audit_log_append_only();

-- 2. Automatic logging triggers ----------------------------------------------
CREATE OR REPLACE FUNCTION public.log_child_controls_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.family_audit_log (actor_user_id, child_user_id, action, context)
    VALUES (auth.uid(), NEW.child_user_id, 'controls.created', '{}'::jsonb);
    RETURN NEW;
  END IF;

  IF NEW.messaging IS DISTINCT FROM OLD.messaging THEN
    changed := changed || jsonb_build_object('messaging', NEW.messaging);
  END IF;
  IF NEW.media_visibility IS DISTINCT FROM OLD.media_visibility THEN
    changed := changed || jsonb_build_object('media_visibility', NEW.media_visibility);
  END IF;
  IF NEW.location_precision IS DISTINCT FROM OLD.location_precision THEN
    changed := changed || jsonb_build_object('location_precision', NEW.location_precision);
  END IF;
  IF NEW.social_discovery IS DISTINCT FROM OLD.social_discovery THEN
    changed := changed || jsonb_build_object('social_discovery', NEW.social_discovery);
  END IF;
  IF NEW.ai_analysis IS DISTINCT FROM OLD.ai_analysis THEN
    changed := changed || jsonb_build_object('ai_analysis', NEW.ai_analysis);
  END IF;
  IF NEW.game_participation IS DISTINCT FROM OLD.game_participation THEN
    changed := changed || jsonb_build_object('game_participation', NEW.game_participation);
  END IF;
  IF NEW.notifications IS DISTINCT FROM OLD.notifications THEN
    changed := changed || jsonb_build_object('notifications', NEW.notifications);
  END IF;
  IF NEW.notification_curfew_lifted IS DISTINCT FROM OLD.notification_curfew_lifted THEN
    changed := changed || jsonb_build_object('notification_curfew_lifted', NEW.notification_curfew_lifted);
  END IF;

  IF changed <> '{}'::jsonb THEN
    INSERT INTO public.family_audit_log (actor_user_id, child_user_id, action, context)
    VALUES (auth.uid(), NEW.child_user_id, 'controls.changed', changed);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER log_child_controls_change
AFTER INSERT OR UPDATE ON public.child_controls
FOR EACH ROW EXECUTE FUNCTION public.log_child_controls_change();

CREATE OR REPLACE FUNCTION public.log_parental_consent_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.family_audit_log (actor_user_id, child_user_id, action, context)
  VALUES (
    auth.uid(),
    NEW.child_user_id,
    'consent.' || NEW.status,
    jsonb_build_object('method', NEW.method, 'jurisdiction', NEW.jurisdiction)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER log_parental_consent_change
AFTER INSERT OR UPDATE ON public.parental_consents
FOR EACH ROW EXECUTE FUNCTION public.log_parental_consent_change();

CREATE OR REPLACE FUNCTION public.log_guardian_link_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.family_audit_log (actor_user_id, child_user_id, action, context)
  VALUES (
    auth.uid(),
    NEW.child_user_id,
    'link.' || NEW.status,
    jsonb_build_object('relationship', NEW.relationship)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER log_guardian_link_change
AFTER INSERT OR UPDATE ON public.guardian_links
FOR EACH ROW EXECUTE FUNCTION public.log_guardian_link_change();

-- 3. One-shot family overview for the Parent Center --------------------------
CREATE OR REPLACE FUNCTION public.guardian_children_overview()
RETURNS TABLE (
  child_user_id uuid,
  display_name text,
  username text,
  avatar_url text,
  age_cohort text,
  age_review_required boolean,
  consent_status text,
  consent_method text,
  consent_requested_at timestamptz,
  consent_approved_at timestamptz,
  consent_revoked_at timestamptz,
  consent_reverify_at timestamptz,
  consent_parent_email text,
  relationship text,
  linked_at timestamptz,
  upcoming_games integer,
  next_game_title text,
  next_game_at timestamptz,
  team_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH kids AS (
    SELECT gl.child_user_id, gl.relationship, gl.created_at AS linked_at
    FROM public.guardian_links gl
    WHERE gl.parent_user_id = auth.uid() AND gl.status = 'active'
  ),
  games AS (
    SELECT gp.user_id,
           count(*)::int AS upcoming_games,
           (array_agg(hg.title ORDER BY hg.date))[1] AS next_game_title,
           min(hg.date) AS next_game_at
    FROM public.game_participants gp
    JOIN public.hosted_games hg ON hg.id = gp.game_id
    WHERE gp.user_id IN (SELECT child_user_id FROM kids)
      AND hg.date >= now()
      AND coalesce(hg.status, 'scheduled') NOT IN ('cancelled', 'completed')
    GROUP BY gp.user_id
  ),
  teams AS (
    SELECT tm.user_id, count(*)::int AS team_count
    FROM public.team_members tm
    WHERE tm.user_id IN (SELECT child_user_id FROM kids)
    GROUP BY tm.user_id
  )
  SELECT
    k.child_user_id,
    coalesce(p.display_name, 'Child account'),
    p.username,
    p.avatar_url,
    coalesce(p.age_cohort, 'unknown'),
    coalesce(p.age_review_required, false),
    pc.status,
    pc.method,
    pc.requested_at,
    pc.approved_at,
    pc.revoked_at,
    pc.reverify_at,
    pc.parent_email,
    k.relationship,
    k.linked_at,
    coalesce(g.upcoming_games, 0),
    g.next_game_title,
    g.next_game_at,
    coalesce(t.team_count, 0)
  FROM kids k
  LEFT JOIN public.profiles p ON p.id = k.child_user_id
  LEFT JOIN public.parental_consents pc ON pc.child_user_id = k.child_user_id
  LEFT JOIN games g ON g.user_id = k.child_user_id
  LEFT JOIN teams t ON t.user_id = k.child_user_id
  ORDER BY coalesce(p.display_name, 'Child account');
$$;

REVOKE ALL ON FUNCTION public.guardian_children_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardian_children_overview() TO authenticated, service_role;

-- 4. Parent ends a family link ----------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_guardian_link(_child_user_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent uuid := auth.uid();
BEGIN
  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.guardian_links
    WHERE parent_user_id = v_parent AND child_user_id = _child_user_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  UPDATE public.guardian_links
  SET status = 'revoked'
  WHERE parent_user_id = v_parent AND child_user_id = _child_user_id AND status = 'active';

  UPDATE public.parental_consents
  SET status = 'revoked',
      revoked_at = now(),
      revoked_reason = coalesce(_reason, 'Guardian ended the family link'),
      updated_at = now()
  WHERE child_user_id = _child_user_id
    AND parent_user_id = v_parent
    AND status <> 'revoked';
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_guardian_link(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_guardian_link(uuid, text) TO authenticated, service_role;