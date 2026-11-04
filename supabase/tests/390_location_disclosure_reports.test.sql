-- G6: disclosures the detector cannot identify are handled by people. Two independent reports of a youth-inclusive game remove its free
-- text automatically; a moderator can do it on one report; one report never changes a listing; reporters are not shown to the host.
BEGIN;
SELECT t.person('host', 35), t.person('rep1', 30), t.person('rep2', 31), t.person('teenrep', 16), t.person('kidrep', 10),
       t.person('kidguardian', 41), t.person('modone', 38), t.person('stranger', 28), t.person('adminone', 45), t.person('adultmgr', 37);
SELECT t.guardian('kidguardian', 'kidrep');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'moderator'), (t.id('adminone'), 'admin');
ALTER TABLE public.hosted_games DISABLE TRIGGER validate_hosted_game_age_range;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, description, game_rules) VALUES
  ('yg', t.id('host'), 'basketball', 'U12 run behind the green gate', now()+interval '3 days', 8, 12, 'Old Mill Gym, 4 Dam Rd', 'by the creek', 'Park in the lot across from the green gate.', 'Bring a ball'),
  ('yg2', t.id('host'), 'basketball', 'U12 other', now()+interval '3 days', 8, 12, 'Gym, 1 A St', 'North', 'Directions in a paraphrase', NULL),
  ('ag', t.id('host'), 'basketball', 'Adults at the old mill', now()+interval '3 days', 21, 40, 'Old Mill Gym, 4 Dam Rd', 'by the creek', 'Park across from the green gate.', NULL);

CREATE FUNCTION t.rep(g text, who text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('INSERT INTO public.user_reports (reporter_id, reported_id, reason, subject_type, game_id, details) VALUES (%L, %L, ''location_disclosed'', ''game'', %L, ''shows where it is'')',
                 t.id(who), t.id('host'), g);
  RETURN 'ok';
END $$;
GRANT EXECUTE ON FUNCTION t.rep(text, text) TO authenticated;

-- ---- reports are accepted from every cohort, and one report changes nothing
SELECT t.as_user(t.id('rep1'));
SELECT t.eq(t.rep('yg', 'rep1'), 'ok', 'an adult can report that a listing reveals a location');
SELECT t.reset();
SELECT t.eq((SELECT title FROM public.hosted_games WHERE id = 'yg'), 'U12 run behind the green gate', 'one report never changes a listing (no one can blank a rival''s game)');
SELECT t.eq((SELECT status FROM public.user_reports WHERE reporter_id = t.id('rep1') AND game_id = 'yg'), 'new', 'the report waits for a moderator');
SELECT t.as_user(t.id('rep1'));
SELECT t.eq(t.rep('yg', 'rep1'), 'ok', 'the same person reporting again');
SELECT t.reset();
SELECT t.eq((SELECT title FROM public.hosted_games WHERE id = 'yg'), 'U12 run behind the green gate', 'is still one reporter: nothing changes');

-- ---- two independent reporters (a teen and a child's report count too)
SELECT t.as_user(t.id('teenrep'));
SELECT t.eq(t.rep('yg', 'teenrep'), 'ok', 'a teen can report');
SELECT t.reset();
SELECT t.eq((SELECT title FROM public.hosted_games WHERE id = 'yg'), 'Basketball game', 'a second independent reporter removes the listing text');
SELECT t.ok((SELECT description = '' AND neighborhood = '' AND game_rules IS NULL AND equipment = '{}' FROM public.hosted_games WHERE id = 'yg'), 'description, neighborhood, rules and equipment are cleared');
SELECT t.ok((SELECT host_id = t.id('host') AND sport = 'basketball' AND min_age = 8 AND max_age = 12 AND cancelled_at IS NULL FROM public.hosted_games WHERE id = 'yg'), 'the game itself (host, sport, ages, not cancelled) is untouched');
SELECT t.eq((SELECT count(*)::int FROM public.user_reports WHERE game_id = 'yg' AND status = 'actioned'), 3, 'all open reports are marked actioned');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('host') AND type = 'moderation_notice' AND link = '/games/yg'), 1, 'the host is told, without the reporters'' names');
SELECT t.ok((SELECT NOT (title || coalesce(body, '')) ILIKE '%creek%' FROM public.notifications WHERE user_id = t.id('host') AND type = 'moderation_notice'), 'and without repeating the text');
SELECT t.eq((SELECT count(*)::int FROM public.admin_audit_log WHERE action = 'location_disclosure_autoscrub' AND target_id = 'yg'), 1, 'the automatic removal is audited');
SELECT t.ok((SELECT NOT (coalesce(reason, '') || metadata::text || coalesce(before::text, '') || coalesce(after::text, '')) ILIKE '%creek%' FROM public.admin_audit_log WHERE action = 'location_disclosure_autoscrub' AND target_id = 'yg'), 'and the audit row holds no copy of the removed text');
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.count('SELECT 1 FROM public.user_reports'), 0, 'the host cannot read the reports (nor who made them)');
SELECT t.throws($q$UPDATE public.hosted_games SET description = 'Meet at 4 Dam Rd' WHERE id = 'yg'$q$, 'LOCATION_IN_PUBLIC_TEXT', 'the host rewriting it with the address is refused by the PRIV-2D guard');
SELECT t.lives($q$UPDATE public.hosted_games SET description = 'Come early to warm up.', neighborhood = 'Riverside' WHERE id = 'yg'$q$, 'but can describe the area again');
SELECT t.reset();

-- ---- an adult-only game is not touched; a game needs two different people
SELECT t.as_user(t.id('rep1')); SELECT t.eq(t.rep('ag', 'rep1'), 'ok', 'report 1 of an adult-only game');
SELECT t.as_user(t.id('rep2')); SELECT t.eq(t.rep('ag', 'rep2'), 'ok', 'report 2 of an adult-only game');
SELECT t.as_user(t.id('rep1')); SELECT t.eq(t.rep('yg2', 'rep1'), 'ok', 'one report of another youth game');
SELECT t.reset();
SELECT t.eq((SELECT title FROM public.hosted_games WHERE id = 'ag'), 'Adults at the old mill', 'an enforced adult-only game is left alone (its location is public anyway)');
SELECT t.eq((SELECT description FROM public.hosted_games WHERE id = 'yg2'), 'Directions in a paraphrase', 'a single report of another game changes nothing');

-- ---- moderator tools
SELECT t.as_user(t.id('stranger'));
SELECT t.throws($q$SELECT public.moderator_scrub_game_text('yg2', 'x')$q$, 'Moderators only', 'a member cannot scrub a listing');
SELECT t.throws($q$SELECT * FROM public.list_team_posts_with_location_text()$q$, 'Moderators only', 'nor scan team posts');
SELECT t.as_anon();
SELECT t.throws($q$SELECT public.moderator_scrub_game_text('yg2', 'x')$q$, 'permission denied', 'an anonymous caller is refused');
SELECT t.as_user(t.id('modone'));
SELECT t.lives($q$SELECT public.moderator_scrub_game_text('yg2', 'reports from families')$q$, 'a moderator can scrub on one report');
SELECT t.reset();
SELECT t.ok((SELECT title = 'Basketball game' AND description = '' FROM public.hosted_games WHERE id = 'yg2'), 'the text is removed');
SELECT t.eq((SELECT count(*)::int FROM public.user_reports WHERE game_id = 'yg2' AND status = 'actioned' AND reviewed_by = t.id('modone')), 1, 'the open report is closed by that moderator');
SELECT t.eq((SELECT actor_id FROM public.admin_audit_log WHERE action = 'location_disclosure_scrub' AND target_id = 'yg2'), t.id('modone'), 'and the action is audited with the moderator');
SELECT t.as_user(t.id('adminone'));
SELECT t.lives($q$SELECT public.moderator_scrub_game_text('ag', 'admin')$q$, 'an administrator can too');
SELECT t.reset();

-- ---- team posts
SELECT t.team('kids', 'adultmgr'); SELECT t.team('grown', 'adultmgr');
UPDATE public.teams SET age_groups = ARRAY['youth'] WHERE id = 'kids';
UPDATE public.teams SET age_groups = ARRAY['adult'] WHERE id = 'grown';
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body) VALUES
  (t.id('tp1'), 'kids', t.id('adultmgr'), 'announcement', 'Practice at 12 Oak St', 'See you there'),
  (t.id('tp2'), 'kids', t.id('adultmgr'), 'announcement', 'Great week', 'Thanks everyone'),
  (t.id('tp3'), 'grown', t.id('adultmgr'), 'announcement', 'Meet at 1 Main St', 'adult team');
SELECT t.as_user(t.id('modone'));
SELECT t.ok((SELECT count(*) FROM public.list_team_posts_with_location_text() WHERE post_id = t.id('tp1') AND field = 'title' AND reason = 'street_address') = 1, 'a moderator sees the youth team post that gives an address');
SELECT t.ok((SELECT count(*) FROM public.list_team_posts_with_location_text() WHERE post_id IN (t.id('tp2'), t.id('tp3'))) = 0, 'and not a clean post or an adult team''s');
SELECT t.lives(format($q$SELECT public.moderator_scrub_team_post_text(%L, 'address in title')$q$, t.id('tp1')), 'a moderator can scrub it');
SELECT t.reset();
SELECT t.ok((SELECT title = 'Team update' AND body = '' FROM public.team_posts WHERE id = t.id('tp1')), 'the text is removed');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($q$SELECT public.moderator_scrub_team_post_text(%L)$q$, t.id('tp2')), 'Moderators only', 'a member cannot');
SELECT t.reset();

-- ---- grants
SELECT t.eq(has_function_privilege('anon', 'public.handle_location_disclosure_report()', 'EXECUTE'), false, 'the trigger function is not callable by API roles');
SELECT t.eq(has_function_privilege('authenticated', 'private_sec.scrub_game_public_text(text)', 'EXECUTE'), false, 'nor is the scrub helper');
ROLLBACK;
