-- Per-event availability for team roster members.
--
-- A roster member (or a verified guardian of a member) marks themselves
-- available / maybe / unavailable for an upcoming team event (tryout or camp
-- on the team calendar). Managers read it through the manager-authorized
-- roster overview; members and guardians read only their own rows.
--
-- Writes go only through set_team_event_availability, which re-checks on the
-- server that the target is on the event's team and that the caller is that
-- member or their verified guardian. Roster UI visibility is not the boundary.

CREATE TABLE IF NOT EXISTS public.team_event_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.team_posts(id) ON DELETE CASCADE,
  team_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('available', 'maybe', 'unavailable')),
  note text CHECK (note IS NULL OR char_length(note) <= 200),
  set_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS team_event_availability_team_idx
  ON public.team_event_availability (team_id, post_id);
CREATE INDEX IF NOT EXISTS team_event_availability_user_idx
  ON public.team_event_availability (user_id);

GRANT SELECT ON public.team_event_availability TO authenticated;
GRANT ALL ON public.team_event_availability TO service_role;
ALTER TABLE public.team_event_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own, guardian or manager reads availability"
  ON public.team_event_availability FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_guardian_of(auth.uid(), user_id)
    OR public.is_team_manager(team_id, auth.uid())
  );

CREATE TRIGGER team_event_availability_touch
  BEFORE UPDATE ON public.team_event_availability
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- _status NULL clears the answer.
CREATE OR REPLACE FUNCTION public.set_team_event_availability(
  _post uuid,
  _user uuid,
  _status text,
  _note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_post record;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF _status IS NOT NULL AND _status NOT IN ('available', 'maybe', 'unavailable') THEN
    RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = '22023';
  END IF;

  SELECT id, team_id, event_date INTO v_post
  FROM public.team_posts
  WHERE id = _post
    AND kind IN ('tryout', 'clinic')
    AND hidden_at IS NULL
    AND moderation_status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EVENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_post.event_date IS NOT NULL AND v_post.event_date < now() THEN
    RAISE EXCEPTION 'EVENT_STARTED' USING ERRCODE = '22023';
  END IF;

  IF _user <> v_caller AND NOT public.is_guardian_of(v_caller, _user) THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_team_member(v_post.team_id, _user) THEN
    RAISE EXCEPTION 'NOT_ON_TEAM' USING ERRCODE = '42501';
  END IF;

  IF _status IS NULL THEN
    DELETE FROM public.team_event_availability WHERE post_id = _post AND user_id = _user;
    RETURN;
  END IF;

  INSERT INTO public.team_event_availability (post_id, team_id, user_id, status, note, set_by)
  VALUES (_post, v_post.team_id, _user, _status, nullif(left(btrim(coalesce(_note, '')), 200), ''), v_caller)
  ON CONFLICT (post_id, user_id) DO UPDATE
    SET status = EXCLUDED.status, note = EXCLUDED.note, set_by = EXCLUDED.set_by;
END;
$$;

REVOKE ALL ON FUNCTION public.set_team_event_availability(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_team_event_availability(uuid, uuid, text, text) TO authenticated;
