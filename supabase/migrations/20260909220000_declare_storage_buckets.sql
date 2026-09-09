-- Declare every storage bucket instead of relying on dashboard state.
--
-- 20260908033000 did this for `message-attachments` and explains the reasoning
-- in full. The other eleven buckets were still console-only: they exist in the
-- project they were clicked into and nowhere else. That is invisible until you
-- point the CLI at a fresh project, where `db push` produces a database that
-- looks complete — all 67 tables, every storage policy — but where every
-- upload fails, because the policies gate on `bucket_id` values that have no
-- matching row in storage.buckets. The policies themselves create without
-- complaint (they compare a string; there is no foreign key), which is exactly
-- why the failure surfaces late and looks like an app bug.
--
-- Values below were read from the live project rather than chosen, so this
-- states the current reality rather than changing it:
--
--   public,  8 MiB : avatars, covers, org-avatars, org-covers, team-avatars,
--                    team-covers, trainer-avatars
--   private, 8 MiB : game-covers, payment-proofs
--   private, 20 MiB: message-attachments
--   private, 50 MiB: data-exports
--   private, 200 MiB: highlight-videos
--
-- `public` is the security-critical column: a public bucket serves every object
-- to anyone holding the path, with no auth and no policy evaluation at all. The
-- seven public image buckets are public because their URLs are stable
-- `getPublicUrl` values already stored on profile/team/org rows; the private
-- ones are read through short-lived signed URLs so Storage RLS is re-checked on
-- every view (see src/lib/media-refs.ts and src/hooks/use-media-url.ts).
--
-- Idempotent, and re-asserts both values if either is ever changed elsewhere.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES
  ('avatars',             'avatars',             true,    8388608),
  ('covers',              'covers',              true,    8388608),
  ('org-avatars',         'org-avatars',         true,    8388608),
  ('org-covers',          'org-covers',          true,    8388608),
  ('team-avatars',        'team-avatars',        true,    8388608),
  ('team-covers',         'team-covers',         true,    8388608),
  ('trainer-avatars',     'trainer-avatars',     true,    8388608),
  ('game-covers',         'game-covers',         false,   8388608),
  ('payment-proofs',      'payment-proofs',      false,   8388608),
  ('message-attachments', 'message-attachments', false,  20971520),
  ('data-exports',        'data-exports',        false,  52428800),
  ('highlight-videos',    'highlight-videos',    false, 209715200)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;
