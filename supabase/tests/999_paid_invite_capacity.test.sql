-- On a paid game an invitation's accept counts the places approved players already hold (20261204110000_paid_invite_capacity).
-- Owner decision 2026-11-27, option A of the paid over-approval review: the capacity check of game_respond_invite adds,
-- on a paid game only, every other player whose request is approved and who has no roster row, and answers the existing
-- {"status":"full","on_roster":...} when the place is taken.
-- 1. Two invitees for the last paid place: the first is approved, the second is told full, gets no request, keeps a
--    pending invitation, and the host is not told a second time.
-- 2. Only the counted rows count: an approved player with a roster row once, pending and declined requests not at all,
--    and not the accepting player's own approved request.
-- 3. A player who paid and could not be placed (approved, verified payment, no row) holds the place.
-- 4. A place frees and the next accept goes through: after the host's removal, after the payment window's release and
--    after the player withdraws their own request.
-- 5. With no payment window set, an approved player who never pays holds the place.
-- 6. Scope: free games count roster rows only, the guardian-held accept on a free game included; a game priced above 0
--    with no settings row is paid.
-- 7. The definition is pinned: the live one apart from the capacity block, owner, SECURITY DEFINER, search_path, grants.
-- Each game is sized at the boundary, so a rule that counts too much or too little flips an answer. On the old definition
-- (the rollback applied) the file still runs to the end and the assertions marked PAID fail.
BEGIN;
SELECT t.person('host', 35), t.person('rex', 30), t.person('ana', 28), t.person('bob', 29), t.person('cal', 31),
       t.person('dee', 32), t.person('eve', 27), t.person('fin', 26), t.person('gil', 33), t.person('hoa', 34),
       t.person('ian', 25), t.person('pa', 30), t.person('pb', 31), t.person('pc', 32), t.person('pd', 33),
       t.person('pnp', 29), t.person('xa', 28), t.person('xb', 27), t.person('xc', 26), t.person('xd', 25),
       t.person('fx', 30), t.person('fy', 31), t.person('xp', 29), t.person('mom', 42), t.person('kid', 15);
SELECT t.guardian('mom', 'kid');

SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players, price) VALUES
  ('gone',    t.id('host'), 'basketball', 'Last paid place', now() + interval '3 days', 2, 0),
  ('gonce',   t.id('host'), 'basketball', 'Placed payer',    now() + interval '3 days', 3, 0),
  ('gpend',   t.id('host'), 'basketball', 'Pending asks',    now() + interval '3 days', 2, 0),
  ('gself',   t.id('host'), 'basketball', 'Own approval',    now() + interval '3 days', 2, 0),
  ('gpnp',    t.id('host'), 'basketball', 'Paid not placed', now() + interval '3 days', 2, 0),
  ('grm',     t.id('host'), 'basketball', 'Removal frees',   now() + interval '3 days', 2, 0),
  ('gsweep',  t.id('host'), 'basketball', 'Window frees',    now() + interval '3 days', 2, 0),
  ('gleave',  t.id('host'), 'basketball', 'Leave frees',     now() + interval '3 days', 2, 0),
  ('gnohold', t.id('host'), 'basketball', 'No window',       now() + interval '3 days', 2, 0),
  ('gfree',   t.id('host'), 'basketball', 'Free run',        now() + interval '3 days', 2, 0),
  ('gfkid',   t.id('host'), 'basketball', 'Free teen run',   now() + interval '3 days', 2, 0),
  ('gprice',  t.id('host'), 'basketball', 'Priced run',      now() + interval '3 days', 2, 15);
-- gprice has no settings row: the game's price decides, as in the join gate. Every other paid game has no payment window
-- unless named below.
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES
  ('gone', t.id('host'), 10, true), ('gonce', t.id('host'), 10, true), ('gpend', t.id('host'), 10, true),
  ('gself', t.id('host'), 10, true), ('gpnp', t.id('host'), 10, true), ('grm', t.id('host'), 10, true),
  ('gleave', t.id('host'), 10, true), ('gnohold', t.id('host'), 10, true),
  ('gfree', t.id('host'), 0, true), ('gfkid', t.id('host'), 0, true);
-- gsweep: an approved place is held for 30 minutes for the payment.
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval, payment_hold_minutes) VALUES
  ('gsweep', t.id('host'), 10, true, 30);
-- One roster row on every game (rex), and on gonce a second (pa, a paid player who was placed).
INSERT INTO public.game_participants (game_id, user_id)
SELECT g, t.id('rex') FROM unnest(ARRAY['gone', 'gonce', 'gpend', 'gself', 'gpnp', 'grm', 'gsweep', 'gleave', 'gnohold',
                                        'gfree', 'gfkid', 'gprice']) g;
INSERT INTO public.game_participants (game_id, user_id) VALUES ('gonce', t.id('pa'));
-- Requests written before the invitations were answered:
--   gonce: pa approved (and on the roster). gpend: pc pending, pd declined. gself: ana approved by the host.
--   gpnp: pnp approved, paid (verified below), not placed. grm, gsweep, gleave: xa, xb, xc approved an hour ago, not paid.
--   gnohold: xd approved thirty days ago, never paid. gfree, gfkid: fx, fy approved with no row. gprice: xp approved.
INSERT INTO public.join_requests (id, game_id, host_id, player_id, status, idempotency_key, reviewed_at, last_rejected_at,
                                  created_at) VALUES
  (t.id('req-pa'),  'gonce',   t.id('host'), t.id('pa'),  'approved', 'k', now() - interval '1 hour',  NULL, now() - interval '4 hours'),
  (t.id('req-pc'),  'gpend',   t.id('host'), t.id('pc'),  'pending',  'k', NULL,                       NULL, now() - interval '4 hours'),
  (t.id('req-pd'),  'gpend',   t.id('host'), t.id('pd'),  'rejected', 'k', now() - interval '3 hours', now() - interval '3 hours', now() - interval '4 hours'),
  (t.id('req-ana'), 'gself',   t.id('host'), t.id('ana'), 'approved', 'k', now() - interval '1 hour',  NULL, now() - interval '4 hours'),
  (t.id('req-pnp'), 'gpnp',    t.id('host'), t.id('pnp'), 'approved', 'k', now() - interval '1 hour',  NULL, now() - interval '4 hours'),
  (t.id('req-xa'),  'grm',     t.id('host'), t.id('xa'),  'approved', 'k', now() - interval '1 hour',  NULL, now() - interval '4 hours'),
  (t.id('req-xb'),  'gsweep',  t.id('host'), t.id('xb'),  'approved', 'k', now() - interval '1 hour',  NULL, now() - interval '4 hours'),
  (t.id('req-xc'),  'gleave',  t.id('host'), t.id('xc'),  'approved', 'k', now() - interval '1 hour',  NULL, now() - interval '4 hours'),
  (t.id('req-xd'),  'gnohold', t.id('host'), t.id('xd'),  'approved', 'k', now() - interval '30 days', NULL, now() - interval '31 days'),
  (t.id('req-fx'),  'gfree',   t.id('host'), t.id('fx'),  'approved', 'k', now() - interval '1 hour',  NULL, now() - interval '4 hours'),
  (t.id('req-fy'),  'gfkid',   t.id('host'), t.id('fy'),  'approved', 'k', now() - interval '1 hour',  NULL, now() - interval '4 hours'),
  (t.id('req-xp'),  'gprice',  t.id('host'), t.id('xp'),  'approved', 'k', now() - interval '1 hour',  NULL, now() - interval '4 hours');
INSERT INTO public.payment_submissions (game_id, player_id, host_id, paid_amount, status, payment_type) VALUES
  ('gpnp', t.id('pnp'), t.id('host'), 10, 'verified', 'venmo');
UPDATE public.hosted_games g SET joined = (SELECT count(*) FROM public.game_participants p WHERE p.game_id = g.id);
SET LOCAL session_replication_role = origin;

INSERT INTO public.game_invites (id, game_id, host_id, invitee_id, created_at)
SELECT t.id('inv-' || g || '-' || w), g, t.id('host'), t.id(w), now() - interval '2 hours'
  FROM (VALUES ('gone', 'ana'), ('gone', 'bob'), ('gonce', 'ana'), ('gpend', 'ana'), ('gself', 'ana'), ('gpnp', 'ana'),
               ('grm', 'bob'), ('gsweep', 'cal'), ('gleave', 'dee'), ('gnohold', 'eve'), ('gfree', 'fin'),
               ('gfkid', 'kid'), ('gprice', 'gil')) v(g, w);

-- The answer to `who` accepting their invitation to `game`, as that player.
CREATE FUNCTION pg_temp.answer(game text, who text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM t.as_user(t.id(who));
  r := public.game_respond_invite(t.id('inv-' || game || '-' || who), true);
  PERFORM t.reset();
  RETURN r - 'join_request_id';
END $$;
CREATE FUNCTION pg_temp.seats(game text, who text) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.game_participants WHERE game_id = game AND user_id = t.id(who) $$;
CREATE FUNCTION pg_temp.req(game text, who text) RETURNS text LANGUAGE sql AS $$
  SELECT status FROM public.join_requests WHERE game_id = game AND player_id = t.id(who) $$;
CREATE FUNCTION pg_temp.inv(game text, who text) RETURNS text LANGUAGE sql AS $$
  SELECT status FROM public.game_invites WHERE id = t.id('inv-' || game || '-' || who) $$;
CREATE FUNCTION pg_temp.told(game text) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.notifications
   WHERE user_id = t.id('host') AND type = 'game_invite_accepted' AND link = '/games/' || game $$;

-- ================= 1. the last paid place, two invitees =================
SELECT t.eq(pg_temp.answer('gone', 'ana'), '{"status": "accepted", "on_roster": false}'::jsonb,
  'the first invitee for the last paid place is approved, not on the roster (payment follows)');
SELECT t.eq(pg_temp.req('gone', 'ana'), 'approved', 'with an approved request');
SELECT t.eq(pg_temp.answer('gone', 'bob'), '{"status": "full", "on_roster": false}'::jsonb,
  'PAID: the second is told full: the first one''s approval holds the place');
SELECT t.eq(pg_temp.req('gone', 'bob'), NULL, 'PAID: full writes no request');
SELECT t.eq(pg_temp.inv('gone', 'bob'), 'pending', 'PAID: the invitation stays pending (it can be accepted once a place frees)');
SELECT t.eq(pg_temp.told('gone'), 1, 'PAID: the host is told once, not for the full answer');
SELECT t.eq((SELECT count(*)::int FROM public.join_requests WHERE game_id = 'gone' AND status = 'approved')
            + (SELECT count(*)::int FROM public.game_participants WHERE game_id = 'gone'), 2,
  'PAID: places held (rows plus approvals with no row) do not pass max_players');

-- ================= 2. only the counted rows count =================
SELECT t.eq(pg_temp.answer('gonce', 'ana'), '{"status": "accepted", "on_roster": false}'::jsonb,
  'an approved player who is on the roster is counted once (2 of 3 places, so the accept goes through)');
SELECT t.eq(pg_temp.answer('gpend', 'ana'), '{"status": "accepted", "on_roster": false}'::jsonb,
  'pending and declined requests hold nothing (1 of 2 places, so the accept goes through)');
SELECT t.eq(pg_temp.answer('gself', 'ana'), '{"status": "accepted", "on_roster": false}'::jsonb,
  'the accepting player''s own approved request is not counted against them');
SELECT t.eq(pg_temp.req('gself', 'ana'), 'approved', 'and it stays approved');
SELECT t.eq(pg_temp.inv('gself', 'ana'), 'accepted', 'and the invitation is accepted');

-- ================= 3. paid, not placed =================
SELECT t.eq(pg_temp.answer('gpnp', 'ana'), '{"status": "full", "on_roster": false}'::jsonb,
  'PAID: a player who paid and could not be placed holds the place they paid for');
SELECT t.eq(pg_temp.req('gpnp', 'ana'), NULL, 'PAID: and the full answer writes no request');

-- ================= 4. a place frees, the next accept goes through =================
SELECT t.eq(pg_temp.answer('grm', 'bob'), '{"status": "full", "on_roster": false}'::jsonb,
  'PAID: xa, approved and not paid, holds grm''s last place');
SELECT t.as_user(t.id('host'));
SELECT t.eq(public.host_remove_player('grm', t.id('xa')) ->> 'request_declined', 'true', 'the host removes xa: the request is declined');
SELECT t.reset();
SELECT t.eq(pg_temp.answer('grm', 'bob'), '{"status": "accepted", "on_roster": false}'::jsonb,
  'after the removal the next accept goes through');

SELECT t.eq(pg_temp.answer('gsweep', 'cal'), '{"status": "full", "on_roster": false}'::jsonb,
  'PAID: xb, approved an hour ago with a 30-minute window and not paid, holds gsweep''s place until the release');
SELECT t.eq(public.release_expired_payment_holds('gsweep'), 1, 'the payment window''s release frees xb''s place');
SELECT t.eq(pg_temp.req('gsweep', 'xb'), 'rejected', 'xb''s request is declined by the release');
SELECT t.eq(pg_temp.answer('gsweep', 'cal'), '{"status": "accepted", "on_roster": false}'::jsonb,
  'after the release the next accept goes through');

SELECT t.eq(pg_temp.answer('gleave', 'dee'), '{"status": "full", "on_roster": false}'::jsonb,
  'PAID: xc, approved and not paid, holds gleave''s place');
SELECT t.as_user(t.id('xc'));
SELECT t.eq(t.changed($q$DELETE FROM public.join_requests WHERE id = t.id('req-xc')$q$), 1,
  'xc withdraws their own approved request (the app''s leave, withdrawFromGame)');
SELECT t.reset();
SELECT t.eq(pg_temp.answer('gleave', 'dee'), '{"status": "accepted", "on_roster": false}'::jsonb,
  'after the withdrawal the next accept goes through');

-- ================= 5. no payment window =================
SELECT t.eq(public.release_expired_payment_holds('gnohold'), 0, 'with no window set nothing is ever released');
SELECT t.eq(pg_temp.answer('gnohold', 'eve'), '{"status": "full", "on_roster": false}'::jsonb,
  'PAID: so xd, approved thirty days ago and never paid, still holds the place');
SELECT t.eq(pg_temp.inv('gnohold', 'eve'), 'pending', 'PAID: and eve''s invitation waits');

-- ================= 6. scope =================
SELECT t.eq(pg_temp.answer('gfree', 'fin'), '{"status": "accepted", "on_roster": true}'::jsonb,
  'a free game counts roster rows only: fx''s approval with no row does not hold the place, fin is seated');
SELECT t.eq(pg_temp.seats('gfree', 'fin'), 1, 'fin has a roster row (the seat path is unchanged)');
SELECT t.eq(pg_temp.answer('gfkid', 'kid'), '{"status": "accepted", "on_roster": false}'::jsonb,
  'a guarded minor''s accept on a free game is held for the guardian and still counts roster rows only');
SELECT t.eq(pg_temp.req('gfkid', 'kid'), 'approved', 'the minor''s request is approved, waiting for the guardian');
SELECT t.eq(pg_temp.answer('gprice', 'gil'), '{"status": "full", "on_roster": false}'::jsonb,
  'PAID: no settings row and a price above 0 is paid (the fee rule), so xp''s approval holds the place');

-- ================= 7. the definition =================
SELECT t.eq((SELECT md5(replace(pg_get_functiondef('public.game_respond_invite(uuid,boolean)'::regprocedure),
                                $b$  -- Free with no guardian step: the other players' rows. Otherwise, as before: every row.
  -- On a paid game also every other player whose request is approved and who has no row yet (approved, not yet paid;
  -- 20261204110000): an approval holds the place until the player pays, leaves, is removed or declined, or the payment
  -- window releases it. Counting rows alone let more players be approved than there are places, and the last to pay
  -- were then paid but not placed.
  IF (SELECT count(*) FROM public.game_participants p
       WHERE p.game_id = _i.game_id AND (NOT _seat OR p.user_id <> _me))
     + (SELECT count(*) FROM public.join_requests r
         WHERE COALESCE(_fee, 0) > 0
           AND r.game_id = _i.game_id AND r.status = 'approved' AND r.player_id <> _me
           AND NOT EXISTS (SELECT 1 FROM public.game_participants p2
                            WHERE p2.game_id = r.game_id AND p2.user_id = r.player_id)) >= _g.max_players THEN
$b$,
                                $b$  -- Free with no guardian step: the other players' rows. Otherwise, as before: every row.
  IF (SELECT count(*) FROM public.game_participants p
       WHERE p.game_id = _i.game_id AND (NOT _seat OR p.user_id <> _me)) >= _g.max_players THEN
$b$))),
  '79fa287fb3126c74dce0f902542d3e4e',
  'apart from the capacity block, game_respond_invite is 20261130110000''s character for character');
SELECT t.eq((SELECT md5(pg_get_functiondef('public.game_respond_invite(uuid,boolean)'::regprocedure))),
  '7372bcebab32979448f5327cd9f74413', 'PAID: game_respond_invite is the one 20261204110000 created (the rollback guard expects it)');
SELECT t.eq((SELECT proowner::regrole::text || '/' || prosecdef::text || '/' || proconfig::text || '/' || prorettype::regtype::text
               FROM pg_proc WHERE oid = 'public.game_respond_invite(uuid,boolean)'::regprocedure),
  'postgres/true/{"search_path=\"\""}/jsonb', 'same owner, SECURITY DEFINER, empty search_path and return type');
SELECT t.eq((SELECT coalesce(string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC')), '')
               FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
               LEFT JOIN pg_roles r ON r.oid = x.grantee
              WHERE p.oid = 'public.game_respond_invite(uuid,boolean)'::regprocedure
                AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role')),
  'authenticated:EXECUTE,service_role:EXECUTE', 'the same grants: members and the service role, not PUBLIC or visitors');
SELECT t.eq(has_function_privilege('anon', 'public.game_respond_invite(uuid,boolean)', 'EXECUTE'), false, 'visitors cannot answer');
SELECT t.eq(has_function_privilege('authenticated', 'public.game_respond_invite(uuid,boolean)', 'EXECUTE'), true, 'members can');

ROLLBACK;
