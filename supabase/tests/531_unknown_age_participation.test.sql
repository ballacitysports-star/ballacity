-- SEC-7 item 1: unknown age is not "not a minor". An account without a declared date of birth (a legacy account: sign-up always asks for one)
-- cannot join a game or a team, whoever writes the row, until it declares an age. Adults and verified minors are unchanged.
BEGIN;
SELECT t.person('coach', 38), t.person('adultp', 30), t.person('teen', 15), t.person('gpar', 44), t.person('gunk', 45), t.person('orgboss', 40);
-- legacy accounts: signed up before the age gate, no birthday (age cohort 'unknown')
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES
  (t.id('unk'), 'unk@example.test', now(), '{"display_name":"Unk","account_type":"player"}'::jsonb),
  (t.id('unkkid'), 'unkkid@example.test', now(), '{"display_name":"Unkkid","account_type":"player"}'::jsonb);
SELECT t.eq(public.age_cohort_of(t.id('unk')), 'unknown', 'setup: an account with no birthday has an unknown age');
SELECT t.guardian('gpar', 'teen');
INSERT INTO public.guardian_links (parent_user_id, child_user_id, relationship, status, verified_at)
VALUES (t.id('gunk'), t.id('unkkid'), 'parent', 'active', now());
SELECT t.team('squad', 'coach');

-- ======================================================================================= team invitations
SELECT t.as_user(t.id('coach'));
SELECT set_config('t.inv_unk',   public.team_invite_player('squad', t.id('unk'))::text, true);
SELECT set_config('t.inv_kid',   public.team_invite_player('squad', t.id('unkkid'))::text, true);
SELECT set_config('t.inv_adult', public.team_invite_player('squad', t.id('adultp'))::text, true);
SELECT set_config('t.inv_teen',  public.team_invite_player('squad', t.id('teen'))::text, true);
SELECT t.reset();

SELECT t.as_user(t.id('unk'));
SELECT t.throws(format('SELECT public.team_respond_invite(%L, true)', current_setting('t.inv_unk')), 'AGE_VERIFICATION_REQUIRED',
  'an unknown-age account cannot accept a team invitation');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_members WHERE team_id = 'squad' AND user_id = t.id('unk')), 0, 'and is not on the roster');

SELECT t.as_user(t.id('unkkid'));
SELECT t.throws(format('SELECT public.team_respond_invite(%L, true)', current_setting('t.inv_kid')), 'AGE_VERIFICATION_REQUIRED',
  'nor can an unknown-age account with a guardian link (it used to skip the guardian step as "not a minor")');
SELECT t.as_user(t.id('gunk'));
SELECT t.throws(format('SELECT public.guardian_approve_team_invite(%L, true)', current_setting('t.inv_kid')), 'AGE_VERIFICATION_REQUIRED',
  'and its guardian cannot approve it onto the team before an age is declared');
SELECT t.reset();

SELECT t.as_user(t.id('adultp'));
SELECT t.eq(public.team_respond_invite(current_setting('t.inv_adult')::uuid, true), 'accepted', 'an adult accepts as before');
SELECT t.as_user(t.id('teen'));
SELECT t.throws(format('SELECT public.team_respond_invite(%L, true)', current_setting('t.inv_teen')), 'GUARDIAN_APPROVAL_REQUIRED',
  'a verified minor still needs the guardian');
SELECT t.as_user(t.id('gpar'));
SELECT t.lives(format('SELECT public.guardian_approve_team_invite(%L, true)', current_setting('t.inv_teen')), 'and the guardian approves as before');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_members WHERE team_id = 'squad' AND user_id IN (t.id('adultp'), t.id('teen'))), 2,
  'both are on the roster');

-- declining stays open; after declaring an age the legacy account can join
SELECT t.as_user(t.id('unk'));
SELECT t.lives($q$SELECT public.set_my_birthday((current_date - interval '25 years')::date)$q$, 'the legacy account declares its date of birth');
SELECT t.eq(public.team_respond_invite(current_setting('t.inv_unk')::uuid, true), 'accepted', 'and then joins the team');
SELECT t.reset();

-- ======================================================================================= games
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, max_players) VALUES
  ('yg', t.id('coach'), 'basketball', 'Youth run', now() + interval '2 days', 8, 17, 'Gym', 'North', 20),
  ('og', t.id('coach'), 'basketball', 'Open run', now() + interval '2 days', NULL, NULL, 'Gym', 'North', 20);
SELECT t.ok(NOT public.child_game_participation_allowed(t.id('unkkid')), 'child_game_participation_allowed is false for an unknown age');
SELECT t.ok(public.child_game_participation_allowed(t.id('adultp')), 'and true for an adult');

-- a server path (the service role rostering a paid player) used to skip the age check: it applied only to the player's own write
SELECT t.as_service();
SELECT t.throws(format($q$INSERT INTO public.game_participants (game_id, user_id) VALUES ('yg', %L)$q$, t.id('unkkid')), 'AGE_VERIFICATION_REQUIRED',
  'the service role cannot roster an unknown-age player');
SELECT t.throws(format($q$INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key) VALUES ('yg', %L, %L, 'k-unk')$q$, t.id('unkkid'), t.id('coach')),
  'AGE_VERIFICATION_REQUIRED', 'nor file a join request for one');
SELECT t.throws(format($q$INSERT INTO public.game_participants (game_id, user_id) VALUES ('og', %L)$q$, t.id('unkkid')), 'AGE_VERIFICATION_REQUIRED',
  'or onto an all-ages game');
SELECT t.lives(format($q$INSERT INTO public.game_participants (game_id, user_id) VALUES ('og', %L)$q$, t.id('adultp')), 'an adult is rostered as before');
SELECT t.lives(format($q$INSERT INTO public.game_participants (game_id, user_id) VALUES ('yg', %L)$q$, t.id('teen')), 'and so is a verified minor');
SELECT t.reset();

-- ======================================================================================= organizations
INSERT INTO public.trainer_orgs (id, name, handle, owner_id) VALUES ('00000000-0000-0000-0000-0000000005a1', 'Org', 'orgsevena', t.id('orgboss'));
SELECT t.as_user(t.id('orgboss'));
SELECT t.throws(format($q$INSERT INTO public.org_members (org_id, user_id) VALUES ('00000000-0000-0000-0000-0000000005a1', %L)$q$, t.id('unkkid')),
  'row-level security', 'an organization administrator cannot add an unknown-age account');
SELECT t.lives(format($q$INSERT INTO public.org_members (org_id, user_id) VALUES ('00000000-0000-0000-0000-0000000005a1', %L)$q$, t.id('adultp')),
  'but adds an adult as before');
SELECT t.throws(format($q$INSERT INTO public.org_members (org_id, user_id) VALUES ('00000000-0000-0000-0000-0000000005a1', %L)$q$, t.id('teen')),
  'row-level security', 'and still not a minor');
SELECT t.reset();

ROLLBACK;
