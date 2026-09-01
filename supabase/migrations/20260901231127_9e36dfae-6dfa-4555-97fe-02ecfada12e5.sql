-- AI & Video Privacy: separate the "use AI on my clips to give me results" consent
-- from any future "use my clips to train AI models" consent. Training is OFF by
-- default and is never implied by basic service use.
alter table public.privacy_preferences
  add column if not exists ai_training_opt_in boolean not null default false,
  add column if not exists ai_disclosure_ack_at timestamptz;

comment on column public.privacy_preferences.ai_training_opt_in is
  'Explicit opt-in for using the user''s uploaded videos to improve/train AI models. Default false; no training pipeline consumes videos today.';
comment on column public.privacy_preferences.ai_disclosure_ack_at is
  'When the user last acknowledged the AI video analysis disclosure shown before upload.';