-- Optional cover image on team posts.
--
-- Holds either a public team-covers storage URL uploaded by the poster, or a
-- built-in sport cover saved by name ("preset:basketball"). The server
-- validates both before insert (see src/lib/post-image.ts). Image uploads are
-- safety-scanned and quarantined by the existing image moderation, which
-- clears this column through clearImageReferences.
--
-- Additive and nullable: existing posts and text-only posts are unaffected.

ALTER TABLE public.team_posts
  ADD COLUMN IF NOT EXISTS image_url text;

ALTER TABLE public.team_posts
  DROP CONSTRAINT IF EXISTS team_posts_image_url_length;
ALTER TABLE public.team_posts
  ADD CONSTRAINT team_posts_image_url_length
  CHECK (image_url IS NULL OR char_length(image_url) <= 1000);
