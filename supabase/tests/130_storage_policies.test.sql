-- Who may read and write files. Private buckets (payment proofs, message
-- attachments, highlight videos) stay inside their owners and participants, and
-- nobody writes into another person's folder. A quarantined highlight is
-- unreadable even to its owner.
BEGIN;

-- The test platform stub gives API roles no table grants on storage.objects;
-- Supabase gives them all and leaves the rest to RLS. Mirror that here (rolled
-- back with the transaction) so the policies are what is being tested.
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon;

SELECT t.person('alice', 30), t.person('bob', 31), t.person('carol', 29), t.person('hostie', 40);

-- ---- payment proofs -----------------------------------------------------------
INSERT INTO public.hosted_games (id, host_id, title, sport, date, location, max_players)
VALUES ('storage-game', t.id('hostie'), 'Run', 'Basketball', now() + interval '2 days', 'Gym', 10);
INSERT INTO public.payment_submissions (id, player_id, game_id, host_id, screenshot_path)
VALUES (t.id('sub-alice'), t.id('alice'), 'storage-game', t.id('hostie'), t.id('alice') || '/proof.png');
INSERT INTO storage.objects (bucket_id, name, owner)
VALUES ('payment-proofs', t.id('alice') || '/proof.png', t.id('alice'));

SELECT t.as_user(t.id('alice'));
SELECT t.eq(t.count(format($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'payment-proofs' AND name = %L$q$, t.id('alice') || '/proof.png')), 1,
  'a player reads their own payment proof');
SELECT t.lives(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('payment-proofs', %L, %L)$q$, t.id('alice') || '/second.png', t.id('alice')),
  'and uploads another into their own folder');
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('payment-proofs', %L, %L)$q$, t.id('bob') || '/forged.png', t.id('alice')),
  'row-level security', 'but not into someone else''s folder');
SELECT t.as_user(t.id('hostie'));
SELECT t.eq(t.count(format($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'payment-proofs' AND name = %L$q$, t.id('alice') || '/proof.png')), 1,
  'the host of that game reads the proof');
SELECT t.as_user(t.id('bob'));
SELECT t.eq(t.count($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'payment-proofs'$q$), 0,
  'another player sees no payment proofs');
SELECT t.as_anon();
SELECT t.eq(t.count($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'payment-proofs'$q$), 0,
  'a visitor sees none either');
SELECT t.reset();

-- ---- message attachments --------------------------------------------------------
INSERT INTO public.conversations (id, created_by) VALUES (t.id('conv'), t.id('alice'));
INSERT INTO public.conversation_participants (conversation_id, user_id)
VALUES (t.id('conv'), t.id('alice')), (t.id('conv'), t.id('bob'));
INSERT INTO storage.objects (bucket_id, name, owner)
VALUES ('message-attachments', t.id('conv') || '/' || t.id('alice') || '/pic.png', t.id('alice'));

SELECT t.as_user(t.id('alice'));
SELECT t.eq(t.count($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'$q$), 1,
  'the sender reads their own attachment');
SELECT t.lives(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('message-attachments', %L, %L)$q$,
  t.id('conv') || '/' || t.id('alice') || '/two.png', t.id('alice')), 'a participant attaches a file as themselves');
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('message-attachments', %L, %L)$q$,
  t.id('conv') || '/' || t.id('bob') || '/spoof.png', t.id('alice')), 'row-level security',
  'but not under another participant''s name');
SELECT t.as_user(t.id('carol'));
SELECT t.eq(t.count($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'message-attachments'$q$), 0,
  'someone outside the conversation reads nothing');
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('message-attachments', %L, %L)$q$,
  t.id('conv') || '/' || t.id('carol') || '/intrude.png', t.id('carol')), 'row-level security',
  'and cannot attach to it');
SELECT t.reset();

-- ---- highlight videos -------------------------------------------------------------
INSERT INTO storage.objects (bucket_id, name, owner)
VALUES ('highlight-videos', t.id('alice') || '/clip.mp4', t.id('alice')),
       ('highlight-videos', t.id('alice') || '/held.mp4', t.id('alice'));

SELECT t.as_user(t.id('alice'));
SELECT t.eq(t.count($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'highlight-videos'$q$), 2, 'an owner reads their own clips');
SELECT t.as_user(t.id('bob'));
SELECT t.eq(t.count($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'highlight-videos'$q$), 0, 'another member reads none');
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('highlight-videos', %L, %L)$q$,
  t.id('alice') || '/planted.mp4', t.id('bob')), 'row-level security', 'and cannot plant a clip in their folder');
SELECT t.as_anon();
SELECT t.eq(t.count($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'highlight-videos'$q$), 0, 'a visitor reads none');
SELECT t.reset();

-- A quarantined highlight is unreadable to everyone, its owner included.
INSERT INTO public.image_moderation (bucket, path, owner_id, status)
VALUES ('highlight-videos', t.id('alice') || '/held.mp4', t.id('alice'), 'quarantined');
SELECT t.as_user(t.id('alice'));
SELECT t.eq(t.count($q$SELECT 1 FROM storage.objects WHERE bucket_id = 'highlight-videos'$q$), 1,
  'a quarantined clip drops out of its owner''s view, leaving the rest');
SELECT t.reset();

-- ---- profile pictures and entity images ---------------------------------------------
SELECT t.team('squad', 'alice');
SELECT t.as_user(t.id('alice'));
SELECT t.lives(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('avatars', %L, %L)$q$, t.id('alice') || '/me.png', t.id('alice')),
  'a member writes their own avatar');
SELECT t.throws(format($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('avatars', %L, %L)$q$, t.id('bob') || '/me.png', t.id('alice')),
  'row-level security', 'but not another member''s');
SELECT t.lives($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('team-avatars', 'squad/logo.png', NULL)$q$,
  'a team owner writes their team''s image');
SELECT t.as_user(t.id('bob'));
SELECT t.throws($q$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('team-avatars', 'squad/hijack.png', NULL)$q$,
  'row-level security', 'someone else cannot write into that team''s folder');
SELECT t.eq(t.changed(format($q$DELETE FROM storage.objects WHERE bucket_id = 'avatars' AND name = %L$q$, t.id('alice') || '/me.png')), 0,
  'and cannot delete another member''s avatar');
SELECT t.as_anon();
SELECT t.throws($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', 'anon/x.png')$q$,
  'row-level security', 'a visitor cannot upload anything');
SELECT t.reset();

ROLLBACK;
