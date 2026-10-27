-- Make "a quarantined clip is unreadable, owner included" actually hold.
--
-- 20260915120144 added a RESTRICTIVE storage policy that hides a highlight video
-- once an `image_moderation` row marks it quarantined. The check is a plain
-- EXISTS over `public.image_moderation`, and a policy subquery runs with the
-- caller's rights, so row-level security applies to it: `image_moderation` lets
-- only superadmins read rows. For the owner (or anyone else) the subquery sees
-- nothing, NOT EXISTS is true, and the quarantined clip stays readable. The SQL
-- test 130_storage_policies shows it: the owner still sees both clips.
--
-- The bucket is private, so this never exposed a clip to other people, but an
-- owner could still read, or sign a link to, media the safety pipeline held.
--
-- The lookup moves into a SECURITY DEFINER function that sees the moderation
-- rows, and the policy calls it. It answers one yes/no question about one path
-- and returns no row. The policy applies to signed-in users: anonymous visitors
-- have no permissive read on this bucket for it to restrict.
--
-- ROLLBACK: DROP POLICY "quarantined highlight media is unreadable" ON
-- storage.objects; recreate it from 20260915120144_c249c350-...sql; then
-- DROP FUNCTION private_sec.is_quarantined_media(text, text). No data changes.

CREATE OR REPLACE FUNCTION private_sec.is_quarantined_media(_bucket text, _path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.image_moderation im
    WHERE im.bucket = _bucket AND im.path = _path AND im.status = 'quarantined'
  )
$function$;

REVOKE ALL ON FUNCTION private_sec.is_quarantined_media(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.is_quarantined_media(text, text) TO authenticated, service_role;

DROP POLICY IF EXISTS "quarantined highlight media is unreadable" ON storage.objects;
CREATE POLICY "quarantined highlight media is unreadable"
ON storage.objects
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  bucket_id <> 'highlight-videos'
  OR NOT private_sec.is_quarantined_media(bucket_id, name)
);
