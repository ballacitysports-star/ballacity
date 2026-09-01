-- 1. Helpers -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_moderator(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('admin','moderator','superadmin')
  );
$$;
REVOKE ALL ON FUNCTION public.is_moderator(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_moderator(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_moderator(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.blocks_exist_between(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = _a AND blocked_id = _b)
       OR (blocker_id = _b AND blocked_id = _a)
  );
$$;
REVOKE ALL ON FUNCTION public.blocks_exist_between(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.blocks_exist_between(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.blocks_exist_between(uuid, uuid) TO authenticated, service_role;

-- 2. Reports table ----------------------------------------------------------
ALTER TABLE public.user_reports
  ADD COLUMN IF NOT EXISTS subject_type text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS game_id text,
  ADD COLUMN IF NOT EXISTS conversation_id uuid,
  ADD COLUMN IF NOT EXISTS message_id uuid,
  ADD COLUMN IF NOT EXISTS reel_id uuid,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_notes text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.user_reports DROP CONSTRAINT IF EXISTS user_reports_reason_check;
ALTER TABLE public.user_reports ADD CONSTRAINT user_reports_reason_check CHECK (reason = ANY (ARRAY[
  'spam','harassment','inappropriate','impersonation','safety','other',
  'threats','fake_account','scam','unsafe_behavior','minor_safety',
  'fake_game','unsafe_location','misleading','illegal'
]));

ALTER TABLE public.user_reports DROP CONSTRAINT IF EXISTS user_reports_status_check;
ALTER TABLE public.user_reports ADD CONSTRAINT user_reports_status_check CHECK (status = ANY (ARRAY[
  'new','investigating','resolved','dismissed','escalated',
  'pending','reviewing','actioned','open'
]));

ALTER TABLE public.user_reports DROP CONSTRAINT IF EXISTS user_reports_subject_type_check;
ALTER TABLE public.user_reports ADD CONSTRAINT user_reports_subject_type_check
  CHECK (subject_type = ANY (ARRAY['user','game','message','reel']));

DROP TRIGGER IF EXISTS user_reports_touch_updated_at ON public.user_reports;
CREATE TRIGGER user_reports_touch_updated_at BEFORE UPDATE ON public.user_reports
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS user_reports_status_idx ON public.user_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS user_reports_reported_idx ON public.user_reports (reported_id);

DROP POLICY IF EXISTS "Admins read all reports" ON public.user_reports;
CREATE POLICY "Moderators read all reports" ON public.user_reports
  FOR SELECT TO authenticated USING (public.is_moderator(auth.uid()));
DROP POLICY IF EXISTS "Moderators update reports" ON public.user_reports;
CREATE POLICY "Moderators update reports" ON public.user_reports
  FOR UPDATE TO authenticated USING (public.is_moderator(auth.uid()))
  WITH CHECK (public.is_moderator(auth.uid()));

-- 3. Profile moderation state ------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS moderation_state text NOT NULL DEFAULT 'active';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_moderation_state_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_moderation_state_check
  CHECK (moderation_state = ANY (ARRAY['active','warned','suspended','banned']));

-- 4. Audit log visibility for moderators ------------------------------------
DROP POLICY IF EXISTS "Moderators read audit log" ON public.admin_audit_log;
CREATE POLICY "Moderators read audit log" ON public.admin_audit_log
  FOR SELECT TO authenticated USING (public.is_moderator(auth.uid()));

-- 5. Server-side block enforcement ------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_block_on_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = NEW.conversation_id
      AND cp.user_id <> NEW.sender_id
      AND public.blocks_exist_between(cp.user_id, NEW.sender_id)
  ) THEN
    RAISE EXCEPTION 'Messaging is unavailable because one of you blocked the other';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS messages_block_guard ON public.messages;
CREATE TRIGGER messages_block_guard BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_block_on_message();

CREATE OR REPLACE FUNCTION public.enforce_block_on_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.blocks_exist_between(NEW.from_user_id, NEW.to_user_id) THEN
    RAISE EXCEPTION 'This request cannot be sent because one of you blocked the other';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS availability_contact_block_guard ON public.availability_contact_requests;
CREATE TRIGGER availability_contact_block_guard BEFORE INSERT ON public.availability_contact_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_block_on_request();
DROP TRIGGER IF EXISTS trainer_session_block_guard ON public.trainer_session_requests;
CREATE TRIGGER trainer_session_block_guard BEFORE INSERT ON public.trainer_session_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_block_on_request();

REVOKE ALL ON FUNCTION public.enforce_block_on_message() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_block_on_request() FROM PUBLIC;