ALTER TABLE public.trainer_session_requests
  ADD COLUMN IF NOT EXISTS preferred_start_time TIME NULL;

CREATE INDEX IF NOT EXISTS trainer_session_requests_trainer_date_idx
  ON public.trainer_session_requests (trainer_id, preferred_date);