
CREATE POLICY "Game covers are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'game-covers');

CREATE POLICY "Users can upload their own game covers"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'game-covers' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own game covers"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'game-covers' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own game covers"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'game-covers' AND auth.uid()::text = (storage.foldername(name))[1]);
