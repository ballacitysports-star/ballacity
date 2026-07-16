ALTER TABLE public.player_availabilities REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.player_availabilities;