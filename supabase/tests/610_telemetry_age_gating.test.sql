-- P3-7: telemetry rows of minors and unknown-age accounts keep no user id, user agent or free text.
BEGIN;

SELECT t.person('adultx', 30), t.person('teenx', 14), t.person('kidx', 10);
-- An account with no birthday on file: unknown age.
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
VALUES (t.id('nobday'), 'nobday@example.test', now(), '{"display_name":"NB","account_type":"player"}');

CREATE FUNCTION pg_temp.deny(_h text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.location_denial_events (user_id, reason, message, permission_state, user_agent, sport)
  VALUES (t.id(_h), 'denied', 'User denied Geolocation', 'denied', 'Mozilla/5.0 (iPhone) TestUA', 'soccer');
END $$;
CREATE FUNCTION pg_temp.signin(_h text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.auth_signin_events (user_id, provider, event, error_message, user_agent, browser, platform)
  VALUES (t.id(_h), 'google', 'failure', 'popup closed for someone@example.test', 'Mozilla/5.0 (iPhone) TestUA', 'safari', 'ios');
END $$;

-- Written through the API as each person.
SELECT t.as_user(t.id('adultx'));
SELECT pg_temp.deny('adultx'), pg_temp.signin('adultx');
SELECT t.reset();
SELECT t.as_user(t.id('teenx'));
SELECT pg_temp.deny('teenx'), pg_temp.signin('teenx');
SELECT t.reset();
SELECT t.as_user(t.id('kidx'));
SELECT pg_temp.deny('kidx'), pg_temp.signin('kidx');
SELECT t.reset();
SELECT t.as_user(t.id('nobday'));
SELECT pg_temp.deny('nobday'), pg_temp.signin('nobday');
SELECT t.reset();

-- Adults: unchanged.
SELECT t.eq((SELECT count(*)::int FROM public.location_denial_events
             WHERE user_id = t.id('adultx') AND user_agent LIKE '%TestUA' AND message IS NOT NULL), 1,
  'an adult''s location denial keeps its user id, user agent and message');
SELECT t.eq((SELECT count(*)::int FROM public.auth_signin_events
             WHERE user_id = t.id('adultx') AND user_agent LIKE '%TestUA' AND error_message IS NOT NULL), 1,
  'an adult''s sign-in event keeps its user id, user agent and error');

-- Minors and unknown age: anonymised, but still counted.
SELECT t.eq((SELECT count(*)::int FROM public.location_denial_events
             WHERE user_id IN (t.id('teenx'), t.id('kidx'), t.id('nobday'))), 0,
  'no location denial names a minor or an unknown-age account');
SELECT t.eq((SELECT count(*)::int FROM public.auth_signin_events
             WHERE user_id IN (t.id('teenx'), t.id('kidx'), t.id('nobday'))), 0,
  'no sign-in event names a minor or an unknown-age account');
SELECT t.eq((SELECT count(*)::int FROM public.location_denial_events
             WHERE user_id IS NULL AND (user_agent IS NOT NULL OR message IS NOT NULL)), 0,
  'anonymised location denials keep no user agent or message');
SELECT t.eq((SELECT count(*)::int FROM public.auth_signin_events
             WHERE user_id IS NULL AND (user_agent IS NOT NULL OR error_message IS NOT NULL)), 0,
  'anonymised sign-in events keep no user agent or error text');
SELECT t.eq((SELECT count(*)::int FROM public.location_denial_events
             WHERE user_id IS NULL AND reason = 'denied' AND sport = 'soccer' AND permission_state = 'denied'), 3,
  'the three anonymised denials still count by reason, sport and permission state');
SELECT t.eq((SELECT count(*)::int FROM public.auth_signin_events
             WHERE user_id IS NULL AND event = 'failure' AND browser = 'safari' AND platform = 'ios'), 3,
  'the three anonymised sign-in events still count by event, browser and platform');

-- Any writer, including the service role naming a minor.
SELECT t.as_service();
SELECT pg_temp.signin('teenx');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.auth_signin_events WHERE user_id = t.id('teenx')), 0,
  'a service-role write naming a minor is anonymised too');

-- Signed out: age unknown, so no full user agent; everything else is kept.
SELECT t.as_anon();
SELECT t.lives($q$INSERT INTO public.location_denial_events (reason, sport, user_agent) VALUES ('denied', 'tennis', 'Mozilla/5.0 SignedOutUA')$q$,
  'a signed-out visitor can still record a denial');
SELECT t.lives($q$INSERT INTO public.auth_signin_events (provider, event, user_agent, browser, platform) VALUES ('google', 'attempt', 'Mozilla/5.0 SignedOutUA', 'chrome', 'android')$q$,
  'and a sign-in attempt');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.location_denial_events WHERE user_agent = 'Mozilla/5.0 SignedOutUA'), 0,
  'a signed-out denial keeps no full user agent');
SELECT t.eq((SELECT count(*)::int FROM public.location_denial_events WHERE reason = 'denied' AND sport = 'tennis'), 1,
  'but keeps its reason and sport');
SELECT t.eq((SELECT count(*)::int FROM public.auth_signin_events WHERE user_agent = 'Mozilla/5.0 SignedOutUA'), 0,
  'a signed-out sign-in event keeps no full user agent');
SELECT t.eq((SELECT count(*)::int FROM public.auth_signin_events WHERE event = 'attempt' AND browser = 'chrome' AND platform = 'android'), 1,
  'but keeps its event, browser family and platform');

-- A later update cannot put a minor's identity back.
UPDATE public.auth_signin_events SET user_id = t.id('kidx'), user_agent = 'again'
WHERE id = (SELECT id FROM public.auth_signin_events WHERE user_id IS NULL LIMIT 1);
SELECT t.eq((SELECT count(*)::int FROM public.auth_signin_events WHERE user_id = t.id('kidx') OR user_agent = 'again'), 0,
  'updating a row to name a minor is anonymised as well');

SELECT t.ok(NOT has_function_privilege('authenticated', 'private_sec.telemetry_subject_is_adult(uuid)', 'EXECUTE'),
  'clients cannot call the age check directly');

ROLLBACK;
