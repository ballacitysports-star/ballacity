-- The public image buckets name the picture types they take; buckets with other
-- jobs are left alone.
BEGIN;

SELECT t.eq(
  (SELECT count(*)::int FROM storage.buckets
    WHERE id IN ('avatars','covers','org-avatars','org-covers','team-avatars','team-covers','trainer-avatars')
      AND allowed_mime_types IS NOT DISTINCT FROM ARRAY['image/jpeg','image/png','image/webp']),
  7, 'all seven public image buckets allow only JPG, PNG and WEBP');
SELECT t.eq(
  (SELECT count(*)::int FROM storage.buckets
    WHERE id IN ('game-covers','payment-proofs','message-attachments','highlight-videos','app-assets','data-exports')
      AND allowed_mime_types IS NOT NULL),
  0, 'the other buckets are not restricted by this rule');

ROLLBACK;
