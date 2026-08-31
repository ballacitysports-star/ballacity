ALTER TABLE public.post_comments DROP CONSTRAINT IF EXISTS post_comments_subject_type_check;
ALTER TABLE public.post_comments ADD CONSTRAINT post_comments_subject_type_check CHECK (subject_type IN ('team_post','game','highlight_reel'));
ALTER TABLE public.post_reactions DROP CONSTRAINT IF EXISTS post_reactions_subject_type_check;
ALTER TABLE public.post_reactions ADD CONSTRAINT post_reactions_subject_type_check CHECK (subject_type IN ('team_post','game','highlight_reel'));