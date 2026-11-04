-- SEC-1: corrections found by independent review of the privacy stack.
BEGIN;
SELECT t.person('teen', 17), t.person('kid', 12), t.person('stranger', 33), t.person('guardian', 40), t.person('host', 36), t.person('adultmember', 30);
SELECT t.guardian('guardian', 'teen');
UPDATE public.privacy_preferences SET profile_visibility = 'private' WHERE user_id = t.id('teen');
CREATE FUNCTION t.nm(u text) RETURNS text LANGUAGE sql AS $f$ SELECT COALESCE((SELECT display_name FROM public.visible_avatars(ARRAY[t.id(u)])), '-') $f$;
GRANT EXECUTE ON FUNCTION t.nm(text) TO anon, authenticated;

-- ---- 1. a stranger cannot make themselves "related" alone
SELECT t.team('strangers', 'stranger');
SELECT t.as_user(t.id('stranger'));
SELECT t.lives(format($q$SELECT public.team_invite_player('strangers', %L)$q$, t.id('teen')), 'a stranger can still invite someone to their own team');
SELECT t.eq(t.nm('teen'), '-', 'but a pending invitation does not reveal the minor''s name');
SELECT t.reset();
SELECT t.ok(NOT private_sec.can_see_minor_name(t.id('stranger'), t.id('teen')), 'nor does it make the stranger related');
UPDATE public.team_invites SET status = 'cancelled' WHERE invitee_id = t.id('teen');
SELECT t.ok(NOT private_sec.can_see_minor_name(t.id('stranger'), t.id('teen')), 'and a cancelled one never did');
UPDATE public.team_invites SET status = 'accepted' WHERE invitee_id = t.id('teen');
SELECT t.ok(private_sec.can_see_minor_name(t.id('stranger'), t.id('teen')), 'an accepted invitation (the minor and their guardian agreed) does');

INSERT INTO public.trainer_orgs (id, name, handle, owner_id) VALUES ('00000000-0000-0000-0000-0000000000f1', 'Org', 'org1', t.id('host'));
SELECT t.as_user(t.id('host'));
SELECT t.throws(format($q$INSERT INTO public.org_members (org_id, user_id) VALUES ('00000000-0000-0000-0000-0000000000f1', %L)$q$, t.id('kid')), 'row-level security', 'an organization administrator cannot insert a minor member');
SELECT t.lives(format($q$INSERT INTO public.org_members (org_id, user_id) VALUES ('00000000-0000-0000-0000-0000000000f1', %L)$q$, t.id('adultmember')), 'but an adult member as before');
SELECT t.reset();
INSERT INTO public.org_members (org_id, user_id) VALUES ('00000000-0000-0000-0000-0000000000f1', t.id('kid'));   -- legacy row (service path)
SELECT t.ok(NOT private_sec.can_see_minor_name(t.id('host'), t.id('kid')), 'a legacy organization membership no longer makes the admin related');

-- ---- 2. the one-way switch cannot be renamed away or truncated
SET LOCAL session_replication_role = replica;
INSERT INTO public.app_settings (key, value) VALUES ('youth_location_privacy', '{"coarsen": true, "app_adoption_confirmed": "2c-verified"}'::jsonb)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
SET LOCAL session_replication_role = origin;
SELECT t.throws($q$UPDATE public.app_settings SET key = 'youth_location_privacy_x' WHERE key = 'youth_location_privacy'$q$, 'COARSENING_IRREVERSIBLE', 'renaming the switch is refused');
SELECT t.throws($q$TRUNCATE public.app_settings$q$, 'COARSENING_IRREVERSIBLE', 'and so is truncating the table');
SELECT t.throws($q$DELETE FROM public.app_settings WHERE key = 'youth_location_privacy'$q$, 'COARSENING_IRREVERSIBLE', 'deleting it was already refused');

-- ---- 3. widening the age range after activation never publishes the exact venue
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, lat, lng, neighborhood, host_snapshot) VALUES
  ('youth1', t.id('host'), 'basketball', 'Kids run', now() + interval '3 days', 8, 12, 'North area', 33.75, -84.39, 'North', '{"name":"Host"}'::jsonb);
INSERT INTO public.hosted_game_private (game_id, location, lat, lng) VALUES ('youth1', 'Lincoln Elementary Gym, 12 Oak St', 33.7488, -84.3877);
SET LOCAL session_replication_role = origin;
UPDATE public.hosted_games SET min_age = 21, max_age = 40 WHERE id = 'youth1';
SELECT t.eq((SELECT location FROM public.hosted_games WHERE id = 'youth1'), 'North area', 'the public venue stays coarse');
SELECT t.eq((SELECT count(*)::int FROM public.hosted_game_private WHERE game_id = 'youth1'), 1, 'and the private copy is kept');

-- ---- 4. the batch function does not leave its bypass flag on
SELECT public.coarsen_existing_youth_games(10);
SELECT t.eq(COALESCE(current_setting('app.coarsening_existing', true), ''), '', 'the bypass flag is cleared after the batch');

-- ---- 5. guardian approval on a join request cannot be stamped by the host or the child
SET LOCAL session_replication_role = replica;
INSERT INTO public.join_requests (id, game_id, player_id, host_id, idempotency_key, status) VALUES
  ('00000000-0000-0000-0000-0000000000a9', 'youth1', t.id('teen'), t.id('host'), 'k1', 'pending');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('host'));
SELECT t.lives($q$UPDATE public.join_requests SET status = 'approved', guardian_approved_at = now(), guardian_approved_by = auth.uid() WHERE id = '00000000-0000-0000-0000-0000000000a9'$q$, 'a host can still approve their own request');
SELECT t.reset();
SELECT t.ok((SELECT guardian_approved_at IS NULL AND guardian_approved_by IS NULL FROM public.join_requests WHERE id = '00000000-0000-0000-0000-0000000000a9'), 'but cannot stamp a guardian approval');
SELECT t.as_user(t.id('guardian'));
SELECT t.lives($q$SELECT public.guardian_approve_join_request('00000000-0000-0000-0000-0000000000a9', true)$q$, 'a verified guardian approves through the real function (it runs as the guardian)');
SELECT t.reset();
SELECT t.ok((SELECT guardian_approved_by = t.id('guardian') FROM public.join_requests WHERE id = '00000000-0000-0000-0000-0000000000a9'), 'and the approval is recorded');
ROLLBACK;
