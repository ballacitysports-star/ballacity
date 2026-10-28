-- Public image buckets accept pictures only.
--
-- None of the storage buckets set `allowed_mime_types`, so a signed-in member
-- could put any file type in a folder named after them in a public bucket and
-- have it served from the project's storage address. The app itself only ever
-- uploads JPG, PNG and WEBP to these buckets (`src/lib/image-upload.ts` sniffs
-- the bytes and sends the sniffed type), so the buckets can say the same.
--
-- Covered: avatars, covers, org-avatars, org-covers, team-avatars, team-covers,
-- trainer-avatars. Not covered, on purpose: game-covers, whose upload sends the
-- picked file as it is; payment-proofs; message-attachments (checked by the
-- server, see 20261028120000); highlight-videos; app-assets; data-exports.
--
-- COMPATIBILITY: the setting is checked on upload only. Files already stored
-- stay readable at their existing public addresses whatever their type, and
-- nothing is deleted. An upload with another type now fails with a type error.
-- Anything that uploads with a blank or generic type (application/octet-stream)
-- to these buckets would start failing; the app's own code does not.
--
-- ROLLBACK: UPDATE storage.buckets SET allowed_mime_types = NULL WHERE id IN (...same list...);

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE id IN (
   'avatars', 'covers', 'org-avatars', 'org-covers',
   'team-avatars', 'team-covers', 'trainer-avatars'
 );
