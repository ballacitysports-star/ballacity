-- Content Studio: submitted sources, AI drafts, approval-first publishing to the
-- official BallaCity Facebook Page.
--
-- Additive only. No existing table, policy, trigger or function is altered.
--
-- Who may do what (enforced here, not in the UI):
--   * Staff (public.is_moderator: admin, moderator, superadmin) read everything in
--     this file except page tokens, submit sources and write drafts.
--   * Only a superadmin approves, rejects or cancels a draft, and only a superadmin
--     starts a publish.
--   * Publish results are recorded by the server (service_role) only.
--   * Page access tokens are readable by service_role only. No policy exists for
--     anon or authenticated on social_page_tokens, and EXECUTE on nothing here
--     returns a token.
--
-- Approval is bound to content. content_approvals stores an immutable snapshot of
-- exactly what was approved plus its sha256. Any edit to the publishable fields of
-- a draft bumps its version and, if it was approved, sends it back to 'draft' and
-- clears the approval (guard_content_draft_update). begin_content_publish then
-- re-hashes the live draft and refuses if it no longer matches the approval, so a
-- post can only go out exactly as a human approved it.
--
-- Status transitions that matter (approved, publishing, published, failed) can
-- only happen inside the routines below, which open the transaction-local flag
-- app.content_studio. The pattern is the one guard_listing_owner_change uses.
--
-- Rollback: every object here is new. To remove, drop in reverse order:
--   the functions, then content_publish_attempts, content_approvals (after
--   clearing content_drafts.approval_id), content_drafts, content_sources,
--   social_oauth_states, social_page_tokens, social_page_connections.
--   No existing data depends on them.

-- ============ 1. sources: submitted links and discovery records ============

CREATE TABLE public.content_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL CHECK (length(url) BETWEEN 8 AND 2048),
  -- The canonical form the server computes (lower-case host, no tracking params,
  -- no fragment). Unique, so the same post submitted twice is one record.
  normalized_url text NOT NULL CHECK (length(normalized_url) BETWEEN 8 AND 2048),
  url_host text NOT NULL CHECK (length(url_host) BETWEEN 1 AND 253),
  platform text NOT NULL CHECK (platform IN ('facebook', 'instagram', 'web')),
  source_kind text NOT NULL DEFAULT 'other'
    CHECK (source_kind IN ('post', 'page', 'event', 'group', 'video', 'other')),
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'needs_details', 'reviewed', 'dismissed')),
  opportunity text CHECK (opportunity IN ('content_only', 'listing_candidate')),

  -- Details. Nothing here is read from Facebook: there is no authorized read
  -- integration, so a person types them (or accepts an AI suggestion), and
  -- details_verified records which ones a person has actually confirmed.
  title text CHECK (length(title) <= 200),
  summary text CHECK (length(summary) <= 2000),
  sport text CHECK (length(sport) <= 60),
  city text CHECK (length(city) <= 120),
  location text CHECK (length(location) <= 300),
  event_starts_at timestamptz,
  age_group text CHECK (length(age_group) <= 60),
  listing_kind text CHECK (listing_kind IN
    ('pickup_game', 'team', 'tryout', 'coach', 'gym', 'league', 'tournament', 'event')),
  org_name text CHECK (length(org_name) <= 200),
  details_verified jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_confidence numeric(3,2) CHECK (ai_confidence BETWEEN 0 AND 1),

  -- Set when the source has been turned into (or matched to) a BallaCity listing.
  linked_subject_type text CHECK (linked_subject_type IN ('team', 'gym')),
  linked_subject_id text CHECK (length(linked_subject_id) <= 200),
  CHECK ((linked_subject_type IS NULL) = (linked_subject_id IS NULL)),

  -- Internal only; never shown to claimants or listing managers.
  notes text CHECK (length(notes) <= 2000),

  submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX content_sources_normalized_url_key ON public.content_sources (normalized_url);
CREATE INDEX content_sources_queue_idx ON public.content_sources (status, created_at DESC);
CREATE INDEX content_sources_linked_idx
  ON public.content_sources (linked_subject_type, linked_subject_id)
  WHERE linked_subject_type IS NOT NULL;

CREATE TRIGGER content_sources_touch_updated_at
  BEFORE UPDATE ON public.content_sources
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ 2. drafts ============

CREATE TABLE public.content_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES public.content_sources(id) ON DELETE SET NULL,
  subject_type text CHECK (subject_type IN ('team', 'gym')),
  subject_id text CHECK (length(subject_id) <= 200),
  CHECK ((subject_type IS NULL) = (subject_id IS NULL)),

  channel text NOT NULL DEFAULT 'facebook_page' CHECK (channel IN ('facebook_page')),
  kind text NOT NULL DEFAULT 'announcement' CHECK (kind IN
    ('announcement', 'pickup_game', 'team', 'tryout', 'coach', 'gym', 'event',
     'recruitment', 'reel_concept')),

  -- The publishable fields. Editing any of them invalidates an approval.
  message text NOT NULL CHECK (length(btrim(message)) BETWEEN 1 AND 5000),
  link_url text CHECK (length(link_url) <= 2048),
  hashtags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(hashtags) <= 10),

  -- Not published. Facts the draft relies on and whether a person verified each:
  -- [{"claim": text, "status": "verified"|"unverified"|"suggested"}].
  facts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(facts) = 'array'),
  source_attribution text CHECK (length(source_attribution) <= 500),
  ai_generated boolean NOT NULL DEFAULT false,

  status text NOT NULL DEFAULT 'draft' CHECK (status IN
    ('draft', 'in_review', 'approved', 'publishing', 'published', 'failed',
     'rejected', 'canceled')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  approval_id uuid,
  rejection_reason text CHECK (length(rejection_reason) <= 500),

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX content_drafts_status_idx ON public.content_drafts (status, updated_at DESC);
CREATE INDEX content_drafts_source_idx ON public.content_drafts (source_id) WHERE source_id IS NOT NULL;

-- ============ 3. approvals: what exactly a person approved ============

CREATE TABLE public.content_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES public.content_drafts(id) ON DELETE CASCADE,
  draft_version integer NOT NULL,
  destination_page_id text NOT NULL CHECK (length(destination_page_id) BETWEEN 1 AND 64),
  payload jsonb NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX content_approvals_draft_idx ON public.content_approvals (draft_id, approved_at DESC);

ALTER TABLE public.content_drafts
  ADD CONSTRAINT content_drafts_approval_fk
  FOREIGN KEY (approval_id) REFERENCES public.content_approvals(id) ON DELETE SET NULL;

-- An approval is a record of a decision; it is never edited.
CREATE OR REPLACE FUNCTION public.guard_content_approval_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'APPROVAL_IMMUTABLE';
END $$;

CREATE TRIGGER content_approvals_immutable
  BEFORE UPDATE ON public.content_approvals
  FOR EACH ROW EXECUTE FUNCTION public.guard_content_approval_immutable();

-- ============ 4. publish attempts ============

CREATE TABLE public.content_publish_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES public.content_drafts(id) ON DELETE CASCADE,
  approval_id uuid NOT NULL REFERENCES public.content_approvals(id) ON DELETE CASCADE,
  -- Chosen by the caller and reused on retry, so a double click or a retried
  -- request reaches the same attempt instead of a second post.
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  destination_page_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  external_post_id text CHECK (length(external_post_id) <= 200),
  error_code text CHECK (length(error_code) <= 100),
  error_message text CHECK (length(error_message) <= 1000),
  started_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE UNIQUE INDEX content_publish_attempts_idempotency_key ON public.content_publish_attempts (idempotency_key);
-- At most one post per approval ever succeeds, and one attempt per draft runs at a time.
CREATE UNIQUE INDEX content_publish_one_success_per_approval
  ON public.content_publish_attempts (approval_id) WHERE status = 'succeeded';
CREATE UNIQUE INDEX content_publish_one_pending_per_draft
  ON public.content_publish_attempts (draft_id) WHERE status = 'pending';

-- ============ 5. the destination Page ============

-- Public metadata about the connected Page. The token lives in social_page_tokens.
CREATE TABLE public.social_page_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'facebook' CHECK (provider IN ('facebook')),
  page_id text NOT NULL CHECK (page_id ~ '^[0-9]{1,30}$'),
  page_name text NOT NULL CHECK (length(page_name) BETWEEN 1 AND 200),
  -- The one Page posts go to. Set by a superadmin, never inferred.
  is_destination boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'error')),
  granted_scopes text[] NOT NULL DEFAULT '{}',
  last_error text CHECK (length(last_error) <= 500),
  connected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz,
  UNIQUE (provider, page_id)
);

CREATE UNIQUE INDEX social_page_connections_one_destination
  ON public.social_page_connections (provider) WHERE is_destination;

-- Encrypted by the server before it is stored (AES-256-GCM, key in the server
-- environment), so a leaked row is not a usable token on its own.
CREATE TABLE public.social_page_tokens (
  connection_id uuid PRIMARY KEY REFERENCES public.social_page_connections(id) ON DELETE CASCADE,
  token_ciphertext text NOT NULL,
  token_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- OAuth `state` values, so a callback is only accepted for a flow a superadmin started.
CREATE TABLE public.social_oauth_states (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  used_at timestamptz
);

-- ============ 6. access ============

ALTER TABLE public.content_sources          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_drafts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_approvals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_publish_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_page_connections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_page_tokens       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_oauth_states      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.content_sources, public.content_drafts, public.content_approvals,
  public.content_publish_attempts, public.social_page_connections,
  public.social_page_tokens, public.social_oauth_states FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.content_sources, public.content_drafts, public.content_approvals,
  public.content_publish_attempts, public.social_page_connections,
  public.social_page_tokens, public.social_oauth_states TO service_role;

-- Staff read the studio. All writes go through the server or the routines below.
GRANT SELECT ON public.content_sources, public.content_drafts, public.content_approvals,
  public.content_publish_attempts, public.social_page_connections TO authenticated;

CREATE POLICY "staff read content sources" ON public.content_sources
  FOR SELECT TO authenticated USING (public.is_moderator(auth.uid()));
CREATE POLICY "staff read content drafts" ON public.content_drafts
  FOR SELECT TO authenticated USING (public.is_moderator(auth.uid()));
CREATE POLICY "staff read content approvals" ON public.content_approvals
  FOR SELECT TO authenticated USING (public.is_moderator(auth.uid()));
CREATE POLICY "staff read publish attempts" ON public.content_publish_attempts
  FOR SELECT TO authenticated USING (public.is_moderator(auth.uid()));
CREATE POLICY "staff read page connections" ON public.social_page_connections
  FOR SELECT TO authenticated USING (public.is_moderator(auth.uid()));
-- social_page_tokens and social_oauth_states: no policies, no grants. service_role only.

-- ============ 7. the draft guard ============

-- The payload a human approves, in one canonical form, so the same content always
-- hashes the same way. jsonb normalises key order.
CREATE OR REPLACE FUNCTION public.content_draft_payload(_d public.content_drafts, _page text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'channel', _d.channel,
    'destination_page_id', _page,
    'message', _d.message,
    'link_url', _d.link_url,
    'hashtags', to_jsonb(_d.hashtags)
  );
$$;

CREATE OR REPLACE FUNCTION public.content_payload_hash(_payload jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT encode(sha256(convert_to(_payload::text, 'UTF8')), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.guard_content_draft_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _privileged boolean := coalesce(current_setting('app.content_studio', true), '') = 'on';
  _content_changed boolean :=
    NEW.message IS DISTINCT FROM OLD.message
    OR NEW.link_url IS DISTINCT FROM OLD.link_url
    OR NEW.hashtags IS DISTINCT FROM OLD.hashtags
    OR NEW.channel IS DISTINCT FROM OLD.channel;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A draft is born a draft: nobody inserts one already approved or published.
    IF NEW.status NOT IN ('draft', 'in_review') OR NEW.approval_id IS NOT NULL THEN
      RAISE EXCEPTION 'DRAFT_STATUS_SET_BY_WORKFLOW_ONLY';
    END IF;
    NEW.version := 1;
    RETURN NEW;
  END IF;

  IF NEW.version IS DISTINCT FROM OLD.version AND NOT _privileged THEN
    NEW.version := OLD.version;
  END IF;

  IF _content_changed THEN
    IF OLD.status IN ('publishing', 'published') THEN
      RAISE EXCEPTION 'DRAFT_LOCKED';
    END IF;
    NEW.version := OLD.version + 1;
    -- Editing what was approved withdraws the approval. It must be reviewed again.
    -- A failed publish still carries its approval (for a retry), so it counts too.
    IF OLD.status IN ('approved', 'failed') THEN
      NEW.status := 'draft';
      NEW.approval_id := NULL;
    END IF;
  END IF;

  -- Only the workflow routines may move a draft into or out of the states that
  -- gate publishing, or attach an approval.
  IF NOT _privileged THEN
    IF NEW.approval_id IS DISTINCT FROM OLD.approval_id AND NEW.approval_id IS NOT NULL THEN
      RAISE EXCEPTION 'DRAFT_STATUS_SET_BY_WORKFLOW_ONLY';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status IN ('approved', 'publishing', 'published', 'failed', 'rejected')
         OR OLD.status IN ('publishing', 'published') THEN
        -- The approved/failed -> draft step above is the one transition an edit may cause.
        IF NOT (_content_changed AND OLD.status IN ('approved', 'failed') AND NEW.status = 'draft') THEN
          RAISE EXCEPTION 'DRAFT_STATUS_SET_BY_WORKFLOW_ONLY';
        END IF;
      END IF;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER content_drafts_guard
  BEFORE INSERT OR UPDATE ON public.content_drafts
  FOR EACH ROW EXECUTE FUNCTION public.guard_content_draft_update();

-- ============ 8. workflow routines ============

-- Approve the version the reviewer saw. _expected_version stops a reviewer from
-- approving text that changed after they loaded it.
CREATE OR REPLACE FUNCTION public.approve_content_draft(_draft uuid, _expected_version integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _d public.content_drafts%ROWTYPE;
  _page text;
  _payload jsonb;
  _approval uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF NOT public.is_superadmin(_me) THEN RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501'; END IF;

  SELECT * INTO _d FROM public.content_drafts WHERE id = _draft FOR UPDATE;
  IF _d.id IS NULL THEN RAISE EXCEPTION 'DRAFT_NOT_FOUND'; END IF;
  IF _d.status NOT IN ('draft', 'in_review', 'failed') THEN RAISE EXCEPTION 'DRAFT_NOT_APPROVABLE'; END IF;
  IF _d.version <> _expected_version THEN RAISE EXCEPTION 'DRAFT_CHANGED'; END IF;

  SELECT page_id INTO _page FROM public.social_page_connections
    WHERE provider = 'facebook' AND is_destination AND status = 'active';
  IF _page IS NULL THEN RAISE EXCEPTION 'NO_DESTINATION_PAGE'; END IF;

  _payload := public.content_draft_payload(_d, _page);
  INSERT INTO public.content_approvals
    (draft_id, draft_version, destination_page_id, payload, payload_hash, approved_by)
  VALUES (_d.id, _d.version, _page, _payload, public.content_payload_hash(_payload), _me)
  RETURNING id INTO _approval;

  PERFORM set_config('app.content_studio', 'on', true);
  UPDATE public.content_drafts
    SET status = 'approved', approval_id = _approval, rejection_reason = NULL, updated_by = _me
    WHERE id = _d.id;

  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, after)
  VALUES (_me, 'content.draft_approved', 'content_draft', _d.id::text,
          jsonb_build_object('version', _d.version, 'approval_id', _approval, 'page_id', _page));
  RETURN _approval;
END $$;

CREATE OR REPLACE FUNCTION public.reject_content_draft(_draft uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid(); _d public.content_drafts%ROWTYPE;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF NOT public.is_superadmin(_me) THEN RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501'; END IF;

  SELECT * INTO _d FROM public.content_drafts WHERE id = _draft FOR UPDATE;
  IF _d.id IS NULL THEN RAISE EXCEPTION 'DRAFT_NOT_FOUND'; END IF;
  IF _d.status NOT IN ('draft', 'in_review', 'approved', 'failed') THEN RAISE EXCEPTION 'DRAFT_NOT_REJECTABLE'; END IF;

  PERFORM set_config('app.content_studio', 'on', true);
  UPDATE public.content_drafts
    SET status = 'rejected', approval_id = NULL,
        rejection_reason = NULLIF(btrim(COALESCE(_reason, '')), ''), updated_by = _me
    WHERE id = _d.id;

  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason)
  VALUES (_me, 'content.draft_rejected', 'content_draft', _d.id::text,
          left(NULLIF(btrim(COALESCE(_reason, '')), ''), 1000));
END $$;

-- Claims the publish for one approved draft. Returns the attempt to use: a retry
-- with the same key gets the same attempt back, never a second post. `created` is
-- true only for the call that made the attempt; only that caller may contact Meta,
-- so a duplicate request arriving mid-publish waits for the first one's result.
CREATE OR REPLACE FUNCTION public.begin_content_publish(_draft uuid, _idempotency_key text)
RETURNS TABLE (attempt_id uuid, attempt_status text, created boolean, approval_id uuid,
               destination_page_id text, payload jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- The output columns share names with table columns read below; a bare name in a
-- query here always means the table column.
#variable_conflict use_column
DECLARE
  _me uuid := auth.uid();
  _d public.content_drafts%ROWTYPE;
  _a public.content_approvals%ROWTYPE;
  _existing public.content_publish_attempts%ROWTYPE;
  _attempt uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF NOT public.is_superadmin(_me) THEN RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501'; END IF;
  IF _idempotency_key IS NULL OR length(_idempotency_key) NOT BETWEEN 8 AND 100 THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_INVALID';
  END IF;

  SELECT * INTO _existing FROM public.content_publish_attempts WHERE idempotency_key = _idempotency_key;
  IF _existing.id IS NOT NULL THEN
    IF _existing.draft_id <> _draft THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'; END IF;
    SELECT * INTO _a FROM public.content_approvals WHERE id = _existing.approval_id;
    RETURN QUERY SELECT _existing.id, _existing.status, false, _a.id, _a.destination_page_id, _a.payload;
    RETURN;
  END IF;

  SELECT * INTO _d FROM public.content_drafts WHERE id = _draft FOR UPDATE;
  IF _d.id IS NULL THEN RAISE EXCEPTION 'DRAFT_NOT_FOUND'; END IF;
  -- 'failed' is a retry of the same approval; an edit would have cleared it.
  IF _d.status NOT IN ('approved', 'failed') OR _d.approval_id IS NULL THEN
    RAISE EXCEPTION 'DRAFT_NOT_APPROVED';
  END IF;

  SELECT * INTO _a FROM public.content_approvals WHERE id = _d.approval_id;
  -- The live draft must still be exactly what was approved, for the Page that is
  -- the destination now.
  IF _a.draft_version <> _d.version
     OR _a.payload_hash <> public.content_payload_hash(public.content_draft_payload(_d, _a.destination_page_id)) THEN
    RAISE EXCEPTION 'APPROVAL_STALE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.social_page_connections
                 WHERE provider = 'facebook' AND page_id = _a.destination_page_id
                   AND is_destination AND status = 'active') THEN
    RAISE EXCEPTION 'DESTINATION_CHANGED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.content_publish_attempts
             WHERE approval_id = _a.id AND status = 'succeeded') THEN
    RAISE EXCEPTION 'ALREADY_PUBLISHED';
  END IF;

  BEGIN
    INSERT INTO public.content_publish_attempts
      (draft_id, approval_id, idempotency_key, destination_page_id, started_by)
    VALUES (_d.id, _a.id, _idempotency_key, _a.destination_page_id, _me)
    RETURNING id INTO _attempt;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'PUBLISH_IN_PROGRESS';
  END;

  PERFORM set_config('app.content_studio', 'on', true);
  UPDATE public.content_drafts SET status = 'publishing', updated_by = _me WHERE id = _d.id;

  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, after)
  VALUES (_me, 'content.publish_started', 'content_draft', _d.id::text,
          jsonb_build_object('attempt_id', _attempt, 'approval_id', _a.id,
                             'page_id', _a.destination_page_id));

  RETURN QUERY SELECT _attempt, 'pending'::text, true, _a.id, _a.destination_page_id, _a.payload;
END $$;

-- Recorded by the server after the Graph API answers. A failure leaves the draft
-- approved-but-failed, so it can be retried with a new key without a re-review.
CREATE OR REPLACE FUNCTION public.finish_content_publish(
  _attempt uuid, _succeeded boolean, _external_post_id text, _error_code text, _error_message text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t public.content_publish_attempts%ROWTYPE;
BEGIN
  SELECT * INTO _t FROM public.content_publish_attempts WHERE id = _attempt FOR UPDATE;
  IF _t.id IS NULL THEN RAISE EXCEPTION 'ATTEMPT_NOT_FOUND'; END IF;
  IF _t.status <> 'pending' THEN RAISE EXCEPTION 'ATTEMPT_FINISHED'; END IF;
  IF _succeeded AND btrim(COALESCE(_external_post_id, '')) = '' THEN
    -- "Published" is only ever recorded with the post id Meta returned.
    RAISE EXCEPTION 'EXTERNAL_ID_REQUIRED';
  END IF;

  UPDATE public.content_publish_attempts
    SET status = CASE WHEN _succeeded THEN 'succeeded' ELSE 'failed' END,
        external_post_id = CASE WHEN _succeeded THEN left(_external_post_id, 200) END,
        error_code = CASE WHEN _succeeded THEN NULL ELSE left(_error_code, 100) END,
        error_message = CASE WHEN _succeeded THEN NULL ELSE left(_error_message, 1000) END,
        finished_at = now()
    WHERE id = _attempt;

  -- A failed attempt keeps its approval: retrying sends the same approved content,
  -- and begin_content_publish accepts 'failed' for exactly that.
  PERFORM set_config('app.content_studio', 'on', true);
  UPDATE public.content_drafts
    SET status = CASE WHEN _succeeded THEN 'published' ELSE 'failed' END
    WHERE id = _t.draft_id;

  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, after)
  VALUES (_t.started_by,
          CASE WHEN _succeeded THEN 'content.published' ELSE 'content.publish_failed' END,
          'content_draft', _t.draft_id::text,
          jsonb_build_object('attempt_id', _t.id, 'external_post_id', _external_post_id,
                             'error_code', _error_code));
END $$;

-- Picks the Page posts go to. Only an already-connected, active Page qualifies.
CREATE OR REPLACE FUNCTION public.set_content_destination_page(_connection uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid(); _c public.social_page_connections%ROWTYPE;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF NOT public.is_superadmin(_me) THEN RAISE EXCEPTION 'NOT_SUPERADMIN' USING ERRCODE = '42501'; END IF;

  SELECT * INTO _c FROM public.social_page_connections WHERE id = _connection FOR UPDATE;
  IF _c.id IS NULL THEN RAISE EXCEPTION 'CONNECTION_NOT_FOUND'; END IF;
  IF _c.status <> 'active' THEN RAISE EXCEPTION 'CONNECTION_NOT_ACTIVE'; END IF;

  UPDATE public.social_page_connections SET is_destination = false
    WHERE provider = _c.provider AND is_destination AND id <> _c.id;
  UPDATE public.social_page_connections SET is_destination = true WHERE id = _c.id;

  -- Approvals name a Page. Moving the destination makes every outstanding approval
  -- stale (begin_content_publish refuses them), so say so in the trail.
  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, after)
  VALUES (_me, 'content.destination_set', 'social_page', _c.page_id,
          jsonb_build_object('page_name', _c.page_name));
END $$;

REVOKE EXECUTE ON FUNCTION public.content_draft_payload(public.content_drafts, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.content_payload_hash(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_content_draft_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_content_approval_immutable() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.approve_content_draft(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_content_draft(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.begin_content_publish(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_content_destination_page(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_content_draft(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_content_draft(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.begin_content_publish(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_content_destination_page(uuid) TO authenticated;

-- Only the server records what Meta answered.
REVOKE EXECUTE ON FUNCTION public.finish_content_publish(uuid, boolean, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_content_publish(uuid, boolean, text, text, text) TO service_role;
