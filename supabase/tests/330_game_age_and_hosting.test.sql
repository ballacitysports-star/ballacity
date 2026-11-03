-- PRIV-2B: strict game age eligibility; adult-only hosting; approval-gated hosting by 16-17 year olds.
BEGIN;
SELECT t.person('host', 35), t.person('adult19', 19), t.person('adult45', 45), t.person('adult30', 30),
       t.person('teen17', 17), t.person('teen14', 14), t.person('kid9', 9), t.person('teenhost', 17),
       t.person('guardian17', 40), t.person('orgadmin', 38), t.person('stranger', 44), t.person('teen17b', 17), t.person('minorAdmin', 17), t.person('guardian14', 41), t.person('guardian9', 42);
SELECT t.guardian('guardian17', 'teen17'); SELECT t.guardian('guardian14', 'teen14'); SELECT t.guardian('guardian9', 'kid9');
SELECT t.team('tm', 'host');
-- unknown age: an account that never gave a birthday
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES (t.id('noage'), 'noage@example.test', now(), '{"display_name":"Noage","account_type":"player"}');

ALTER TABLE public.hosted_games DISABLE TRIGGER validate_hosted_game_age_range;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, status) VALUES
 ('g-18',   t.id('host'), 'basketball', '18+',        now()+interval '2 days', 18,   NULL, 'upcoming'),
 ('g-21-40',t.id('host'), 'basketball', '21-40',      now()+interval '2 days', 21,   40,   'upcoming'),
 ('g-13-17',t.id('host'), 'basketball', '13-17',      now()+interval '2 days', 13,   17,   'upcoming'),
 ('g-8-12', t.id('host'), 'basketball', '8-12',       now()+interval '2 days', 8,    12,   'upcoming'),
 ('g-open', t.id('host'), 'basketball', 'no limit',   now()+interval '2 days', NULL, NULL, 'upcoming');
ALTER TABLE public.hosted_games ENABLE TRIGGER validate_hosted_game_age_range;

-- ---- direct joins (the roster trigger); the older gates (guardian approval etc.) are bypassed so only age is tested
CREATE FUNCTION t.try_join(who text, game text) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN private_sec.player_meets_game_age(game, t.id(who)) THEN 'ok' ELSE 'refused' END $$;
SELECT t.eq(t.try_join('adult19','g-18'), 'ok', '18+ game: an adult is eligible');
SELECT t.eq(t.try_join('teen17','g-18'), 'refused', '18+ game: a 17-year-old is not');
SELECT t.eq(t.try_join('kid9','g-18'), 'refused', '18+ game: a 9-year-old is not');
SELECT t.eq(t.try_join('noage','g-18'), 'refused', '18+ game: unknown age is not');
SELECT t.eq(t.try_join('adult19','g-21-40'), 'refused', '21-40 game: a 19-year-old adult is outside the range');
SELECT t.eq(t.try_join('adult45','g-21-40'), 'refused', '21-40 game: a 45-year-old is outside the range');
SELECT t.eq(t.try_join('adult30','g-21-40'), 'ok', '21-40 game: 30 is inside');
SELECT t.eq(t.try_join('teen14','g-13-17'), 'ok', '13-17 game: a 14-year-old is inside');
SELECT t.eq(t.try_join('kid9','g-13-17'), 'refused', '13-17 game: a 9-year-old is outside');
SELECT t.eq(t.try_join('adult30','g-13-17'), 'refused', '13-17 game: an adult is outside the range');
SELECT t.eq(t.try_join('kid9','g-8-12'), 'ok', '8-12 game: inside');
SELECT t.eq(t.try_join('host','g-8-12'), 'ok', 'the host of an 8-12 game is exempt, as before');
SELECT t.eq(t.try_join('kid9','g-open'), 'ok', 'no limit set: not an age refusal (other gates still apply)');
SELECT t.eq(t.try_join('noage','g-open'), 'ok', 'no limit set: unknown age is not refused by this rule (the DOB gate handles it)');

-- ---- the roster trigger itself, with an APPROVED request present (the old override)
SET LOCAL session_replication_role = replica;
INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key, status, guardian_approved_at) VALUES
 ('g-18', t.id('teen17'), t.id('host'), 'k1', 'approved', now()),
 ('g-18', t.id('adult19'), t.id('host'), 'k1b', 'approved', NULL);
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('teen17'));
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'g-18', t.id('teen17')),
  'AGE_NOT_ELIGIBLE', 'an approved request no longer lets a 17-year-old onto an 18+ roster');
SELECT t.reset();
SELECT t.as_user(t.id('adult19'));
SELECT t.lives(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'g-18', t.id('adult19')), 'an adult joins an 18+ game');
SELECT t.reset();

-- ---- requests are refused up front
SELECT t.as_user(t.id('teen14'));
SELECT t.throws(format($q$INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key) VALUES (%L, %L, %L, 'k2')$q$, 'g-18', t.id('teen14'), t.id('host')),
  'AGE_NOT_ELIGIBLE', 'a 14-year-old cannot even ask to join an 18+ game');
SELECT t.as_user(t.id('adult45'));
SELECT t.throws(format($q$INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key) VALUES (%L, %L, %L, 'k3')$q$, 'g-21-40', t.id('adult45'), t.id('host')),
  'AGE_NOT_ELIGIBLE', 'an out-of-range adult cannot ask to join (the host can no longer approve past the range)');
SELECT t.as_user(t.id('adult30'));
SELECT t.lives(format($q$INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key) VALUES (%L, %L, %L, 'k4')$q$, 'g-21-40', t.id('adult30'), t.id('host')),
  'an in-range player can still ask');
SELECT t.reset();

-- ======================================================================================
-- Hosting by 16-17 year olds: approval required; adult-only games never; under-16 never
-- ======================================================================================
SELECT t.guardian('guardian17', 'teenhost');
INSERT INTO public.trainer_orgs (id, owner_id, name, handle) VALUES (t.id('org'), t.id('orgadmin'), 'Riverside Club', 'riverside');
INSERT INTO public.trainer_orgs (id, owner_id, name, handle) VALUES (t.id('org2'), t.id('host'), 'Other Club', 'otherclub');
SET LOCAL session_replication_role = replica;
INSERT INTO public.org_members (org_id, user_id, role) VALUES (t.id('org'), t.id('teenhost'), 'member');
INSERT INTO public.trainer_org_members (org_id, trainer_id, user_id, role) VALUES (t.id('org'), 'tr-minor-admin', t.id('minorAdmin'), 'admin');
SET LOCAL session_replication_role = origin;

-- no approval: refused
SELECT t.as_user(t.id('teenhost'));
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age) VALUES ('h-none', %L, 'basketball', 't', now()+interval '3 days', 13, 17)$q$, t.id('teenhost')),
  'MINOR_HOST_APPROVAL_REQUIRED', 'a 17-year-old cannot host a youth-inclusive game with no approval');
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date) VALUES ('h-none2', %L, 'basketball', 't', now()+interval '3 days')$q$, t.id('teenhost')),
  'MINOR_HOST_APPROVAL_REQUIRED', 'nor a game with no age limit');
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age) VALUES ('h-18', %L, 'basketball', 't', now()+interval '3 days', 18)$q$, t.id('teenhost')),
  'ADULT_HOST_REQUIRED', 'a 17-year-old cannot host 18+');
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age) VALUES ('h-2140', %L, 'basketball', 't', now()+interval '3 days', 21, 40)$q$, t.id('teenhost')),
  'ADULT_HOST_REQUIRED', 'nor 21-40');
-- the teen cannot mint their own approval
SELECT t.throws(format($q$SELECT public.grant_minor_hosting_approval(%L)$q$, t.id('teenhost')), 'NOT_GUARDIAN', 'a teen cannot approve themself');
SELECT t.throws(format($q$INSERT INTO public.minor_hosting_approvals (kind, minor_id, approver_id, expires_at) VALUES ('guardian', %L, %L, now()+interval '1 day')$q$, t.id('teenhost'), t.id('teenhost')),
  'permission denied', 'nor insert one directly');
SELECT t.reset();

-- strangers and unlinked adults cannot approve
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($q$SELECT public.grant_minor_hosting_approval(%L)$q$, t.id('teenhost')), 'NOT_GUARDIAN', 'a stranger cannot approve');
SELECT t.throws(format($q$SELECT public.grant_org_minor_hosting_approval(%L, %L)$q$, t.id('teenhost'), t.id('org')), 'NOT_ORG_ADMIN', 'a non-admin cannot approve for an org');
SELECT t.reset();
SELECT t.as_user(t.id('guardian14'));
SELECT t.throws(format($q$SELECT public.grant_minor_hosting_approval(%L)$q$, t.id('teenhost')), 'NOT_GUARDIAN', 'another child''s guardian cannot approve');
SELECT t.throws(format($q$SELECT public.grant_minor_hosting_approval(%L)$q$, t.id('teen14')), 'NOT_ELIGIBLE', 'a guardian cannot approve hosting for a 14-year-old (under-16 rule stays)');
SELECT t.reset();
SELECT t.as_user(t.id('orgadmin'));
SELECT t.throws(format($q$SELECT public.grant_org_minor_hosting_approval(%L, %L)$q$, t.id('teen17b'), t.id('org')), 'NOT_MEMBER', 'an org admin cannot approve a non-member');
SELECT t.throws(format($q$SELECT public.grant_org_minor_hosting_approval(%L, %L)$q$, t.id('teen14'), t.id('org')), 'NOT_ELIGIBLE', 'nor a 14-year-old');
SELECT t.reset();

-- guardian approval
SELECT t.as_user(t.id('guardian17'));
SELECT set_config('t.gapp', public.grant_minor_hosting_approval(t.id('teenhost'))::text, false);
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.minor_hosting_approvals WHERE kind='guardian' AND minor_id = t.id('teenhost') AND status='active'), 1, 'the guardian approval is recorded');

-- approval does not override the game's age eligibility: adult-only still refused
SELECT t.as_user(t.id('teenhost'));
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, hosting_approval_id) VALUES ('h-18b', %L, 'basketball', 't', now()+interval '3 days', 18, %L)$q$, t.id('teenhost'), current_setting('t.gapp')::uuid),
  'ADULT_HOST_REQUIRED', 'a guardian approval does not let a 17-year-old host 18+');
-- someone else's approval id is not usable
SELECT t.reset();
SELECT t.as_user(t.id('teen17'));
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, hosting_approval_id) VALUES ('h-steal', %L, 'basketball', 't', now()+interval '3 days', 13, 17, %L)$q$, t.id('teen17'), current_setting('t.gapp')::uuid),
  'MINOR_HOST_APPROVAL_INVALID', 'another teen cannot use that approval');
SELECT t.reset();
-- guardian approval used with a valid youth game
SELECT t.as_user(t.id('teenhost'));
SELECT t.lives(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, hosting_approval_id, host_snapshot) VALUES ('h-ok', %L, 'basketball', 'teen run', now()+interval '3 days', 13, 17, %L, '{"name":"Real Name","username":"realname","avatar":"u.png","rating":4.9}')$q$, t.id('teenhost'), current_setting('t.gapp')::uuid),
  'with an active guardian approval a 17-year-old hosts a youth-inclusive game');
SELECT t.reset();
SELECT t.eq((SELECT game_id FROM public.minor_hosting_approvals WHERE id = current_setting('t.gapp')::uuid), 'h-ok', 'the approval is recorded against that game');
SELECT t.eq((SELECT status FROM public.minor_hosting_approvals WHERE id = current_setting('t.gapp')::uuid), 'used', 'and marked used');
SELECT t.eq((SELECT host_snapshot ->> 'name' FROM public.hosted_games WHERE id = 'h-ok'), 'Youth host', 'the minor host''s public snapshot is neutral');
SELECT t.ok((SELECT NOT (host_snapshot ? 'username') AND NOT (host_snapshot ? 'avatar') AND NOT (host_snapshot ? 'rating') FROM public.hosted_games WHERE id = 'h-ok'), 'with no username, avatar or rating');
-- single use
SELECT t.as_user(t.id('teenhost'));
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, hosting_approval_id) VALUES ('h-reuse', %L, 'basketball', 't', now()+interval '3 days', %L)$q$, t.id('teenhost'), current_setting('t.gapp')::uuid),
  'MINOR_HOST_APPROVAL_INVALID', 'an approval covers one game only');
-- editing the existing game: allowed, cannot re-point at another approval, cannot go 18+
SELECT t.lives($q$UPDATE public.hosted_games SET title = 'renamed' WHERE id = 'h-ok'$q$, 'the teen can edit their approved game');
SELECT t.throws($q$UPDATE public.hosted_games SET min_age = 18, max_age = NULL WHERE id = 'h-ok'$q$, 'ADULT_HOST_REQUIRED', 'but cannot turn it into an 18+ game');
SELECT t.lives($q$UPDATE public.hosted_games SET host_snapshot = '{"name":"Hacker","username":"leak"}' WHERE id = 'h-ok'$q$, 'editing the snapshot is allowed...');
SELECT t.reset();
SELECT t.eq((SELECT host_snapshot ->> 'name' FROM public.hosted_games WHERE id = 'h-ok'), 'Youth host', '...but cannot put the minor''s identity back');

-- expiry and revocation
SELECT t.as_user(t.id('guardian17'));
SELECT set_config('t.gapp2', public.grant_minor_hosting_approval(t.id('teenhost'))::text, false);
SELECT t.throws(format($q$SELECT public.grant_minor_hosting_approval(%L, 9999)$q$, t.id('teenhost')), 'INVALID_DURATION', 'an approval cannot last more than 30 days');
SELECT public.revoke_minor_hosting_approval(current_setting('t.gapp2')::uuid);
SELECT t.reset();
SELECT t.as_user(t.id('teenhost'));
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, hosting_approval_id) VALUES ('h-rev', %L, 'basketball', 't', now()+interval '3 days', %L)$q$, t.id('teenhost'), current_setting('t.gapp2')::uuid),
  'MINOR_HOST_APPROVAL_INVALID', 'a revoked approval cannot be used');
SELECT t.reset();
SELECT t.as_user(t.id('guardian17'));
SELECT set_config('t.gapp3', public.grant_minor_hosting_approval(t.id('teenhost'))::text, false);
SELECT t.reset();
UPDATE public.minor_hosting_approvals SET expires_at = now() - interval '1 minute', created_at = now() - interval '2 days' WHERE id = current_setting('t.gapp3')::uuid;
SELECT t.as_user(t.id('teenhost'));
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, hosting_approval_id) VALUES ('h-exp', %L, 'basketball', 't', now()+interval '3 days', %L)$q$, t.id('teenhost'), current_setting('t.gapp3')::uuid),
  'MINOR_HOST_APPROVAL_INVALID', 'an expired approval cannot be used');
SELECT t.reset();

-- the guardian link is checked at use time
SELECT t.as_user(t.id('guardian17'));
SELECT set_config('t.gapp4', public.grant_minor_hosting_approval(t.id('teenhost'))::text, false);
SELECT t.reset();
UPDATE public.guardian_links SET status = 'revoked' WHERE parent_user_id = t.id('guardian17') AND child_user_id = t.id('teenhost');
SELECT t.as_user(t.id('teenhost'));
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, hosting_approval_id) VALUES ('h-link', %L, 'basketball', 't', now()+interval '3 days', %L)$q$, t.id('teenhost'), current_setting('t.gapp4')::uuid),
  'MINOR_HOST_APPROVAL_INVALID', 'an approval from a guardian whose link was revoked cannot be used');
SELECT t.reset();
UPDATE public.guardian_links SET status = 'active' WHERE parent_user_id = t.id('guardian17') AND child_user_id = t.id('teenhost');

-- revoking an approval that already backs a game closes joins but does not cancel or delete it
SELECT t.as_user(t.id('guardian17'));
SELECT public.revoke_minor_hosting_approval(current_setting('t.gapp')::uuid);
SELECT t.reset();
SELECT t.eq((SELECT joins_closed FROM public.hosted_games WHERE id = 'h-ok'), true, 'revoking closes new joins on the game');
SELECT t.ok((SELECT cancelled_at IS NULL AND hidden_at IS NULL FROM public.hosted_games WHERE id = 'h-ok'), 'but the game is not cancelled or hidden');

-- organization approval
SELECT t.as_user(t.id('orgadmin'));
SELECT set_config('t.oapp', public.grant_org_minor_hosting_approval(t.id('teenhost'), t.id('org'))::text, false);
SELECT t.reset();
SELECT t.as_user(t.id('teenhost'));
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, org_id, hosting_approval_id) VALUES ('o-wrong', %L, 'basketball', 't', now()+interval '3 days', %L, %L)$q$, t.id('teenhost'), t.id('org2'), current_setting('t.oapp')::uuid),
  'MINOR_HOST_APPROVAL_INVALID', 'an org approval only applies under that org');
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, hosting_approval_id) VALUES ('o-none', %L, 'basketball', 't', now()+interval '3 days', %L)$q$, t.id('teenhost'), current_setting('t.oapp')::uuid),
  'MINOR_HOST_APPROVAL_INVALID', 'nor with no org at all');
SELECT t.lives(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, org_id, min_age, max_age, hosting_approval_id, host_snapshot) VALUES ('o-ok', %L, 'basketball', 'club run', now()+interval '3 days', %L, 13, 17, %L, '{"name":"Real Name","username":"realname"}')$q$, t.id('teenhost'), t.id('org'), current_setting('t.oapp')::uuid),
  'with an org administrator''s approval a 17-year-old hosts under that org');
SELECT t.reset();
SELECT t.eq((SELECT approver_id FROM public.minor_hosting_approvals WHERE id = current_setting('t.oapp')::uuid), t.id('orgadmin'), 'the org approval is attributable to the adult administrator');
SELECT t.eq((SELECT host_snapshot ->> 'name' FROM public.hosted_games WHERE id = 'o-ok'), 'Riverside Club', 'the organizer shown publicly is the organization');
-- a 17-year-old org "admin" cannot approve
SELECT t.as_user(t.id('minorAdmin'));
SELECT t.throws(format($q$SELECT public.grant_org_minor_hosting_approval(%L, %L)$q$, t.id('teenhost'), t.id('org')), 'NOT_ORG_ADMIN', 'a minor can never be the approving administrator');
SELECT t.reset();

-- visibility of approvals
SELECT t.as_user(t.id('stranger'));
SELECT t.eq((SELECT count(*)::int FROM public.minor_hosting_approvals), 0, 'strangers see no approvals');
SELECT t.reset();
SELECT t.as_user(t.id('guardian17'));
SELECT t.ok((SELECT count(*) >= 3 FROM public.minor_hosting_approvals), 'the guardian sees their teen''s approvals');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.throws($q$SELECT count(*) FROM public.minor_hosting_approvals$q$, 'permission denied', 'anonymous callers have no access');
SELECT t.reset();

-- under 16 stays blocked, with or without a guardian
SELECT t.as_user(t.id('teen14'));
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date) VALUES ('u16', %L, 'basketball', 't', now()+interval '3 days')$q$, t.id('teen14')),
  'CHILD_CANNOT_HOST', 'a 14-year-old still cannot host');
SELECT t.reset();

-- adults are untouched
SELECT t.as_user(t.id('adult30'));
SELECT t.lives(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, host_snapshot) VALUES ('a-18', %L, 'basketball', 'adult 18+', now()+interval '3 days', 18, '{"name":"Adult Name","username":"adultname","rating":4.2}')$q$, t.id('adult30')), 'an adult hosts 18+');
SELECT t.lives(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, host_snapshot) VALUES ('a-open', %L, 'basketball', 'adult open', now()+interval '3 days', '{"name":"Adult Name","username":"adultname"}')$q$, t.id('adult30')), 'an adult hosts an open game');
SELECT t.reset();
SELECT t.eq((SELECT host_snapshot ->> 'username' FROM public.hosted_games WHERE id = 'a-open'), 'adultname', 'an adult host''s snapshot is unchanged');

-- existing minor-hosted games are preserved: unrelated updates still work, nothing is auto-cancelled
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, status, host_snapshot) VALUES ('legacy', t.id('teenhost'), 'basketball', 'legacy', now()+interval '4 days', 'upcoming', '{"name":"Old Name"}');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('teenhost'));
SELECT t.lives($q$UPDATE public.hosted_games SET description = 'still here' WHERE id = 'legacy'$q$, 'a pre-existing teen-hosted game can still be edited');
SELECT t.reset();
SELECT t.ok((SELECT cancelled_at IS NULL AND hidden_at IS NULL AND status = 'upcoming' FROM public.hosted_games WHERE id = 'legacy'), 'and was not cancelled by the migration''s rules');
SELECT t.eq((SELECT host_snapshot ->> 'name' FROM public.hosted_games WHERE id = 'legacy'), 'Old Name', 'its snapshot was not rewritten');
ROLLBACK;
