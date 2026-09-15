DELETE FROM public.ai_text_moderation WHERE target_table = 'highlight_reels' AND target_id = '9952a99a-0091-4858-a1ea-e2de9f13365a';
DELETE FROM public.ai_usage_events WHERE job_id IN (SELECT id FROM public.ai_generation_jobs WHERE related_reel_id = '9952a99a-0091-4858-a1ea-e2de9f13365a');
DELETE FROM public.ai_generation_jobs WHERE related_reel_id = '9952a99a-0091-4858-a1ea-e2de9f13365a';
DELETE FROM public.highlight_reels WHERE id = '9952a99a-0091-4858-a1ea-e2de9f13365a';