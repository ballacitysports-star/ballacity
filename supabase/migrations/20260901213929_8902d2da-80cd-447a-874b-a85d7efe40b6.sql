CREATE TABLE public.game_safety_acknowledgments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id text NOT NULL,
  kind text NOT NULL,
  version text NOT NULL,
  user_agent text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_safety_ack_kind_check CHECK (kind = ANY (ARRAY['participant_risk'::text, 'host_responsibility'::text])),
  CONSTRAINT game_safety_ack_version_len_check CHECK (char_length(version) <= 64),
  CONSTRAINT game_safety_ack_game_len_check CHECK (char_length(game_id) BETWEEN 1 AND 120),
  CONSTRAINT game_safety_ack_unique UNIQUE (user_id, game_id, kind, version)
);

CREATE INDEX idx_game_safety_ack_user ON public.game_safety_acknowledgments (user_id, kind);
CREATE INDEX idx_game_safety_ack_game ON public.game_safety_acknowledgments (game_id);

GRANT SELECT, INSERT ON public.game_safety_acknowledgments TO authenticated;
GRANT ALL ON public.game_safety_acknowledgments TO service_role;

ALTER TABLE public.game_safety_acknowledgments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users record own safety acknowledgments"
  ON public.game_safety_acknowledgments FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users view own safety acknowledgments"
  ON public.game_safety_acknowledgments FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Moderators view all safety acknowledgments"
  ON public.game_safety_acknowledgments FOR SELECT TO authenticated
  USING (public.is_moderator(auth.uid()));

ALTER TABLE public.user_reports DROP CONSTRAINT IF EXISTS user_reports_reason_check;
ALTER TABLE public.user_reports ADD CONSTRAINT user_reports_reason_check CHECK (
  reason = ANY (ARRAY[
    'spam'::text, 'harassment'::text, 'inappropriate'::text, 'impersonation'::text,
    'safety'::text, 'other'::text, 'threats'::text, 'fake_account'::text, 'scam'::text,
    'unsafe_behavior'::text, 'minor_safety'::text, 'fake_game'::text, 'unsafe_location'::text,
    'misleading'::text, 'illegal'::text, 'payment_scam'::text, 'payment_not_received'::text,
    'payment_pressure'::text, 'unsafe_conditions'::text, 'injury_risk'::text
  ])
);