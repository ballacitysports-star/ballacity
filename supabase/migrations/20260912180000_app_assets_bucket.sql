-- A public bucket for static assets the app fetches at runtime.
--
-- Created for one file: the ffmpeg wasm core that converts highlight reels to
-- H.264 in the browser. It used to be pulled from unpkg.com on every upload
-- (src/lib/video-transcode.ts), which made the "every reel plays" guarantee
-- depend on a third-party CDN being reachable at that moment. That became more
-- serious once conversion failure started rejecting the upload rather than
-- storing an unplayable clip: an unreachable core now stops non-H.264 uploads
-- outright.
--
-- The obvious fix — ship the wasm as a static asset — is not available. It is
-- 32,232,419 bytes and this deploys as a Cloudflare Worker with assets, which
-- caps a single file at 25 MiB. Storage has no such limit and is already ours,
-- so the asset lives here instead.
--
-- `public = true` is deliberate and safe for this content: these are bytes we
-- publish on purpose, byte-identical to a public npm package, and reads of a
-- public bucket skip RLS entirely. That is also why there is no policy below —
-- reads need none, and the only writer is scripts/upload-ffmpeg-core.mjs
-- running as service_role. Nothing in the app writes to this bucket, so do not
-- add an `authenticated` insert policy: it would let any signed-in user publish
-- arbitrary files to a public URL on this origin.
--
-- 64 MiB leaves room for a future ffmpeg build without another migration.
-- Follows 20260908033000 and 20260909220000: declared in SQL rather than
-- clicked into one project's dashboard, so a fresh project comes up complete.
-- Idempotent, and re-asserts both values if either is changed elsewhere.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('app-assets', 'app-assets', true, 67108864)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;
