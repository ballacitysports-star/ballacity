-- Declare the message-attachments bucket instead of relying on dashboard state.
--
-- The bucket's policies live in 20260627124305 — participants read, the sender
-- writes into their own folder, the sender deletes — but the bucket row itself
-- was created by hand. Its `public` flag is the switch those policies hang
-- from: a public bucket serves every object to anyone holding the path, with
-- no auth and no policy evaluation at all, so flipping it in the dashboard
-- would quietly undo all three policies and every message-privacy rule behind
-- them. That is not something that should live only in a console setting.
--
-- Verified as `public = false` with a 20 MiB limit before writing this, so
-- this states the current reality rather than changing it. The limit matches
-- the client's own 20 MB check in uploadMessageAttachment(), which is a
-- courtesy check only — this is the one that is actually enforced.
--
-- Idempotent, and re-asserts both values if either is ever changed elsewhere.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('message-attachments', 'message-attachments', false, 20971520)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = 20971520;
