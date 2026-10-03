ALTER TABLE public.team_posts ADD COLUMN IF NOT EXISTS share_scores boolean NOT NULL DEFAULT true;
ALTER TABLE public.team_posts ADD COLUMN IF NOT EXISTS share_notes boolean NOT NULL DEFAULT false;