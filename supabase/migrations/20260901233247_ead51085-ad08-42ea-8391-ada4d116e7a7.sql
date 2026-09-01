ALTER TABLE public.privacy_preferences
  ADD COLUMN IF NOT EXISTS show_online_status boolean NOT NULL DEFAULT true;