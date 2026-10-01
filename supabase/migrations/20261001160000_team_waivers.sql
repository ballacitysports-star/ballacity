-- Per-team liability waivers, versioned and signed, mirroring
-- legal_documents/legal_consents' shape but team-scoped: those two are
-- global, fixed-document_type and have no team/game column at all, so a
-- team's own custom waiver content needs its own table pair rather than a
-- forced fit into either.

-- ============ team_waivers ============
CREATE TABLE public.team_waivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  version text NOT NULL CHECK (length(btrim(version)) BETWEEN 1 AND 64),
  title text NOT NULL DEFAULT 'Team Waiver',
  content text NOT NULL CHECK (length(btrim(content)) > 0),
  published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  archived_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, version)
);

-- Only one active (published) waiver per team — mirrors
-- legal_documents_one_published_per_type.
CREATE UNIQUE INDEX team_waivers_one_published_per_team
  ON public.team_waivers (team_id) WHERE published;
CREATE INDEX team_waivers_team_idx ON public.team_waivers (team_id);

GRANT SELECT, INSERT, UPDATE ON public.team_waivers TO authenticated;
GRANT ALL ON public.team_waivers TO service_role;
ALTER TABLE public.team_waivers ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER team_waivers_updated_at BEFORE UPDATE ON public.team_waivers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE POLICY "team_waivers_read" ON public.team_waivers FOR SELECT TO authenticated
  USING (
    (published AND public.is_team_member(team_id, auth.uid()))
    OR public.is_team_manager(team_id, auth.uid())
  );

CREATE POLICY "team_waivers_manager_insert" ON public.team_waivers FOR INSERT TO authenticated
  WITH CHECK (
    public.is_team_manager(team_id, auth.uid())
    AND published = false
    AND created_by = auth.uid()
  );

CREATE POLICY "team_waivers_manager_update" ON public.team_waivers FOR UPDATE TO authenticated
  USING (public.is_team_manager(team_id, auth.uid()))
  WITH CHECK (public.is_team_manager(team_id, auth.uid()));

CREATE POLICY "team_waivers_manager_delete_draft" ON public.team_waivers FOR DELETE TO authenticated
  USING (public.is_team_manager(team_id, auth.uid()) AND published_at IS NULL);

-- Immutable once published — same rule as legal_documents_guard().
CREATE OR REPLACE FUNCTION public.team_waivers_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    IF NEW.content <> OLD.content OR NEW.version <> OLD.version OR NEW.title <> OLD.title
       OR NEW.team_id <> OLD.team_id THEN
      RAISE EXCEPTION 'Published waiver versions are immutable; create a new version instead';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER team_waivers_guard_trg
BEFORE UPDATE ON public.team_waivers
FOR EACH ROW EXECUTE FUNCTION public.team_waivers_guard();

-- ============ team_waiver_signatures ============
CREATE TABLE public.team_waiver_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  waiver_id uuid NOT NULL REFERENCES public.team_waivers(id) ON DELETE CASCADE,
  team_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  signer_user_id uuid NOT NULL,
  -- NULL = signed for themself; otherwise the guardian who signed on this
  -- minor's behalf — mirrors legal_consents.accepted_by exactly.
  signed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (waiver_id, signer_user_id)
);
CREATE INDEX team_waiver_signatures_team_idx ON public.team_waiver_signatures (team_id);
CREATE INDEX team_waiver_signatures_signer_idx ON public.team_waiver_signatures (signer_user_id);

GRANT SELECT, INSERT ON public.team_waiver_signatures TO authenticated;
GRANT ALL ON public.team_waiver_signatures TO service_role;
ALTER TABLE public.team_waiver_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_waiver_signatures_read" ON public.team_waiver_signatures FOR SELECT TO authenticated
  USING (
    signer_user_id = auth.uid()
    OR signed_by = auth.uid()
    OR public.is_team_manager(team_id, auth.uid())
  );

-- Written only via sign_team_waiver() — same shape as team_invites' own
-- "no direct insert" policy.
CREATE POLICY "team_waiver_signatures_no_direct_insert" ON public.team_waiver_signatures FOR INSERT TO authenticated
  WITH CHECK (false);

-- ============ publish / sign RPCs ============
CREATE OR REPLACE FUNCTION public.publish_team_waiver(_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _w public.team_waivers;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _w FROM public.team_waivers WHERE id = _id;
  IF _w.id IS NULL THEN RAISE EXCEPTION 'WAIVER_NOT_FOUND'; END IF;
  IF NOT public.is_team_manager(_w.team_id, auth.uid()) THEN RAISE EXCEPTION 'NOT_TEAM_MANAGER'; END IF;
  IF _w.published THEN RETURN _w.id; END IF;
  IF length(btrim(_w.content)) = 0 THEN RAISE EXCEPTION 'EMPTY_WAIVER'; END IF;

  UPDATE public.team_waivers
     SET published = false, archived_at = now()
   WHERE team_id = _w.team_id AND published AND id <> _id;

  UPDATE public.team_waivers
     SET published = true, archived_at = NULL, published_at = COALESCE(published_at, now())
   WHERE id = _id;

  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sign_team_waiver(
  _team_id text,
  _waiver_id uuid,
  _on_behalf_of uuid DEFAULT NULL,
  _attested boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _signer uuid := COALESCE(_on_behalf_of, auth.uid());
  _id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  IF _on_behalf_of IS NOT NULL THEN
    IF NOT public.is_guardian_of(_me, _on_behalf_of) THEN RAISE EXCEPTION 'NOT_YOUR_GUARDIAN_LINK'; END IF;
    IF NOT _attested THEN
      RAISE EXCEPTION 'ATTESTATION_REQUIRED: confirm you are signing on this child''s behalf.';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.team_waivers
    WHERE id = _waiver_id AND team_id = _team_id AND published
  ) THEN
    RAISE EXCEPTION 'WAIVER_NOT_PUBLISHED';
  END IF;

  IF NOT (
    public.is_team_member(_team_id, _signer)
    OR EXISTS (
      SELECT 1 FROM public.team_invites
      WHERE team_id = _team_id AND invitee_id = _signer AND status = 'pending'
    )
  ) THEN
    RAISE EXCEPTION 'NOT_TEAM_MEMBER_OR_INVITEE';
  END IF;

  -- signed_by is who actually performed the action (mirrors
  -- legal_consents.accepted_by) -- the guardian, never the child.
  INSERT INTO public.team_waiver_signatures (waiver_id, team_id, signer_user_id, signed_by, user_agent)
  VALUES (
    _waiver_id, _team_id, _signer,
    CASE WHEN _on_behalf_of IS NOT NULL THEN _me ELSE NULL END,
    CASE WHEN _on_behalf_of IS NOT NULL THEN 'guardian-on-behalf' ELSE NULL END
  )
  ON CONFLICT (waiver_id, signer_user_id) DO NOTHING
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_team_waiver(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sign_team_waiver(text, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_team_waiver(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sign_team_waiver(text, uuid, uuid, boolean) TO authenticated;
