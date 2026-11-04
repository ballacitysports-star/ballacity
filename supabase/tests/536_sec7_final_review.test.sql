-- SEC-7 final review (780eaf8f) corrections: findings 1, 4, 5, 6, 8, 9, 10 and 11 (2 is in 534, 3 in 535, 7 in vitest).
BEGIN;
SELECT t.person('ta', 14), t.person('tb', 14), t.person('ga', 41), t.person('gb', 42),
       t.person('sa', 14), t.person('sc', 16), t.person('ka', 10), t.person('su', 14), t.person('gs', 43), t.person('gsc', 44), t.person('gk', 45),
       t.person('grown', 30), t.person('stranger', 35), t.person('boss', 40), t.person('blk', 31), t.person('adu', 32), t.person('mino', 14),
       t.person('gmi', 46), t.person('legacy', 15), t.person('oldadult', 33), t.person('tm', 15), t.person('gtm', 47), t.person('modx', 39),
       t.person('host', 36), t.person('minorhost', 15), t.person('gmh', 48);
SELECT t.guardian('ga', 'ta'); SELECT t.guardian('gb', 'tb'); SELECT t.guardian('gs', 'sa'); SELECT t.guardian('gsc', 'sc');
SELECT t.guardian('gk', 'ka'); SELECT t.guardian('gmi', 'mino'); SELECT t.guardian('gtm', 'tm'); SELECT t.guardian('gmh', 'minorhost');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modx'), 'moderator');

-- ============================================================================ (1) the recipient's guardian revoking ends a peer request
UPDATE public.child_controls SET messaging = 'peers' WHERE child_user_id IN (t.id('ta'), t.id('tb'));
SET LOCAL session_replication_role = replica;
INSERT INTO public.player_availabilities (id, user_id, sports, skill_level, recurring_days, city, travel_radius_km, status, time_slots) VALUES
  ('00000000-0000-0000-0000-0000000005b1', t.id('tb'), ARRAY['Basketball'], 'All Levels', ARRAY['Tue'], 'Atlanta', 10, 'open', '[]'::jsonb),
  ('00000000-0000-0000-0000-0000000005b2', t.id('sc'), ARRAY['Basketball'], 'All Levels', ARRAY['Tue'], 'Atlanta', 10, 'open', '[]'::jsonb),
  ('00000000-0000-0000-0000-0000000005b3', t.id('grown'), ARRAY['Basketball'], 'All Levels', ARRAY['Tue'], 'Atlanta', 10, 'open', '[]'::jsonb);
SET LOCAL session_replication_role = origin;
CREATE FUNCTION t.ask(who text, avail text, other text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message)
  VALUES (t.id(who), t.id(other), ('00000000-0000-0000-0000-0000000005' || avail)::uuid, 'contact', 'hello') $f$;
GRANT EXECUTE ON FUNCTION t.ask(text, text, text) TO authenticated;
CREATE FUNCTION t.open_req(who text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM public.availability_contact_requests WHERE from_user_id = t.id(who) AND status = 'awaiting_guardian' ORDER BY created_at DESC LIMIT 1 $f$;

SELECT t.as_user(t.id('ta'));
SELECT t.lives($q$SELECT t.ask('ta', 'b1', 'tb')$q$, '(1) a 14 year old asks another 14 year old whose guardian allows peers');
SELECT t.reset();
UPDATE public.guardian_links SET status = 'revoked' WHERE parent_user_id = t.id('gb') AND child_user_id = t.id('tb');
SELECT t.as_user(t.id('ga'));
SELECT t.eq(public.guardian_decide_contact_request(t.open_req('ta'), true), 'blocked',
  '(1) the recipient''s guardian has revoked: the sender''s guardian''s approval is refused');
SELECT t.reset();
SELECT t.eq((SELECT status FROM public.availability_contact_requests WHERE from_user_id = t.id('ta') ORDER BY created_at DESC LIMIT 1), 'withdrawn',
  '(1) and the request is withdrawn');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('tb') AND type = 'contact_request'), 0, '(1) the recipient is told nothing');

-- accepted first, then revoked
UPDATE public.guardian_links SET status = 'active' WHERE parent_user_id = t.id('gb') AND child_user_id = t.id('tb');
SELECT t.as_user(t.id('ta'));
SELECT t.lives($q$SELECT t.ask('ta', 'b1', 'tb')$q$, '(1) asked again with both links active');
SELECT t.as_user(t.id('ga'));
SELECT t.eq(public.guardian_decide_contact_request(t.open_req('ta'), true), 'approved', '(1) control: the sender''s guardian approves');
SELECT t.as_user(t.id('tb'));
SELECT t.eq(t.changed($q$UPDATE public.availability_contact_requests SET status = 'accepted' WHERE from_user_id = t.id('ta') AND status = 'pending'$q$), 1,
  '(1) the recipient accepts');
SELECT t.reset();
SELECT t.ok(public.minor_messaging_block(t.id('ta'), t.id('tb')) IS NULL, '(1) control: with both links active the request is a context');
SELECT t.ok(public.can_notify(t.id('ta'), t.id('tb')), '(1) control: and notifications are allowed');
SELECT t.as_user(t.id('ta'));
SELECT t.lives(format('SELECT public.create_direct_conversation(%L)', t.id('tb')), '(1) control: the DM opens');
SELECT t.lives($q$INSERT INTO public.messages (conversation_id, sender_id, body)
  SELECT a.conversation_id, t.id('ta'), 'hi' FROM public.conversation_participants a JOIN public.conversation_participants b ON b.conversation_id = a.conversation_id
   WHERE a.user_id = t.id('ta') AND b.user_id = t.id('tb') LIMIT 1$q$, '(1) control: and a message is sent');
SELECT t.reset();
UPDATE public.guardian_links SET status = 'revoked' WHERE parent_user_id = t.id('gb') AND child_user_id = t.id('tb');
SELECT t.ok(public.minor_messaging_block(t.id('ta'), t.id('tb')) IS NOT NULL, '(1) after the recipient''s guardian revokes the context is gone');
SELECT t.as_user(t.id('ta'));
SELECT t.throws($q$INSERT INTO public.messages (conversation_id, sender_id, body)
  SELECT a.conversation_id, t.id('ta'), 'still there?' FROM public.conversation_participants a JOIN public.conversation_participants b ON b.conversation_id = a.conversation_id
   WHERE a.user_id = t.id('ta') AND b.user_id = t.id('tb') LIMIT 1$q$, 'MINOR_MESSAGING_BLOCKED', '(1) the next message is refused');
SELECT t.reset();
SELECT t.ok(NOT public.can_notify(t.id('ta'), t.id('tb')), '(1) and notifications stop');
-- the recipient's controls moving off 'peers' end it as well
UPDATE public.guardian_links SET status = 'active' WHERE parent_user_id = t.id('gb') AND child_user_id = t.id('tb');
SELECT t.ok(public.minor_messaging_block(t.id('ta'), t.id('tb')) IS NULL, '(1) setup: the link is back');
UPDATE public.child_controls SET messaging = 'teammates' WHERE child_user_id = t.id('tb');
SELECT t.ok(NOT private_sec.messaging_connection(t.id('ta'), t.id('tb')), '(1) a recipient no longer on peers ends the request context');
UPDATE public.child_controls SET messaging = 'peers' WHERE child_user_id = t.id('tb');

-- ======================================================================= (6) a minor caller learns nothing about the other person's age
CREATE FUNCTION t.dm_code(other text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM public.create_direct_conversation(t.id(other));
  RETURN 'allowed';
EXCEPTION WHEN OTHERS THEN
  RETURN COALESCE(substring(SQLERRM from 'MINOR_MESSAGING_BLOCKED:[a-z_]+:[a-z]+'), SQLERRM);
END $f$;
GRANT EXECUTE ON FUNCTION t.dm_code(text) TO authenticated;
-- the guardians allow peers (the default, guardian only, would refuse everything with the caller's own control)
UPDATE public.child_controls SET messaging = 'peers' WHERE child_user_id IN (t.id('sa'), t.id('sc'), t.id('ka'));
SELECT t.as_user(t.id('sa'));
SELECT t.eq(t.dm_code('grown'), 'MINOR_MESSAGING_BLOCKED:needs_connection:self', '(6) a 14 year old messaging an adult');
SELECT t.eq(t.dm_code('sc'), 'MINOR_MESSAGING_BLOCKED:needs_connection:self', '(6) and messaging a 16 year old get the same code');
SELECT t.throws($q$SELECT t.ask('sa', 'b2', 'sc')$q$, 'MINOR_MESSAGING_BLOCKED:needs_connection:self',
  '(6) a contact request across age bands gives the same self code (not a reason about the other)');
SELECT t.as_user(t.id('ka'));
SELECT t.eq(t.dm_code('grown'), 'MINOR_MESSAGING_BLOCKED:needs_connection:self', '(6) an under-13 messaging an adult');
SELECT t.eq(t.dm_code('sc'), 'MINOR_MESSAGING_BLOCKED:needs_connection:self', '(6) and messaging a 16 year old get the same code');
SELECT t.as_user(t.id('su'));
SELECT t.eq(t.dm_code('grown'), 'MINOR_MESSAGING_BLOCKED:needs_guardian_link:self', '(6) an unlinked 14 year old is told to link a guardian (adult target)');
SELECT t.eq(t.dm_code('sc'), 'MINOR_MESSAGING_BLOCKED:needs_guardian_link:self', '(6) the same for a 16 year old target');
SELECT t.throws($q$SELECT t.ask('su', 'b3', 'grown')$q$, 'MINOR_MESSAGING_BLOCKED:needs_guardian_link:self', '(6) and on a contact request');
SELECT t.reset();
UPDATE public.child_controls SET messaging = 'off' WHERE child_user_id = t.id('sa');
SELECT t.as_user(t.id('sa'));
SELECT t.eq(t.dm_code('grown'), 'MINOR_MESSAGING_BLOCKED:messaging_off:self', '(6) the caller''s own controls are still explained');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.dm_code('sc'), 'MINOR_MESSAGING_BLOCKED:not_permitted:other', '(6) an adult caller still gets the one fixed code about the other person');
SELECT t.reset();

-- ============================================================================= (4) revoke_parental_consent checks authorization first
CREATE FUNCTION t.err(stmt text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE stmt;
  RETURN 'no error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $f$;
GRANT EXECUTE ON FUNCTION t.err(text) TO authenticated;
SELECT t.ok(EXISTS (SELECT 1 FROM public.parental_consents WHERE child_user_id = t.id('ka')), '(4) setup: the minor has a consent record');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.err(format($q$SELECT public.revoke_parental_consent(%L, 'x')$q$, t.id('ka'))), 'NOT_AUTHORIZED', '(4) a stranger probing a minor with consent');
SELECT t.eq(t.err(format($q$SELECT public.revoke_parental_consent(%L, 'x')$q$, t.id('grown'))), 'NOT_AUTHORIZED', '(4) and an adult get the same answer');
SELECT t.reset();
DELETE FROM public.parental_consents WHERE child_user_id = t.id('sc');
SELECT t.as_user(t.id('gsc'));
SELECT t.eq(t.err(format($q$SELECT public.revoke_parental_consent(%L, 'x')$q$, t.id('sc'))), 'CONSENT_NOT_FOUND', '(4) a guardian with no consent row is told so');
SELECT t.reset();

-- =========================================================================== (5) team invitations look the same to the manager
SELECT t.team('stt', 'boss');
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('blk'), t.id('boss'));
SELECT t.as_user(t.id('boss'));
SELECT t.ok(public.team_invite_player('stt', t.id('blk'), 'player', 'see you at practice') IS NOT NULL, '(5) inviting someone who blocked the manager returns an id');
SELECT t.ok(public.team_invite_player('stt', t.id('adu'), 'player', 'see you at practice') IS NOT NULL, '(5) so does inviting an adult');
SELECT t.ok(public.team_invite_player('stt', t.id('mino'), 'player', 'see you at practice') IS NOT NULL, '(5) and a 14 year old');
SELECT t.eq(t.count($q$SELECT 1 FROM public.team_invites WHERE team_id = 'stt'$q$), 3, '(5) the manager sees three invitations');
SELECT t.eq(t.count($q$SELECT DISTINCT message, status, role, invited_by, guardian_approved_at, responded_at, expires_at - created_at
                       FROM public.team_invites WHERE team_id = 'stt'$q$), 1, '(5) identical in every column the manager can read');
SELECT t.eq(t.count($q$SELECT 1 FROM public.team_invite_suppressions$q$), 0, '(5) the suppression record is not readable');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('blk')), 0, '(5) the blocker gets no notification');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('adu') AND type = 'team_invite'), 1, '(5) the adult does');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('gmi') AND type = 'team_invite'), 1, '(5) and the minor''s guardian does');
SELECT t.as_user(t.id('blk'));
SELECT t.eq(t.count('SELECT 1 FROM public.team_invites_inbox()'), 0, '(5) the blocker sees no invitation');
SELECT t.eq(t.count('SELECT 1 FROM public.team_invites'), 0, '(5) not even in the table');
SELECT t.reset();
SELECT t.as_user(t.id('blk'));
SELECT t.throws(format('SELECT public.team_respond_invite(%L, true)', (SELECT id FROM public.team_invites WHERE invitee_id = t.id('blk'))), 'INVITE_NOT_FOUND',
  '(5) and cannot accept it even knowing its id');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_members WHERE team_id = 'stt' AND user_id = t.id('blk')), 0, '(5) the blocker is not on the team');
SELECT t.as_user(t.id('adu'));
SELECT t.eq((SELECT message FROM public.team_invites_inbox() WHERE team_id = 'stt'), 'see you at practice', '(5) an adult invitee reads the message');
SELECT t.as_user(t.id('mino'));
SELECT t.eq(t.count($q$SELECT 1 FROM public.team_invites_inbox() WHERE team_id = 'stt'$q$), 1, '(5) the minor sees the invitation');
SELECT t.ok((SELECT message IS NULL FROM public.team_invites_inbox() WHERE team_id = 'stt'), '(5) but never the free text');
SELECT t.eq(t.count($q$SELECT 1 FROM public.team_invites WHERE message IS NOT NULL$q$), 0, '(5) and cannot read it from the table');
SELECT t.as_user(t.id('gmi'));
SELECT t.ok((SELECT message IS NULL FROM public.team_invites_inbox() WHERE invitee_id = t.id('mino')), '(5) nor can the minor''s guardian');
SELECT t.eq(t.count('SELECT 1 FROM public.team_invites'), 0, '(5) who also reads only through the inbox');
SELECT t.lives(format('SELECT public.guardian_approve_team_invite(%L, true)', (SELECT id FROM public.team_invites_inbox() WHERE invitee_id = t.id('mino'))),
  '(5) the guardian approves through the inbox id');
SELECT t.as_anon();
SELECT t.throws('SELECT * FROM public.team_invites_inbox()', 'permission denied', '(5) visitors cannot call the inbox');
SELECT t.reset();

-- =============================================================== (8) no privacy row reads as private; ages of non-adults stay private
DELETE FROM public.privacy_preferences WHERE user_id IN (t.id('legacy'), t.id('oldadult'));
SELECT t.as_anon();
SELECT t.eq(public.profile_visibility_of(t.id('legacy')), public.profile_visibility_of(t.id('oldadult')), '(8) anonymous: a teen with no row reads like an adult with none');
SELECT t.eq(public.profile_visibility_of(t.id('legacy')), 'private', '(8) both private');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(public.profile_visibility_of(t.id('legacy')), public.profile_visibility_of(t.id('oldadult')), '(8) a stranger: the same');
SELECT t.eq(t.count(format('SELECT * FROM public.profile_ages(ARRAY[%L, %L]::uuid[])', t.id('legacy'), t.id('oldadult'))), 0, '(8) and no age for either');
SELECT t.reset();
UPDATE public.privacy_preferences SET profile_visibility = 'members' WHERE user_id = t.id('tm');
UPDATE public.privacy_preferences SET profile_visibility = 'public' WHERE user_id = t.id('grown');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count(format('SELECT * FROM public.profile_ages(ARRAY[%L]::uuid[])', t.id('tm'))), 0, '(8) a stranger never gets a 15 year old''s age');
SELECT t.eq(t.count(format('SELECT * FROM public.profile_ages(ARRAY[%L]::uuid[])', t.id('grown'))), 1, '(8) an adult''s visible age is unchanged');
SELECT t.as_user(t.id('tm'));
SELECT t.eq(t.count(format('SELECT * FROM public.profile_ages(ARRAY[%L]::uuid[])', t.id('tm'))), 1, '(8) the teen sees their own');
SELECT t.as_user(t.id('gtm'));
SELECT t.eq(t.count(format('SELECT * FROM public.profile_ages(ARRAY[%L]::uuid[])', t.id('tm'))), 1, '(8) so does their guardian');
SELECT t.as_user(t.id('modx'));
SELECT t.eq(t.count(format('SELECT * FROM public.profile_ages(ARRAY[%L]::uuid[])', t.id('tm'))), 1, '(8) and staff');
SELECT t.reset();

-- ============================================================ (9) an adult-only interval never lets a blank save wipe the exact copy
SET LOCAL session_replication_role = replica;
INSERT INTO public.app_settings (key, value) VALUES ('youth_location_privacy', '{"coarsen": true, "app_adoption_confirmed": "2c-verified"}'::jsonb)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('host'));
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, lat, lng) VALUES
  ('yx', t.id('host'), 'basketball', 'U14 run', now() + interval '3 days', 10, 14, 'Lincoln Gym, 12 Oak St', 'Midtown', 33.77712, -84.38812);
SELECT t.lives($q$UPDATE public.hosted_games SET min_age = 18, max_age = NULL WHERE id = 'yx'$q$, '(9) the game becomes adult-only');
SELECT t.lives($q$UPDATE public.hosted_games SET location = '' WHERE id = 'yx'$q$, '(9) an older client saves a blank location');
SELECT t.lives($q$UPDATE public.hosted_games SET location = '', lat = NULL, lng = NULL WHERE id = 'yx'$q$, '(9) and no coordinates');
SELECT t.lives($q$UPDATE public.hosted_games SET min_age = 10, max_age = 14 WHERE id = 'yx'$q$, '(9) the game is youth again');
SELECT t.reset();
SELECT t.ok((SELECT location = 'Lincoln Gym, 12 Oak St' AND lat = 33.77712 AND lng = -84.38812 FROM public.hosted_game_private WHERE game_id = 'yx'),
  '(9) the exact copy is unchanged');
SELECT t.ok((SELECT location <> 'Lincoln Gym, 12 Oak St' FROM public.hosted_games WHERE id = 'yx'), '(9) and the public column is not the exact address');
SELECT t.as_user(t.id('host'));
SELECT t.lives($q$UPDATE public.hosted_games SET min_age = 18, max_age = NULL WHERE id = 'yx'$q$, '(9) adult-only again');
SELECT t.lives($q$UPDATE public.hosted_games SET location = 'Oak Hall, 3 Elm St', lat = 33.70001, lng = -84.30001 WHERE id = 'yx'$q$, '(9) a real new venue');
SELECT t.lives($q$UPDATE public.hosted_games SET min_age = 10, max_age = 14 WHERE id = 'yx'$q$, '(9) youth again');
SELECT t.reset();
SELECT t.ok((SELECT location = 'Oak Hall, 3 Elm St' AND lat = 33.70001 FROM public.hosted_game_private WHERE game_id = 'yx'), '(9) a genuine change is still stored');

-- ======================================================================================= (10) the dependency guard checks PAY-1
\set sec7_guard `f=supabase/migrations/20261108130000_remaining_security_defects.sql; [ -f "$f" ] || f="$(git rev-parse --show-toplevel)/$f"; sed -n '/^DO \$guard\$ BEGIN/,/^END \$guard\$;/p' "$f"`
SELECT t.lives(:'sec7_guard', '(10) the SEC-7 guard passes on a complete database');
SAVEPOINT no_pay1;
ALTER FUNCTION private_sec.is_game_host(text) RENAME TO is_game_host_hidden;
SELECT t.throws(:'sec7_guard', 'SEC-7: a required earlier release migration', '(10) without PAY-1''s private_sec.is_game_host the guard stops SEC-7');
ROLLBACK TO SAVEPOINT no_pay1;
SAVEPOINT no_pay1b;
ALTER FUNCTION private_sec.can_read_game_payment_settings(text, uuid) RENAME TO can_read_game_payment_settings_hidden;
SELECT t.throws(:'sec7_guard', 'SEC-7: a required earlier release migration', '(10) and without can_read_game_payment_settings');
ROLLBACK TO SAVEPOINT no_pay1b;

-- ====================================================== (11) the requires_approval backfill survives a legacy ballacity_processed row
\set sec7_backfill `f=supabase/migrations/20261108130000_remaining_security_defects.sql; [ -f "$f" ] || f="$(git rev-parse --show-toplevel)/$f"; sed -n '/^UPDATE public.game_payment_settings s SET requires_approval = true/,/;$/p' "$f"`
SET LOCAL session_replication_role = replica;
INSERT INTO public.app_settings (key, value) VALUES ('monetization', '{"ballacityProcessedPaymentsEnabled": false}'::jsonb)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, location, neighborhood) VALUES
  ('legacy-paid', t.id('minorhost'), 'basketball', 'Legacy paid run', now() + interval '5 days', 'Gym', 'North');
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval, payment_mode)
  VALUES ('legacy-paid', t.id('gmh'), 0, false, 'ballacity_processed');
SET LOCAL session_replication_role = origin;
SELECT t.ok(length(:'sec7_backfill') > 0, '(11) setup: the backfill statement was read from the migration');
SELECT t.lives(:'sec7_backfill', '(11) the backfill runs over a legacy ballacity_processed row with the mode switched off');
SELECT t.ok((SELECT requires_approval FROM public.game_payment_settings WHERE game_id = 'legacy-paid'), '(11) and sets requires_approval');
SELECT t.throws($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, payment_mode) VALUES ('legacy-paid', t.id('host'), 5, 'ballacity_processed')$q$,
  'does not process game payments', '(11) choosing the mode is still refused while it is switched off');
SELECT t.lives($q$UPDATE public.game_payment_settings SET payment_mode = 'direct_host' WHERE game_id = 'legacy-paid'$q$, '(11) leaving the mode is fine');
SELECT t.throws($q$UPDATE public.game_payment_settings SET payment_mode = 'ballacity_processed' WHERE game_id = 'legacy-paid'$q$,
  'does not process game payments', '(11) but switching back to it is refused');

ROLLBACK;
