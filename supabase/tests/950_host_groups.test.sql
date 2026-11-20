-- WP 3.2b (20261124100000_host_groups): a host's private named lists of their regulars. Only the host reads or changes them;
-- only a current regular can be added; the people on a list cannot see it; inviting a list still goes through every rule.
BEGIN;
SELECT t.person('host', 35), t.person('other', 40), t.person('reg', 25), t.person('reg2', 33), t.person('teen', 17),
       t.person('stranger', 32), t.person('blk', 30);

SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players) VALUES
  ('past1', t.id('host'), 'basketball', 'Last week', now() - interval '10 days', 10),
  ('next',  t.id('host'), 'basketball', 'Next week', now() + interval '3 days', 10);
INSERT INTO public.game_participants (game_id, user_id) VALUES
  ('past1', t.id('reg')), ('past1', t.id('reg2')), ('past1', t.id('teen')), ('past1', t.id('blk'));
SET LOCAL session_replication_role = origin;

-- ---- privileges ---------------------------------------------------------------------------------------------------------------------
SELECT t.eq(has_table_privilege('anon', 'public.host_groups', 'SELECT'), false, 'visitors cannot read groups');
SELECT t.eq(has_table_privilege('authenticated', 'public.host_groups', 'UPDATE'), false, 'no whole-row update grant');
SELECT t.eq(has_column_privilege('authenticated', 'public.host_groups', 'host_id', 'UPDATE'), false, 'a group''s owner cannot be changed');
SELECT t.eq(has_function_privilege('authenticated', 'private_sec.regular_invitable(uuid,uuid)', 'EXECUTE'), false,
  'members still cannot ask about other hosts'' regulars');

-- ---- the host keeps a list ---------------------------------------------------------------------------------------------------------
SELECT t.as_user(t.id('host'));
INSERT INTO public.host_groups (id, host_id, name) VALUES ('00000000-0000-4000-8000-000000000950', t.id('host'), '  Tuesday crew  ');
SELECT t.eq((SELECT name FROM public.host_groups WHERE id = '00000000-0000-4000-8000-000000000950'), 'Tuesday crew', 'the name is tidied');
SELECT t.lives(format($q$INSERT INTO public.host_group_members (group_id, user_id) VALUES ('00000000-0000-4000-8000-000000000950', %L)$q$, t.id('reg')),
  'a regular is added');
SELECT t.lives(format($q$INSERT INTO public.host_group_members (group_id, user_id) VALUES ('00000000-0000-4000-8000-000000000950', %L)$q$, t.id('reg2')),
  'and another');
SELECT t.throws(format($q$INSERT INTO public.host_group_members (group_id, user_id) VALUES ('00000000-0000-4000-8000-000000000950', %L)$q$, t.id('stranger')),
  'row-level security', 'someone who never played with the host cannot be added');
SELECT t.throws(format($q$INSERT INTO public.host_group_members (group_id, user_id) VALUES ('00000000-0000-4000-8000-000000000950', %L)$q$, t.id('teen')),
  'row-level security', 'nor a minor');
SELECT t.throws($q$INSERT INTO public.host_groups (host_id, name) VALUES (auth.uid(), 'tuesday CREW')$q$, 'duplicate', 'names are unique per host');
SELECT t.throws(format($q$INSERT INTO public.host_groups (host_id, name) VALUES (%L, 'Mine now')$q$, t.id('other')), 'row-level security',
  'nobody creates a group for someone else');
SELECT t.lives($q$UPDATE public.host_groups SET name = 'Tue crew' WHERE id = '00000000-0000-4000-8000-000000000950'$q$, 'the host renames it');
SELECT t.reset();

-- someone who blocked the host first cannot be added
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('blk'), t.id('host'));
SELECT t.as_user(t.id('host'));
SELECT t.throws(format($q$INSERT INTO public.host_group_members (group_id, user_id) VALUES ('00000000-0000-4000-8000-000000000950', %L)$q$, t.id('blk')),
  'row-level security', 'nor someone who blocked the host');
SELECT t.reset();

-- ---- nobody else sees it --------------------------------------------------------------------------------------------------------
SELECT t.as_user(t.id('reg'));
SELECT t.eq((SELECT count(*)::int FROM public.host_groups), 0, 'a person on the list does not see the list');
SELECT t.eq((SELECT count(*)::int FROM public.host_group_members), 0, 'nor that they are on it');
SELECT t.as_user(t.id('other'));
SELECT t.eq((SELECT count(*)::int FROM public.host_groups), 0, 'another member sees nothing');
SELECT t.throws(format($q$INSERT INTO public.host_group_members (group_id, user_id) VALUES ('00000000-0000-4000-8000-000000000950', %L)$q$, t.id('other')),
  'row-level security', 'nor adds to it');
SELECT t.eq(t.changed($q$DELETE FROM public.host_group_members WHERE group_id = '00000000-0000-4000-8000-000000000950'$q$), 0, 'nor empties it');
SELECT t.eq(t.changed($q$DELETE FROM public.host_groups WHERE id = '00000000-0000-4000-8000-000000000950'$q$), 0, 'nor deletes it');
SELECT t.as_anon();
SELECT t.throws($q$SELECT count(*) FROM public.host_group_members$q$, 'permission denied', 'visitors cannot read members');
SELECT t.reset();

-- ---- inviting a list still goes through the rules -----------------------------------------------------------------------------------
SELECT t.as_user(t.id('host'));
SELECT t.eq((SELECT count(*)::int FROM public.host_group_members WHERE group_id = '00000000-0000-4000-8000-000000000950'), 2, 'the host sees two people');
SELECT t.reset();
UPDATE public.privacy_preferences SET allow_regular_invites = false WHERE user_id = t.id('reg2');
SELECT t.as_user(t.id('host'));
SELECT t.lives($q$SELECT public.game_invite_players('next', ARRAY(SELECT user_id FROM public.host_group_members
                   WHERE group_id = '00000000-0000-4000-8000-000000000950'))$q$, 'the host invites the whole list');
SELECT t.reset();
SELECT t.eq((SELECT array_agg(invitee_id = t.id('reg'))::text FROM public.game_invites WHERE game_id = 'next'), '{t}',
  'only the one who still allows it is invited; the one who opted out since is not');

-- ---- removing, deleting, limits -------------------------------------------------------------------------------------------------------
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.changed(format($q$DELETE FROM public.host_group_members WHERE group_id = '00000000-0000-4000-8000-000000000950' AND user_id = %L$q$, t.id('reg2'))), 1,
  'the host removes someone');
SELECT t.eq(t.changed($q$DELETE FROM public.host_groups WHERE id = '00000000-0000-4000-8000-000000000950'$q$), 1, 'and deletes the list');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.host_group_members WHERE group_id = '00000000-0000-4000-8000-000000000950'), 0, 'its members go with it');
SET LOCAL session_replication_role = replica;
INSERT INTO public.host_groups (host_id, name) SELECT t.id('host'), 'g' || i FROM generate_series(1, 20) i;
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('host'));
SELECT t.throws($q$INSERT INTO public.host_groups (host_id, name) VALUES (auth.uid(), 'one more')$q$, 'at most 20 groups', 'at most 20 groups');
SELECT t.reset();

ROLLBACK;
