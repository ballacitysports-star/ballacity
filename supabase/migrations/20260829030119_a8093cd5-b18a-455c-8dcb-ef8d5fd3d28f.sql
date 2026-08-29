DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'highlight_reels'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.highlight_reels;
  END IF;
END $$;

ALTER TABLE public.highlight_reels REPLICA IDENTITY FULL;