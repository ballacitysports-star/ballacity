-- SEC-1, review round 4 (D): a minor host's public organizer is neutral or an AUTHORIZED team or organization display, historical games included.
BEGIN;
SELECT t.person('teen', 17), t.person('teentwo', 16), t.person('coachadult', 40), t.person('orgboss', 45), t.person('stranger', 33),
       t.person('modfour', 39), t.person('superfour', 50), t.person('grownhost', 35), t.person('author', 34), t.person('teamboss', 41);
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modfour'), 'moderator'), (t.id('superfour'), 'superadmin');

-- ===================================================================================================== D-1: team display
SELECT t.team('teenclub', 'teen');                                  -- a team the minor owns (created before they host)
SELECT t.as_user(t.id('teen'));
SELECT t.lives($q$SELECT public.set_listing_hidden('team', 'teenclub', true)$q$, 'the minor hides their own team');
SELECT t.reset();
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, host_snapshot) VALUES
  ('tg', t.id('teen'), 'basketball', 'Teen run', now() + interval '3 days', 13, 17, 'Gym', 'North', '{"name":"Youth host","neutral":true}'::jsonb);
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('teen'));
SELECT t.throws($q$UPDATE public.hosted_games SET team_id = 'teenclub' WHERE id = 'tg'$q$, 'ORGANIZER_DISPLAY_NOT_ALLOWED',
  'D-1: a minor host cannot show a team they own as the organizer (managing it is not enough)');
SELECT t.throws($q$SELECT public.set_listing_hidden('team', 'teenclub', false)$q$, 'MINOR_HOST_TEAM_OWNER',
  'D-1: nor un-hide their own team through set_listing_hidden while they host (the guard sees owner_hidden_at)');
SELECT t.reset();
SELECT t.ok((SELECT hidden_at IS NOT NULL FROM public.teams WHERE id = 'teenclub'), 'the team stays hidden');

-- authorized: an adult owns the team and made the minor a manager or coach
SELECT t.team('adultclub', 'coachadult'); SELECT t.member('adultclub', 'teen', 'manager');
SELECT t.team('coachclub', 'coachadult'); SELECT t.member('coachclub', 'teen', 'coach');
SELECT t.team('playclub', 'coachadult');  SELECT t.member('playclub', 'teen', 'player');
SELECT t.team('minorsclub', 'teentwo');   SELECT t.member('minorsclub', 'teen', 'manager');
SELECT t.as_user(t.id('teen'));
SELECT t.lives($q$UPDATE public.hosted_games SET team_id = 'adultclub' WHERE id = 'tg'$q$, 'an adult-owned team on which the minor is a manager can be shown');
SELECT t.reset();
SELECT t.eq((SELECT host_snapshot ->> 'name' FROM public.hosted_games WHERE id = 'tg'), 'Adultclub', 'and the public organizer is that team');
SELECT t.as_user(t.id('teen'));
SELECT t.lives($q$UPDATE public.hosted_games SET team_id = 'coachclub' WHERE id = 'tg'$q$, 'so can one on which they coach');
SELECT t.throws($q$UPDATE public.hosted_games SET team_id = 'playclub' WHERE id = 'tg'$q$, 'ORGANIZER_DISPLAY_NOT_ALLOWED', 'not one they only play on');
SELECT t.throws($q$UPDATE public.hosted_games SET team_id = 'minorsclub' WHERE id = 'tg'$q$, 'ORGANIZER_DISPLAY_NOT_ALLOWED', 'nor one owned by another minor');
SELECT t.reset();

-- ===================================================================================================== D-2 / D-4: organization display
SELECT t.as_user(t.id('teen'));
SELECT t.throws(format($q$INSERT INTO public.trainer_orgs (id, name, handle, owner_id) VALUES ('00000000-0000-0000-0000-00000000a0a1', 'Teen Org', 'teenorg', %L)$q$, t.id('teen')),
  'MINOR_HOST_ORG_OWNER', 'D-2: a minor host cannot create (own) a visible organization');
SELECT t.reset();
SET LOCAL session_replication_role = replica;        -- a legacy organization the minor owns and administers
INSERT INTO public.trainer_orgs (id, name, handle, owner_id) VALUES ('00000000-0000-0000-0000-00000000a0a2', 'Old Teen Org', 'oldteenorg', t.id('teen'));
INSERT INTO public.trainer_orgs (id, name, handle, owner_id) VALUES ('00000000-0000-0000-0000-00000000a0a3', 'Real Club', 'realclub', t.id('orgboss'));
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, host_snapshot) VALUES
  ('og1', t.id('teen'), 'basketball', 'Club run one', now() + interval '3 days', 13, 17, 'Gym', 'North', '{"name":"Youth host","neutral":true}'::jsonb),
  ('og2', t.id('teen'), 'basketball', 'Club run two', now() + interval '4 days', 13, 17, 'Gym', 'North', '{"name":"Youth host","neutral":true}'::jsonb);
INSERT INTO public.minor_hosting_approvals (id, kind, minor_id, approver_id, org_id, status, game_id, expires_at, used_at) VALUES
  ('00000000-0000-0000-0000-00000000b0b1', 'organization', t.id('teen'), t.id('orgboss'), '00000000-0000-0000-0000-00000000a0a3', 'used', 'og1', now() + interval '5 days', now()),
  ('00000000-0000-0000-0000-00000000b0b2', 'organization', t.id('teen'), t.id('orgboss'), '00000000-0000-0000-0000-00000000a0a3', 'used', 'og2', now() - interval '1 hour', now() - interval '2 days');
UPDATE public.hosted_games SET hosting_approval_id = '00000000-0000-0000-0000-00000000b0b1' WHERE id = 'og1';
UPDATE public.hosted_games SET hosting_approval_id = '00000000-0000-0000-0000-00000000b0b2' WHERE id = 'og2';
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('teen'));
SELECT t.throws($q$UPDATE public.hosted_games SET org_id = '00000000-0000-0000-0000-00000000a0a2' WHERE id = 'tg'$q$, 'ORGANIZER_DISPLAY_NOT_ALLOWED',
  'D-2: administering (owning) an organization does not let a minor show it');
SELECT t.throws($q$UPDATE public.hosted_games SET org_id = '00000000-0000-0000-0000-00000000a0a3' WHERE id = 'tg'$q$, 'ORGANIZER_DISPLAY_NOT_ALLOWED',
  'D-4: an approval the organization gave for another game does not apply to this one');
SELECT t.throws($q$UPDATE public.hosted_games SET org_id = '00000000-0000-0000-0000-00000000a0a3' WHERE id = 'og2'$q$, 'ORGANIZER_DISPLAY_NOT_ALLOWED',
  'D-4: an expired approval, even for this game, does not');
SELECT t.lives($q$UPDATE public.hosted_games SET org_id = '00000000-0000-0000-0000-00000000a0a3' WHERE id = 'og1'$q$,
  'the organization''s current approval for this game does');
SELECT t.reset();
SELECT t.eq((SELECT host_snapshot ->> 'name' FROM public.hosted_games WHERE id = 'og1'), 'Real Club', 'and the public organizer is that organization');

-- ===================================================================================================== D-3: historical snapshots (guarded batch, not run by the migration)
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, host_snapshot, team_id, completed_at) VALUES
  ('hist1', t.id('teen'), 'basketball', 'Old run', now() - interval '60 days', 13, 17, 'Gym', 'North', '{"name":"Real Teen Name","username":"realteen","avatar":"x.png"}'::jsonb, NULL, now() - interval '59 days'),
  ('hist2', t.id('teen'), 'basketball', 'Old club run', now() - interval '40 days', 13, 17, 'Gym', 'North', '{"name":"Teenclub","neutral":true}'::jsonb, 'teenclub', NULL),
  ('adulthist', t.id('grownhost'), 'basketball', 'Adult run', now() - interval '30 days', 18, NULL, 'Gym', 'North', '{"name":"Grown Host","username":"grown"}'::jsonb, NULL, NULL);
SET LOCAL session_replication_role = origin;
SELECT t.eq((SELECT host_snapshot ->> 'name' FROM public.hosted_games WHERE id = 'hist1'), 'Real Teen Name', 'a historical game still carries the minor''s name (nothing rewrote it at apply time)');
SELECT t.eq(has_function_privilege('authenticated', 'public.neutralize_existing_minor_host_snapshots(integer,boolean,boolean)', 'EXECUTE'), false, 'the batch is not callable by signed-in accounts');
SELECT t.eq(has_function_privilege('anon', 'public.neutralize_existing_minor_host_snapshots(integer,boolean,boolean)', 'EXECUTE'), false, 'nor anonymously');
SELECT t.eq(has_function_privilege('service_role', 'public.neutralize_existing_minor_host_snapshots(integer,boolean,boolean)', 'EXECUTE'), true, 'the service role can run it');
SELECT set_config('request.jwt.claim.sub', t.id('stranger')::text, true);
SELECT t.throws($q$SELECT public.neutralize_existing_minor_host_snapshots(10, false)$q$, 'SUPERADMIN_ONLY', 'a caller who is not a superadmin is refused even with execute');
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('t.dry', public.neutralize_existing_minor_host_snapshots(100)::text, true);
SELECT t.ok((current_setting('t.dry')::jsonb ->> 'dry_run')::boolean, 'the default is a dry run');
SELECT t.ok((current_setting('t.dry')::jsonb ->> 'snapshots_pending')::int >= 2, 'which counts the named historical snapshots');
SELECT t.ok((current_setting('t.dry')::jsonb ->> 'team_displays_pending')::int >= 1, 'and the unauthorized team display');
SELECT t.eq((SELECT host_snapshot ->> 'name' FROM public.hosted_games WHERE id = 'hist1'), 'Real Teen Name', 'a dry run changes nothing');
SELECT set_config('request.jwt.claim.sub', t.id('superfour')::text, true);
SELECT set_config('t.run', public.neutralize_existing_minor_host_snapshots(1, false)::text, true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT t.eq((current_setting('t.run')::jsonb ->> 'updated')::int, 1, 'a superadmin runs it in batches (one row here)');
SELECT set_config('t.run', public.neutralize_existing_minor_host_snapshots(1000, false)::text, true);
SELECT t.eq((current_setting('t.run')::jsonb ->> 'failed')::int, 0, 'the service role runs the rest without failures');
SELECT t.eq((current_setting('t.run')::jsonb ->> 'snapshots_pending')::int, 0, 'nothing is pending afterwards');
SELECT t.eq((current_setting('t.run')::jsonb ->> 'team_displays_pending')::int, 0, 'no unauthorized display either');
SELECT t.eq((SELECT host_snapshot FROM public.hosted_games WHERE id = 'hist1'), '{"name":"Youth host","neutral":true}'::jsonb, 'the historical game now shows a neutral organizer');
SELECT t.ok((SELECT team_id IS NULL AND host_snapshot ->> 'name' = 'Youth host' FROM public.hosted_games WHERE id = 'hist2'), 'the minor''s own team is detached from the historical game');
SELECT t.ok((SELECT completed_at IS NOT NULL AND title = 'Old run' FROM public.hosted_games WHERE id = 'hist1'), 'the game itself is otherwise untouched');
SELECT t.eq((SELECT host_snapshot ->> 'name' FROM public.hosted_games WHERE id = 'og1'), 'Real Club', 'an authorized organization display is kept');
SELECT t.eq((SELECT host_snapshot ->> 'username' FROM public.hosted_games WHERE id = 'adulthist'), 'grown', 'an adult host''s games are not touched');

-- going forward: a person who stops being a confirmed adult is neutralized on every game at once
SELECT set_config('openrun.birthday_review', 'on', true);
UPDATE public.profile_birthdays SET birthday = (current_date - make_interval(years => 17, months => 1))::date WHERE user_id = t.id('grownhost');
SELECT set_config('openrun.birthday_review', '', true);
SELECT t.eq(public.age_cohort_of(t.id('grownhost')), 'teen_16_17', 'a corrected birthday makes the host a minor');
SELECT t.eq((SELECT host_snapshot FROM public.hosted_games WHERE id = 'adulthist'), '{"name":"Youth host","neutral":true}'::jsonb, 'and their game''s snapshot is neutral at once');

ROLLBACK;
