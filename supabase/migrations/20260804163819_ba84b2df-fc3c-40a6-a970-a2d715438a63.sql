ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_profile_id uuid REFERENCES public.account_profiles(id) ON DELETE SET NULL;

UPDATE public.profiles SET default_profile_id = active_profile_id WHERE default_profile_id IS NULL AND active_profile_id IS NOT NULL;