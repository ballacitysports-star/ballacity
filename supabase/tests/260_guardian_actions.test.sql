-- The actions only a child's guardian can take: cancel a game for the child,
-- change the child's controls, end the family link, withdraw consent. Each is a
-- function a signed-in user can call directly, so each is tested the way the
-- app cannot be trusted to: called by a stranger, by the child themselves and
-- by a moderator, as well as by the real guardian.
BEGIN;

SELECT t.person('host', 40), t.person('parent', 41), t.person('stranger', 33),
       t.person('teen', 14), t.person('kid', 10), t.person('mod', 38);
SELECT t.guardian('parent', 'teen');
SELECT t.guardian('parent', 'kid');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('mod'), 'moderator');

INSERT INTO public.hosted_games (id, host_id, title, sport, date, location, max_players)
VALUES ('future-run', t.id('host'), 'Saturday run', 'Basketball', now() + interval '3 days', 'Gym', 10);
SELECT t.as_user(t.id('teen'));
INSERT INTO public.join_requests (id, game_id, player_id, host_id, idempotency_key)
VALUES (t.id('req'), 'future-run', t.id('teen'), t.id('host'), 'k1');
SELECT t.reset();

-- ---- guardian_cancel_child_game -------------------------------------------
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.guardian_cancel_child_game(%L, %L)', t.id('teen'), 'future-run'),
  'linked to your account', 'a stranger cannot cancel a game for someone else''s child');
SELECT t.as_user(t.id('teen'));
SELECT t.throws(format('SELECT public.guardian_cancel_child_game(%L, %L)', t.id('teen'), 'future-run'),
  'linked to your account', 'the child cannot use the guardian path for themselves');
SELECT t.as_user(t.id('host'));
SELECT t.throws(format('SELECT public.guardian_cancel_child_game(%L, %L)', t.id('teen'), 'future-run'),
  'linked to your account', 'neither can the host');
SELECT t.as_anon();
SELECT t.throws(format('SELECT public.guardian_cancel_child_game(%L, %L)', t.id('teen'), 'future-run'),
  '', 'a signed-out caller is refused outright');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.join_requests WHERE id = t.id('req')), 1,
  'the child''s request survived every refused attempt');
SELECT t.as_user(t.id('parent'));
SELECT t.eq(public.guardian_cancel_child_game(t.id('teen'), 'future-run'), 'withdrawn',
  'the guardian can withdraw the child''s request');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.join_requests WHERE id = t.id('req')), 0,
  'and it is gone');

-- ---- set_child_controls ---------------------------------------------------
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($q$SELECT public.set_child_controls(%L, '{"messaging":"peers"}'::jsonb)$q$, t.id('teen')),
  'NOT_AUTHORIZED', 'a stranger cannot change a child''s controls');
SELECT t.as_user(t.id('teen'));
SELECT t.throws(format($q$SELECT public.set_child_controls(%L, '{"messaging":"peers"}'::jsonb)$q$, t.id('teen')),
  'NOT_AUTHORIZED', 'the child cannot loosen their own controls');
SELECT t.as_user(t.id('kid'));
SELECT t.throws(format($q$SELECT public.set_child_controls(%L, '{"game_participation":true}'::jsonb)$q$, t.id('kid')),
  'NOT_AUTHORIZED', 'an under-13 cannot switch on their own game participation');
SELECT t.reset();
SELECT t.ok((SELECT messaging FROM public.child_controls WHERE child_user_id = t.id('teen')) <> 'peers',
  'none of those changed the setting');

SELECT t.as_user(t.id('parent'));
SELECT t.lives(format($q$SELECT public.set_child_controls(%L, '{"messaging":"teammates"}'::jsonb)$q$, t.id('teen')),
  'the guardian can change the controls');
SELECT t.reset();
SELECT t.eq((SELECT messaging FROM public.child_controls WHERE child_user_id = t.id('teen')), 'teammates',
  'and the change is stored');

-- Only a guardian, never a moderator, can authorise a public profile.
SELECT t.as_user(t.id('mod'));
SELECT t.throws(format($q$SELECT public.set_child_controls(%L, '{"public_profile":true}'::jsonb)$q$, t.id('teen')),
  'GUARDIAN_REQUIRED', 'a moderator cannot authorise a child''s public profile');
SELECT t.lives(format($q$SELECT public.set_child_controls(%L, '{"messaging":"off"}'::jsonb)$q$, t.id('teen')),
  'but a moderator can tighten controls');
SELECT t.as_user(t.id('parent'));
SELECT t.lives(format($q$SELECT public.set_child_controls(%L, '{"public_profile":true}'::jsonb)$q$, t.id('teen')),
  'the guardian can authorise it');
SELECT t.reset();
SELECT t.eq((SELECT public_profile_authorized_by FROM public.child_controls WHERE child_user_id = t.id('teen')), t.id('parent'),
  'recorded against the guardian who did');

-- ---- revoke_parental_consent ----------------------------------------------
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($q$SELECT public.revoke_parental_consent(%L, 'because')$q$, t.id('kid')),
  'NOT_AUTHORIZED', 'a stranger cannot withdraw a child''s consent');
SELECT t.as_user(t.id('kid'));
SELECT t.throws(format($q$SELECT public.revoke_parental_consent(%L, 'because')$q$, t.id('kid')),
  'NOT_AUTHORIZED', 'the child cannot withdraw their own consent');
SELECT t.as_user(t.id('parent'));
SELECT t.lives(format($q$SELECT public.revoke_parental_consent(%L, 'parent decided')$q$, t.id('kid')),
  'the guardian can');
SELECT t.reset();
SELECT t.eq((SELECT status FROM public.parental_consents WHERE child_user_id = t.id('kid')), 'revoked',
  'consent is revoked');
SELECT t.eq((SELECT messaging FROM public.child_controls WHERE child_user_id = t.id('kid')), 'off',
  'and the restrictions apply at once');
SELECT t.eq((SELECT game_participation FROM public.child_controls WHERE child_user_id = t.id('kid')), false,
  'including game participation');
SELECT t.eq((SELECT allow_messages FROM public.privacy_preferences WHERE user_id = t.id('kid')), 'nobody',
  'and the child''s message and invite preferences are closed');

-- ---- revoke_guardian_link -------------------------------------------------
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.revoke_guardian_link(%L)', t.id('teen')),
  'NOT_FOUND', 'a stranger cannot end someone else''s family link');
SELECT t.as_user(t.id('teen'));
SELECT t.throws(format('SELECT public.revoke_guardian_link(%L)', t.id('teen')),
  'NOT_FOUND', 'the child cannot end their own guardian link');
SELECT t.as_user(t.id('mod'));
SELECT t.throws(format('SELECT public.revoke_guardian_link(%L)', t.id('teen')),
  'NOT_FOUND', 'and neither can a moderator, through this function');
SELECT t.reset();
SELECT t.eq((SELECT status FROM public.guardian_links WHERE child_user_id = t.id('teen')), 'active',
  'the link is still active after every refusal');
SELECT t.as_user(t.id('parent'));
SELECT t.lives(format('SELECT public.revoke_guardian_link(%L)', t.id('teen')), 'the guardian can end it');
SELECT t.reset();
SELECT t.eq((SELECT status FROM public.guardian_links WHERE child_user_id = t.id('teen')), 'revoked',
  'and it is revoked');

ROLLBACK;
