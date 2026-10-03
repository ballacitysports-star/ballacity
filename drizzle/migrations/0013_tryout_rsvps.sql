CREATE TABLE public.tryout_rsvps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.team_posts(id) ON DELETE CASCADE,
  team_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  registered_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','cancelled')),
  waiver_signature_id uuid REFERENCES public.team_waiver_signatures(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id)
);
CREATE INDEX tryout_rsvps_post_idx ON public.tryout_rsvps (post_id);
CREATE INDEX tryout_rsvps_user_idx ON public.tryout_rsvps (user_id);

GRANT SELECT ON public.tryout_rsvps TO authenticated;
GRANT ALL ON public.tryout_rsvps TO service_role;
ALTER TABLE public.tryout_rsvps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tryout_rsvps_read" ON public.tryout_rsvps FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR registered_by = auth.uid() OR public.is_team_manager(team_id, auth.uid()));

-- Published waiver for a tryout/camp, readable by any signed-in prospect.
CREATE OR REPLACE FUNCTION public.get_tryout_waiver(_post_id uuid)
RETURNS TABLE (id uuid, team_id text, version text, title text, content text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id, w.team_id, w.version, w.title, w.content
  FROM public.team_posts p
  JOIN public.team_waivers w ON w.team_id = p.team_id AND w.published
  WHERE p.id = _post_id AND p.kind IN ('tryout','clinic') AND p.hidden_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.rsvp_tryout(
  _post_id uuid,
  _on_behalf_of uuid DEFAULT NULL,
  _waiver_id uuid DEFAULT NULL,
  _attested boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _signer uuid := COALESCE(_on_behalf_of, auth.uid());
  _p public.team_posts;
  _w public.team_waivers;
  _sig uuid;
  _id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF _on_behalf_of IS NOT NULL AND NOT public.is_guardian_of(_me, _on_behalf_of) THEN
    RAISE EXCEPTION 'NOT_YOUR_GUARDIAN_LINK';
  END IF;

  SELECT * INTO _p FROM public.team_posts WHERE id = _post_id FOR UPDATE;
  IF _p.id IS NULL OR _p.hidden_at IS NOT NULL OR _p.kind NOT IN ('tryout','clinic') THEN
    RAISE EXCEPTION 'TRYOUT_NOT_FOUND';
  END IF;
  IF _p.event_date IS NOT NULL AND _p.event_date < now() THEN RAISE EXCEPTION 'TRYOUT_PASSED'; END IF;

  IF EXISTS (SELECT 1 FROM public.tryout_rsvps WHERE post_id = _post_id AND user_id = _signer AND status = 'registered') THEN
    RAISE EXCEPTION 'ALREADY_REGISTERED';
  END IF;
  IF _p.spots_max IS NOT NULL AND COALESCE(_p.spots_taken,0) >= _p.spots_max THEN
    RAISE EXCEPTION 'TRYOUT_FULL';
  END IF;

  SELECT * INTO _w FROM public.team_waivers WHERE team_id = _p.team_id AND published;
  IF _w.id IS NOT NULL THEN
    SELECT id INTO _sig FROM public.team_waiver_signatures WHERE waiver_id = _w.id AND signer_user_id = _signer;
    IF _sig IS NULL THEN
      IF _waiver_id IS DISTINCT FROM _w.id OR NOT _attested THEN
        RAISE EXCEPTION 'WAIVER_REQUIRED';
      END IF;
      INSERT INTO public.team_waiver_signatures (waiver_id, team_id, signer_user_id, signed_by, user_agent)
      VALUES (_w.id, _p.team_id, _signer,
        CASE WHEN _on_behalf_of IS NOT NULL THEN _me ELSE NULL END,
        CASE WHEN _on_behalf_of IS NOT NULL THEN 'guardian-on-behalf:tryout' ELSE 'tryout' END)
      RETURNING id INTO _sig;
    END IF;
  END IF;

  INSERT INTO public.tryout_rsvps (post_id, team_id, user_id, registered_by, status, waiver_signature_id)
  VALUES (_post_id, _p.team_id, _signer, _me, 'registered', _sig)
  ON CONFLICT (post_id, user_id) DO UPDATE
    SET status = 'registered', registered_by = EXCLUDED.registered_by,
        waiver_signature_id = EXCLUDED.waiver_signature_id, created_at = now()
  RETURNING id INTO _id;

  UPDATE public.team_posts SET spots_taken = COALESCE(spots_taken,0) + 1 WHERE id = _post_id;
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_tryout_rsvp(_post_id uuid, _on_behalf_of uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _signer uuid := COALESCE(_on_behalf_of, auth.uid());
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF _on_behalf_of IS NOT NULL AND NOT public.is_guardian_of(_me, _on_behalf_of) THEN
    RAISE EXCEPTION 'NOT_YOUR_GUARDIAN_LINK';
  END IF;
  UPDATE public.tryout_rsvps SET status = 'cancelled'
   WHERE post_id = _post_id AND user_id = _signer AND status = 'registered';
  IF FOUND THEN
    UPDATE public.team_posts SET spots_taken = GREATEST(COALESCE(spots_taken,0) - 1, 0) WHERE id = _post_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_tryout_waiver(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rsvp_tryout(uuid, uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_tryout_rsvp(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tryout_waiver(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rsvp_tryout(uuid, uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_tryout_rsvp(uuid, uuid) TO authenticated;