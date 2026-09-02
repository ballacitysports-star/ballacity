-- 1. Remove existing orphans so the new references can be created.
DELETE FROM public.join_requests jr
WHERE NOT EXISTS (SELECT 1 FROM public.hosted_games g WHERE g.id = jr.game_id);

DELETE FROM public.game_payment_settings x
WHERE NOT EXISTS (SELECT 1 FROM public.hosted_games g WHERE g.id = x.game_id);

-- 2. Enforce referential integrity for game-scoped tables.
ALTER TABLE public.game_participants
  ADD CONSTRAINT game_participants_game_id_fkey
  FOREIGN KEY (game_id) REFERENCES public.hosted_games(id) ON DELETE CASCADE;

ALTER TABLE public.join_requests
  ADD CONSTRAINT join_requests_game_id_fkey
  FOREIGN KEY (game_id) REFERENCES public.hosted_games(id) ON DELETE CASCADE;

ALTER TABLE public.game_position_waitlist
  ADD CONSTRAINT game_position_waitlist_game_id_fkey
  FOREIGN KEY (game_id) REFERENCES public.hosted_games(id) ON DELETE CASCADE;

ALTER TABLE public.game_payment_settings
  ADD CONSTRAINT game_payment_settings_game_id_fkey
  FOREIGN KEY (game_id) REFERENCES public.hosted_games(id) ON DELETE CASCADE;

ALTER TABLE public.payment_submissions
  ADD CONSTRAINT payment_submissions_game_id_fkey
  FOREIGN KEY (game_id) REFERENCES public.hosted_games(id) ON DELETE CASCADE;

ALTER TABLE public.game_reminders
  ADD CONSTRAINT game_reminders_game_id_fkey
  FOREIGN KEY (game_id) REFERENCES public.hosted_games(id) ON DELETE CASCADE;

ALTER TABLE public.game_safety_acknowledgments
  ADD CONSTRAINT game_safety_acknowledgments_game_id_fkey
  FOREIGN KEY (game_id) REFERENCES public.hosted_games(id) ON DELETE CASCADE;