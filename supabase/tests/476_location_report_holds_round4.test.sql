-- SEC-1, review round 4 (F2): location-disclosure reports never auto-destroy content; holds are reversible, evidence is kept, a moderator decides.
BEGIN;
SELECT t.person('coachadult', 40), t.person('stranger', 33), t.person('modfour', 39), t.person('author', 34), t.person('teamboss', 41);
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modfour'), 'moderator');

-- ===================================================================================================== F2-1: established reporters
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, description, host_snapshot) VALUES
  ('fg', t.id('coachadult'), 'basketball', 'U12 by the river', now() + interval '3 days', 8, 12, 'Gym', 'Riverside', 'Fun run', '{"name":"Coach"}'::jsonb),
  ('fg3', t.id('coachadult'), 'basketball', 'U12 three', now() + interval '3 days', 8, 12, 'Gym', 'Riverside', 'Third', '{"name":"Coach"}'::jsonb),
  ('fg4', t.id('coachadult'), 'basketball', 'U12 four', now() + interval '3 days', 8, 12, 'Gym', 'Riverside', 'Fourth', '{"name":"Coach"}'::jsonb);
SET LOCAL session_replication_role = origin;
SELECT t.person('fresha', 30), t.person('freshb', 30), t.person('unconf', 30), t.person('vetx', 30), t.person('vety', 30);
UPDATE auth.users SET created_at = now() - interval '60 days' WHERE id IN (t.id('vetx'), t.id('vety'), t.id('unconf'));
UPDATE auth.users SET email_confirmed_at = NULL WHERE id = t.id('unconf');
CREATE FUNCTION t.lrep4(who text, g text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.user_reports (reporter_id, reported_id, reason, subject_type, game_id, created_at)
  VALUES (t.id(who), t.id('coachadult'), 'location_disclosed', 'game', g, now() - interval '400 days') $f$;
GRANT EXECUTE ON FUNCTION t.lrep4(text, text) TO authenticated;
SELECT t.as_user(t.id('fresha'));
SELECT t.lives($q$UPDATE public.profiles SET created_at = now() - interval '90 days' WHERE id = auth.uid()$q$, 'a new account tries to back-date its profile');
SELECT t.lrep4('fresha', 'fg');
SELECT t.as_user(t.id('freshb'));
UPDATE public.profiles SET created_at = now() - interval '90 days' WHERE id = auth.uid();
SELECT t.lrep4('freshb', 'fg');
SELECT t.reset();
SELECT t.ok((SELECT created_at > now() - interval '1 day' FROM public.profiles WHERE id = t.id('fresha')), 'F2-1: profiles.created_at cannot be changed by its owner');
SELECT t.eq((SELECT title FROM public.hosted_games WHERE id = 'fg'), 'U12 by the river', 'F2-1: two new accounts with back-dated profiles cannot hold a listing');
SELECT t.as_user(t.id('unconf')); SELECT t.lrep4('unconf', 'fg');
SELECT t.reset();
SELECT t.eq((SELECT title FROM public.hosted_games WHERE id = 'fg'), 'U12 by the river', 'F2-1: an old account without a confirmed email does not count either');
SELECT t.ok((SELECT bool_and(created_at > now() - interval '1 minute') FROM public.user_reports WHERE game_id = 'fg'), 'F2-6: a report''s filing time is the server''s, not the one sent');

-- ===================================================================================================== F2-2: a held report cannot be closed around the hold
SELECT t.as_user(t.id('vetx')); SELECT t.lrep4('vetx', 'fg');
SELECT t.as_user(t.id('vety')); SELECT t.lrep4('vety', 'fg');
SELECT t.reset();
SELECT t.eq((SELECT title FROM public.hosted_games WHERE id = 'fg'), 'Basketball game', 'two established reporters (old, confirmed auth accounts) hold the text');
SELECT t.throws($q$UPDATE public.user_reports SET status = 'resolved' WHERE game_id = 'fg' AND reporter_id = md5('t:vetx')::uuid$q$, 'LOCATION_HOLD_OPEN',
  'F2-2: the report cannot be resolved while the text is held (server code)');
SELECT t.as_service();
SELECT t.throws($q$UPDATE public.user_reports SET status = 'dismissed' WHERE game_id = 'fg'$q$, 'LOCATION_HOLD_OPEN', 'nor dismissed by the service role (the moderation screen)');
SELECT t.reset();
SELECT t.as_user(t.id('modfour'));
SELECT t.throws($q$UPDATE public.user_reports SET status = 'dismissed' WHERE game_id = 'fg'$q$, 'LOCATION_HOLD_OPEN', 'nor by a moderator writing the report directly');
SELECT t.lives($q$UPDATE public.user_reports SET status = 'escalated', created_at = now() - interval '9 days' WHERE game_id = 'fg' AND reporter_id = md5('t:vetx')::uuid$q$, 'escalating stays possible');
SELECT t.reset();
SELECT t.ok((SELECT created_at > now() - interval '1 minute' FROM public.user_reports WHERE game_id = 'fg' AND reporter_id = t.id('vetx')), 'F2-6: and cannot back-date the report');
UPDATE public.user_reports SET status = 'investigating' WHERE game_id = 'fg' AND reporter_id = t.id('vetx');

-- F2-4: the host edits during the hold; restoring keeps the host's edit
SELECT t.as_user(t.id('coachadult'));
SELECT t.lives($q$UPDATE public.hosted_games SET description = 'Bring water.' WHERE id = 'fg'$q$, 'the host writes a new description during the hold');
SELECT t.reset();
SELECT t.as_user(t.id('modfour'));
SELECT t.lives($q$SELECT public.moderator_restore_game_text('fg', 'no location')$q$, 'the moderator restores through the decision function');
SELECT t.reset();
SELECT t.eq((SELECT title || '|' || description || '|' || neighborhood FROM public.hosted_games WHERE id = 'fg'), 'U12 by the river|Bring water.|Riverside',
  'F2-4: held fields come back, the host''s new description is kept');
SELECT t.eq((SELECT count(*)::int FROM public.user_reports WHERE game_id = 'fg' AND status = 'dismissed'), 5, 'and the decision closes the reports');

-- F2-3: a moderator's own removal does not switch off later automatic holds
SELECT t.as_user(t.id('modfour'));
SELECT t.lives($q$SELECT public.moderator_scrub_game_text('fg3', 'seen in review')$q$, 'a moderator removes text on their own');
SELECT t.reset();
SELECT t.ok((SELECT released_at IS NOT NULL AND decision = 'confirmed' AND captured_by = t.id('modfour') AND title = 'U12 three' FROM public.location_report_evidence WHERE game_id = 'fg3'),
  'F2-3: the moderator''s removal is kept as already-decided evidence');
UPDATE public.hosted_games SET title = 'U12 three again', description = 'Rewritten' WHERE id = 'fg3';
SELECT t.as_user(t.id('vetx')); SELECT t.lrep4('vetx', 'fg3');
SELECT t.as_user(t.id('vety')); SELECT t.lrep4('vety', 'fg3');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.location_report_evidence WHERE game_id = 'fg3' AND released_at IS NULL AND title = 'U12 three again'), 1,
  'F2-3: two later established reports still place a hold');
SELECT t.as_user(t.id('modfour'));
SELECT t.lives($q$SELECT public.moderator_confirm_location_hold('fg3', 'confirmed')$q$, 'the moderator confirms the removal');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.user_reports WHERE game_id = 'fg3' AND status = 'actioned'), 2, 'which closes the reports as actioned');
-- a moderator's removal on a game that is held confirms the hold instead of leaving it open
SELECT t.as_user(t.id('vetx')); SELECT t.lrep4('vetx', 'fg4');
SELECT t.as_user(t.id('vety')); SELECT t.lrep4('vety', 'fg4');
SELECT t.as_user(t.id('modfour'));
SELECT t.lives($q$SELECT public.moderator_scrub_game_text('fg4', 'remove')$q$, 'a moderator removes the text of a held game');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.location_report_evidence WHERE game_id = 'fg4' AND released_at IS NULL), 0, 'no hold is left open');
SELECT t.eq((SELECT count(*)::int FROM public.location_report_evidence WHERE game_id = 'fg4' AND decision = 'confirmed' AND title = 'U12 four'), 1, 'and the original stays as evidence');

-- F2-5: team-post removals keep evidence
SELECT t.team('postteam', 'teamboss'); SELECT t.member('postteam', 'author', 'player');
UPDATE public.teams SET age_groups = ARRAY['youth'] WHERE id = 'postteam';
SET LOCAL session_replication_role = replica;
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body) VALUES (t.id('ptext'), 'postteam', t.id('author'), 'recap', 'Meet at 12 Oak St', 'by the gate');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('modfour'));
SELECT t.lives(format($q$SELECT public.moderator_scrub_team_post_text(%L, 'address')$q$, t.id('ptext')), 'a moderator removes a team post''s text');
SELECT t.reset();
SELECT t.eq((SELECT title || '|' || body FROM public.location_report_evidence WHERE post_id = t.id('ptext')), 'Meet at 12 Oak St|by the gate', 'F2-5: the original title and body are kept as evidence');
SELECT t.as_user(t.id('author'));
SELECT t.eq(t.count('SELECT 1 FROM public.location_report_evidence'), 0, 'which the author cannot read');
SELECT t.reset();

ROLLBACK;
