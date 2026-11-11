-- Migration 20261106160000: nobody registers themselves as under 13, through the app or the API. Children under 13
-- join only as guardian-created managed accounts. Existing members re-saving their own date are untouched.
BEGIN;
-- Accounts with no birthday yet: the state set_my_birthday's first write is for.
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES
  (t.id('newadult'), 'newadult@example.test', now(), '{"display_name":"Newadult","account_type":"player"}'),
  (t.id('newteen'), 'newteen@example.test', now(), '{"display_name":"Newteen","account_type":"player"}'),
  (t.id('newkid'), 'newkid@example.test', now(), '{"display_name":"Newkid","account_type":"player"}'),
  (t.id('newtwelve'), 'newtwelve@example.test', now(), '{"display_name":"Newtwelve","account_type":"player"}');
-- An under-13 already on file (a managed child, or anyone registered before this rule).
SELECT t.person('existingkid', 10);

SELECT t.as_user(t.id('newadult'));
SELECT t.lives(format('SELECT * FROM public.set_my_birthday(%L)', current_date - interval '30 years'),
  'an adult registers their date of birth');
SELECT t.reset();

SELECT t.as_user(t.id('newteen'));
SELECT t.lives(format('SELECT * FROM public.set_my_birthday(%L)', (current_date - interval '13 years')::date),
  'a member who turned 13 today registers');
SELECT t.reset();

SELECT t.as_user(t.id('newkid'));
SELECT t.throws(format('SELECT * FROM public.set_my_birthday(%L)', current_date - interval '9 years'),
  'MIN_AGE', 'a 9 year old cannot register themselves through the API');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.profile_birthdays WHERE user_id = t.id('newkid')), 0,
  'and no birthday was stored for them');

SELECT t.as_user(t.id('newtwelve'));
SELECT t.throws(format('SELECT * FROM public.set_my_birthday(%L)', (current_date - interval '13 years' + interval '1 day')::date),
  'MIN_AGE', 'nor can someone one day short of 13');
SELECT t.reset();

-- Re-saving an existing date (the profile form does this on every save) still works for an under-13 already on file.
SELECT t.as_user(t.id('existingkid'));
SELECT t.lives(format('SELECT * FROM public.set_my_birthday(%L)', (SELECT birthday FROM public.profile_birthdays WHERE user_id = t.id('existingkid'))),
  'an under-13 already on file re-saves their own date');
SELECT t.throws(format('SELECT * FROM public.set_my_birthday(%L)', current_date - interval '20 years'),
  'BIRTHDAY_LOCKED', 'and the birthday lock still applies');
SELECT t.reset();

SELECT t.ok(NOT has_function_privilege('anon', 'public.set_my_birthday(date)', 'EXECUTE'),
  'anonymous visitors still cannot call it');
ROLLBACK;
