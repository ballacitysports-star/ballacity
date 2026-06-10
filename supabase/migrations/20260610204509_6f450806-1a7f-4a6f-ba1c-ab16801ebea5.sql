
CREATE POLICY "Users upload own highlight videos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'highlight-videos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users read own highlight videos" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'highlight-videos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users delete own highlight videos" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'highlight-videos' AND auth.uid()::text = (storage.foldername(name))[1]);
