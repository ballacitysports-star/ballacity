CREATE TABLE public.game_reminders (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  offsets integer[] NOT NULL DEFAULT '{}',
  last_sent_offset integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_reminders TO authenticated;
GRANT ALL ON public.game_reminders TO service_role;

ALTER TABLE public.game_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players manage their own game reminders"
ON public.game_reminders FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE TRIGGER game_reminders_touch_updated_at
BEFORE UPDATE ON public.game_reminders
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX game_reminders_user_idx ON public.game_reminders (user_id);