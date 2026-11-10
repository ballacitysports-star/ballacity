-- P2-3: team chat (owner decisions 2026-11-09). Design: docs/phase0-audit-and-implementation-plan.md (P2-3).
--
-- One chat per team. Its own table, so direct messages and their minor rules (enforce_minor_messaging,
-- minor_messaging_block) are untouched, and no side channel between an adult and a minor is opened.
--
-- 1. Who is in a team's chat (private_sec.team_chat_member), worked out live, so it follows the roster:
--      * an adult on the team (owner, manager, coach or player);
--      * a player aged 13 to 17 on the team ONLY if a parent or guardian is linked (active and verified) and the
--        child's messaging control allows teammates ('teammates' or 'peers'); 'off', 'guardian_only' (the default)
--        or no controls keep them out;
--      * an adult who is the linked guardian of any minor on the team (including under-13s, who take part only
--        through their guardian);
--      * nobody else: not an under-13, not an unknown age, not a stranger.
--    A hidden team (by a moderator) has no chat.
-- 2. team_chat_messages: text only (1 to 2000 characters). Written only through send_team_chat_message, which
--    checks membership, rate-limits (20 a minute) and stores the message 'pending'; the app screens the text
--    before it is sent (blocked text is never stored) and the service role then approves or holds it, as for posts.
--    Members read approved, unhidden messages; senders also see their own; staff (owner, manager, coach) also see
--    approved hidden ones so they can unhide them. Held messages go to the superadmin queue.
-- 3. hide_team_chat_message(id, hide): staff of the team hide or unhide a message.
-- 4. report_team_chat_message(id, reason, details): a member reports a message they can read; it goes to
--    user_reports (subject 'team_chat_message') for moderators.
-- 5. app_settings 'team_chat' = {"enabled": false}, public. Off until the owner turns it on.
--
-- Rollback: docs/rollbacks/20261109100000_team_chat.down.sql.

CREATE OR REPLACE FUNCTION private_sec.team_chat_member(_team text, _user uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _cohort text;
BEGIN
  IF _team IS NULL OR _user IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = _team AND t.moderator_hidden_at IS NULL) THEN
    RETURN false;
  END IF;
  _cohort := public.age_cohort_of(_user);
  IF public.is_team_member(_team, _user) THEN
    IF _cohort = 'adult' THEN RETURN true; END IF;
    IF _cohort IN ('teen_13_15', 'teen_16_17') THEN
      RETURN EXISTS (SELECT 1 FROM public.guardian_links g
                      WHERE g.child_user_id = _user AND g.status = 'active' AND g.verified_at IS NOT NULL)
         AND EXISTS (SELECT 1 FROM public.child_controls c
                      WHERE c.child_user_id = _user AND c.messaging IN ('teammates', 'peers'));
    END IF;
    RETURN false;
  END IF;
  IF _cohort = 'adult' AND EXISTS (
       SELECT 1 FROM public.team_members m
        WHERE m.team_id = _team AND m.user_id <> _user AND public.is_guardian_of(_user, m.user_id)) THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION private_sec.team_chat_member(text, uuid) FROM PUBLIC, anon, authenticated;

-- The read policy runs as the member, so it needs a check it may call. This one answers only for the caller, so it
-- cannot be used to learn whether someone else (a teen, say) is in a chat.
CREATE OR REPLACE FUNCTION private_sec.in_team_chat(_team text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND private_sec.team_chat_member(_team, auth.uid());
$$;
REVOKE ALL ON FUNCTION private_sec.in_team_chat(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.in_team_chat(text) TO authenticated;

-- Whether the caller is in this team's chat (for the app to show the tab).
CREATE OR REPLACE FUNCTION public.can_use_team_chat(_team text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private_sec.in_team_chat(_team);
$$;
REVOKE ALL ON FUNCTION public.can_use_team_chat(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_use_team_chat(text) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.team_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  moderation_status text NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending', 'approved', 'held')),
  hidden_at timestamptz,
  hidden_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_chat_messages_team_idx ON public.team_chat_messages (team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS team_chat_messages_sender_idx ON public.team_chat_messages (sender_id, created_at DESC);

ALTER TABLE public.team_chat_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_chat_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.team_chat_messages TO authenticated;
GRANT ALL ON public.team_chat_messages TO service_role;

DROP POLICY IF EXISTS team_chat_messages_read ON public.team_chat_messages;
CREATE POLICY team_chat_messages_read ON public.team_chat_messages FOR SELECT TO authenticated
  USING (
    private_sec.in_team_chat(team_id)
    AND (
      (moderation_status = 'approved' AND hidden_at IS NULL)
      OR sender_id = auth.uid()
      OR (moderation_status = 'approved' AND public.is_team_manager(team_id, auth.uid()))
    )
  );

CREATE OR REPLACE FUNCTION public.send_team_chat_message(_team text, _body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _me uuid := auth.uid();
  _id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF NOT private_sec.team_chat_member(_team, _me) THEN
    RAISE EXCEPTION 'NOT_IN_TEAM_CHAT' USING ERRCODE = '42501';
  END IF;
  IF _body IS NULL OR char_length(btrim(_body)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'INVALID_MESSAGE' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.team_chat_messages
       WHERE sender_id = _me AND created_at > now() - interval '1 minute') >= 20 THEN
    RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.team_chat_messages (team_id, sender_id, body, moderation_status)
  VALUES (_team, _me, btrim(_body), 'pending')
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.send_team_chat_message(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_team_chat_message(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.hide_team_chat_message(_message uuid, _hide boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _me uuid := auth.uid();
  _team text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT team_id INTO _team FROM public.team_chat_messages WHERE id = _message;
  IF _team IS NULL OR NOT public.is_team_manager(_team, _me) OR NOT private_sec.team_chat_member(_team, _me) THEN
    RAISE EXCEPTION 'NOT_TEAM_STAFF' USING ERRCODE = '42501';
  END IF;
  UPDATE public.team_chat_messages
     SET hidden_at = CASE WHEN _hide THEN now() ELSE NULL END,
         hidden_by = CASE WHEN _hide THEN _me ELSE NULL END
   WHERE id = _message;
END;
$$;
REVOKE ALL ON FUNCTION public.hide_team_chat_message(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hide_team_chat_message(uuid, boolean) TO authenticated, service_role;

ALTER TABLE public.user_reports ADD COLUMN IF NOT EXISTS team_chat_message_id uuid
  REFERENCES public.team_chat_messages(id) ON DELETE SET NULL;
ALTER TABLE public.user_reports DROP CONSTRAINT IF EXISTS user_reports_subject_type_check;
ALTER TABLE public.user_reports ADD CONSTRAINT user_reports_subject_type_check
  CHECK (subject_type IN ('user', 'game', 'message', 'reel', 'payment', 'team_chat_message'));

CREATE OR REPLACE FUNCTION public.report_team_chat_message(_message uuid, _reason text, _details text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _me uuid := auth.uid();
  _m public.team_chat_messages;
  _id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _m FROM public.team_chat_messages WHERE id = _message;
  IF _m.id IS NULL OR NOT private_sec.team_chat_member(_m.team_id, _me)
     OR NOT (_m.moderation_status = 'approved' OR _m.sender_id = _me) THEN
    RAISE EXCEPTION 'MESSAGE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF _m.sender_id = _me THEN RAISE EXCEPTION 'CANNOT_REPORT_SELF' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.user_reports (reporter_id, reported_id, reason, details, subject_type, team_chat_message_id)
  VALUES (_me, _m.sender_id, _reason, left(NULLIF(btrim(_details), ''), 1000), 'team_chat_message', _m.id)
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.report_team_chat_message(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_team_chat_message(uuid, text, text) TO authenticated, service_role;

INSERT INTO public.app_settings (key, value, description, is_public)
VALUES ('team_chat', '{"enabled": false}'::jsonb, 'Team chat (P2-3). Off until released.', true)
ON CONFLICT (key) DO NOTHING;
