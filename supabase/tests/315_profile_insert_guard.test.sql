-- F7: a profile row created by a client cannot choose its age or moderation state.
--
-- "Unknown age" (an account with no profile row) is where every age rule fails closed, so the one way out of it
-- must not be a client INSERT that names its own cohort.
BEGIN;

SELECT t.person('adult', 30), t.person('teen14', 14), t.person('child9', 9), t.person('stranger', 28), t.person('modone', 35);
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'admin');

-- Accounts whose profile row is missing (the state the guard protects): delete the rows the signup trigger made.
DELETE FROM public.profiles WHERE id IN (t.id('adult'), t.id('teen14'), t.id('child9'));
SELECT t.eq(public.age_cohort_of(t.id('teen14')), 'unknown', 'missing profile row: the account is of unknown age');
SELECT t.ok(public.age_cohort_of(t.id('teen14')) IS DISTINCT FROM 'adult', 'and is not a confirmed adult');

-- A 14-year-old (birthday on file) claims to be an adult.
SELECT t.as_user(t.id('teen14'));
SELECT t.lives(format($q$INSERT INTO public.profiles (id, display_name, age_cohort, age_category, account_type) VALUES (%L, 'T', 'adult', 'adult', 'player')$q$, t.id('teen14')),
  'a client can create its own missing profile row');
SELECT t.reset();
SELECT t.eq((SELECT age_cohort FROM public.profiles WHERE id = t.id('teen14')), 'teen_13_15', 'but the cohort comes from the stored birthday, not from the client');
SELECT t.eq((SELECT age_category FROM public.profiles WHERE id = t.id('teen14')), 'teen', 'and so does the category');
SELECT t.ok(public.age_cohort_of(t.id('teen14')) IS DISTINCT FROM 'adult', 'the 14-year-old is not an adult');

-- An adult claims to be a child: also not the client's choice (the value is derived both ways).
SELECT t.as_user(t.id('adult'));
SELECT t.lives(format($q$INSERT INTO public.profiles (id, display_name, age_cohort, age_category) VALUES (%L, 'A', 'child_under_13', 'child')$q$, t.id('adult')), 'an adult creates their missing row');
SELECT t.reset();
SELECT t.eq((SELECT age_cohort FROM public.profiles WHERE id = t.id('adult')), 'adult', 'derived from the birthday: adult');

-- A child under 13 claims to be an adult: stored as a child, and the consent row is created.
SELECT t.as_user(t.id('child9'));
SELECT t.lives(format($q$INSERT INTO public.profiles (id, display_name, age_cohort, age_category) VALUES (%L, 'C', 'adult', 'adult')$q$, t.id('child9')), 'a child creates their missing row');
SELECT t.reset();
SELECT t.eq((SELECT age_cohort FROM public.profiles WHERE id = t.id('child9')), 'child_under_13', 'stored as a child');
SELECT t.eq((SELECT status FROM public.parental_consents WHERE child_user_id = t.id('child9')), 'required', 'with the parental-consent requirement in place');

-- No birthday at all: unknown, whatever is claimed.
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES (t.id('nobirthday'), 'nobirthday@example.test', now(), '{"display_name":"NB","account_type":"player"}');
DELETE FROM public.profiles WHERE id = t.id('nobirthday');
SELECT t.as_user(t.id('nobirthday'));
SELECT t.lives(format($q$INSERT INTO public.profiles (id, display_name, age_cohort, age_category) VALUES (%L, 'NB', 'adult', 'adult')$q$, t.id('nobirthday')), 'an account with no birthday creates its row');
SELECT t.reset();
SELECT t.eq((SELECT age_cohort FROM public.profiles WHERE id = t.id('nobirthday')), 'unknown', 'no birthday: still unknown, never the claimed adult');
SELECT t.ok(public.age_cohort_of(t.id('nobirthday')) IS DISTINCT FROM 'adult', 'and not a confirmed adult');

-- Moderation and review fields cannot be chosen either.
DELETE FROM public.profiles WHERE id = t.id('stranger');
SELECT t.as_user(t.id('stranger'));
SELECT t.lives(format($q$INSERT INTO public.profiles (id, display_name, moderation_state, suspended_at, suspended_reason, age_review_required, avatar_url_private)
  VALUES (%L, 'S', 'warned', now(), 'x', true, 'private/x.png')$q$, t.id('stranger')), 'a client inserts with moderation fields set');
SELECT t.reset();
SELECT t.eq((SELECT moderation_state FROM public.profiles WHERE id = t.id('stranger')), 'active', 'moderation_state is the default');
SELECT t.ok((SELECT suspended_at IS NULL AND suspended_reason IS NULL AND avatar_url_private IS NULL AND NOT age_review_required FROM public.profiles WHERE id = t.id('stranger')), 'suspension, review flag and private avatar are reset');

-- Nobody creates a profile row for someone else, and an existing row cannot be re-inserted.
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($q$INSERT INTO public.profiles (id, display_name, age_cohort) VALUES (%L, 'X', 'adult')$q$, t.id('modone')), 'row-level security', 'a client cannot create a profile row for another account');
SELECT t.throws(format($q$INSERT INTO public.profiles (id, display_name, age_cohort) VALUES (%L, 'S2', 'adult')$q$, t.id('stranger')), 'duplicate key', 'and cannot insert a second row for their own');
SELECT t.as_anon();
SELECT t.throws(format($q$INSERT INTO public.profiles (id, display_name, age_cohort) VALUES (%L, 'Z', 'adult')$q$, t.id('adult')), 'permission denied', 'anonymous visitors cannot insert profiles');
SELECT t.reset();

-- The server and admins are unaffected: signup creates rows with the cohort from the birthday (every t.person above
-- relied on it), the service role may write any value, and an admin's own insert is not rewritten (RLS still limits everyone to their own row).
SELECT t.person('newadult', 40);
SELECT t.eq((SELECT age_cohort FROM public.profiles WHERE id = t.id('newadult')), 'adult', 'signup (server) still creates the row with the right cohort');
DELETE FROM public.profiles WHERE id = t.id('newadult');
SELECT t.as_service();
SELECT t.lives(format($q$INSERT INTO public.profiles (id, display_name, age_cohort, age_category) VALUES (%L, 'N', 'adult', 'adult')$q$, t.id('newadult')), 'the service role is not constrained');
SELECT t.reset();
SELECT t.eq((SELECT age_cohort FROM public.profiles WHERE id = t.id('newadult')), 'adult', 'and its value stands');
DELETE FROM public.profiles WHERE id = t.id('modone');
SELECT t.as_user(t.id('modone'));
SELECT t.lives(format($q$INSERT INTO public.profiles (id, display_name, age_cohort, age_category) VALUES (%L, 'M', 'teen_13_15', 'teen')$q$, t.id('modone')), 'an admin''s own profile insert is not rewritten');
SELECT t.reset();
SELECT t.eq((SELECT age_cohort FROM public.profiles WHERE id = t.id('modone')), 'teen_13_15', 'the same exemption the UPDATE guard gives admins');

-- The UPDATE path stays closed (control): a client cannot change its own cohort afterwards.
SELECT t.as_user(t.id('teen14'));
SELECT t.eq(t.changed(format($q$UPDATE public.profiles SET age_cohort = 'adult', age_category = 'adult' WHERE id = %L$q$, t.id('teen14'))), 1, 'an UPDATE statement runs');
SELECT t.reset();
SELECT t.eq((SELECT age_cohort FROM public.profiles WHERE id = t.id('teen14')), 'teen_13_15', 'but the cohort is unchanged');

ROLLBACK;
