-- Migration 20261106150000: a signed-in account learns nothing about another account's age or messaging
-- controls unless it has a reason, and no API role can write user_roles (P0-2 of the Phase 0 audit).
BEGIN;
SELECT t.person('adultone', 30), t.person('adulttwo', 34), t.person('teenone', 15), t.person('teentwo', 16),
       t.person('kidone', 10), t.person('parentone', 42), t.person('stranger', 28), t.person('modone', 36),
       t.person('adminone', 37), t.person('superone', 45);
SELECT t.guardian('parentone', 'teenone');
SELECT t.guardian('parentone', 'kidone');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'moderator'), (t.id('adminone'), 'admin'), (t.id('superone'), 'superadmin');
-- Sign-up seeds privacy_preferences before a birthday exists, so every fixture starts private. Model the
-- exposed state: a public adult and members-visible teens (the most a teen may choose; the privacy floor
-- turns 'public' into 'members' for them and keeps a child private whatever is asked).
INSERT INTO public.privacy_preferences (user_id, profile_visibility)
VALUES (t.id('adultone'), 'public'), (t.id('teenone'), 'members'), (t.id('teentwo'), 'members'), (t.id('kidone'), 'members')
  ON CONFLICT (user_id) DO UPDATE SET profile_visibility = EXCLUDED.profile_visibility;
SELECT t.eq(public.profile_visibility_of(t.id('teenone')), 'members', 'setup: the teen is members-visible');
SELECT t.eq(public.profile_visibility_of(t.id('kidone')), 'private', 'setup: the child stays private whatever is asked');

-- ============================================================ 1. profile_ages
SELECT t.as_user(t.id('stranger'));
SELECT t.eq((SELECT age FROM public.profile_ages(ARRAY[t.id('adultone')])), 30,
  'profile_ages: a signed-in stranger still reads a public adult''s age');
SELECT t.eq((SELECT count(*)::int FROM public.profile_ages(ARRAY[t.id('teenone')])), 0,
  'profile_ages: a stranger gets no row for a 15 year old');
SELECT t.eq((SELECT count(*)::int FROM public.profile_ages(ARRAY[t.id('teentwo')])), 0,
  'profile_ages: nor for a 16 year old');
SELECT t.eq((SELECT count(*)::int FROM public.profile_ages(ARRAY[t.id('kidone')])), 0,
  'profile_ages: nor for a child');
SELECT t.eq((SELECT count(*)::int FROM public.profile_ages(ARRAY[t.id('adultone'), t.id('teenone'), t.id('kidone')])), 1,
  'profile_ages: a mixed list returns only the adult');
SELECT t.reset();

SELECT t.as_user(t.id('teenone'));
SELECT t.eq((SELECT age FROM public.profile_ages(ARRAY[t.id('teenone')])), 15,
  'profile_ages: a teen reads their own age');
SELECT t.eq((SELECT count(*)::int FROM public.profile_ages(ARRAY[t.id('teentwo')])), 0,
  'profile_ages: but not another teen''s');
SELECT t.reset();

SELECT t.as_user(t.id('kidone'));
SELECT t.eq((SELECT count(*)::int FROM public.profile_ages(ARRAY[t.id('kidone')])), 0,
  'profile_ages: a private profile returns nothing, even to its owner (as before)');
SELECT t.reset();

SELECT t.as_user(t.id('parentone'));
SELECT t.eq((SELECT age FROM public.profile_ages(ARRAY[t.id('teenone')])), 15,
  'profile_ages: a verified guardian reads their child''s age');
SELECT t.eq((SELECT count(*)::int FROM public.profile_ages(ARRAY[t.id('teentwo')])), 0,
  'profile_ages: a guardian reads nothing about someone else''s teen');
SELECT t.reset();

SELECT t.as_user(t.id('modone'));
SELECT t.eq((SELECT age FROM public.profile_ages(ARRAY[t.id('teenone')])), 15,
  'profile_ages: a moderator reads a teen''s age');
SELECT t.reset();

SELECT t.as_user(t.id('adulttwo'));
SELECT t.eq((SELECT count(*)::int FROM public.profile_ages(ARRAY[t.id('teenone')])), 0,
  'profile_ages: an ordinary adult member is a stranger to a teen');
SELECT t.reset();

SELECT t.as_service();
SELECT t.eq((SELECT age FROM public.profile_ages(ARRAY[t.id('teenone')])), 15,
  'profile_ages: the server still reads every age');
SELECT t.reset();

SELECT t.as_anon();
SELECT t.throws(format('SELECT * FROM public.profile_ages(ARRAY[%L::uuid])', t.id('adultone')),
  'permission denied', 'profile_ages: anonymous visitors cannot call it');
SELECT t.reset();

-- ============================================================ 2. messaging policy functions
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.minor_messaging_block(%L, %L)', t.id('adultone'), t.id('teenone')),
  'permission denied', 'minor_messaging_block: a signed-in account cannot ask about two other people');
SELECT t.throws(format('SELECT public.minor_messaging_block_reason(%L, %L)', t.id('adultone'), t.id('teenone')),
  'permission denied', 'minor_messaging_block_reason: likewise');
SELECT t.throws(format('SELECT public.minor_messaging_allowed(%L, %L)', t.id('adultone'), t.id('teenone')),
  'permission denied', 'minor_messaging_allowed: likewise');
SELECT t.ok(public.minor_messaging_block_me(t.id('teenone')) IS NOT NULL,
  'minor_messaging_block_me: a stranger is told they cannot message a guardian-only teen');
SELECT t.ok(public.minor_messaging_block_me(t.id('adultone')) IS NULL,
  'minor_messaging_block_me: and that nothing blocks messaging an adult');
SELECT t.reset();

SELECT t.as_user(t.id('parentone'));
SELECT t.ok(public.minor_messaging_block_me(t.id('teenone')) IS NULL,
  'minor_messaging_block_me: a guardian may message their own teen');
SELECT t.reset();

SELECT t.as_anon();
SELECT t.throws(format('SELECT public.minor_messaging_block_me(%L)', t.id('teenone')),
  'permission denied', 'minor_messaging_block_me: anonymous visitors cannot call it');
SELECT t.reset();

-- The definer paths that use these functions still work for a real request.
SELECT t.as_user(t.id('adultone'));
SELECT t.lives(format('SELECT public.create_direct_conversation(%L)', t.id('adulttwo')),
  'create_direct_conversation: two adults still open a conversation');
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('teenone')),
  'guardian_only', 'create_direct_conversation: and the teen''s guardian-only control still holds');
SELECT t.reset();

-- ============================================================ 3. user_roles
SELECT t.as_user(t.id('adminone'));
SELECT t.throws(format('INSERT INTO public.user_roles (user_id, role) VALUES (%L, ''superadmin'')', t.id('adminone')),
  'permission denied', 'user_roles: an admin cannot make themselves superadmin');
SELECT t.throws(format('INSERT INTO public.user_roles (user_id, role) VALUES (%L, ''admin'')', t.id('stranger')),
  'permission denied', 'user_roles: nor grant anyone anything directly');
SELECT t.throws(format('UPDATE public.user_roles SET role = ''superadmin'' WHERE user_id = %L', t.id('adminone')),
  'permission denied', 'user_roles: nor rewrite their own row');
SELECT t.throws(format('DELETE FROM public.user_roles WHERE user_id = %L', t.id('superone')),
  'permission denied', 'user_roles: nor remove a superadmin');
SELECT t.ok(t.count('SELECT 1 FROM public.user_roles') >= 3, 'user_roles: an admin still reads the roles table');
SELECT t.reset();

SELECT t.as_user(t.id('superone'));
SELECT t.throws(format('INSERT INTO public.user_roles (user_id, role) VALUES (%L, ''admin'')', t.id('stranger')),
  'permission denied', 'user_roles: even a superadmin does not write roles through the API (the server does, with an audit row)');
SELECT t.reset();

SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.user_roles'), 0, 'user_roles: a member with no role sees no rows');
SELECT t.reset();

SELECT t.as_user(t.id('modone'));
SELECT t.eq(t.count('SELECT 1 FROM public.user_roles'), 1, 'user_roles: a member sees only their own role');
SELECT t.reset();

SELECT t.as_service();
SELECT t.lives(format('INSERT INTO public.user_roles (user_id, role) VALUES (%L, ''moderator'')', t.id('stranger')),
  'user_roles: the server (service role) still grants a role');
SELECT t.lives(format('DELETE FROM public.user_roles WHERE user_id = %L AND role = ''moderator''', t.id('stranger')),
  'user_roles: and revokes one');
SELECT t.reset();

-- Defence in depth: give the grant back inside this transaction and the trigger still refuses.
GRANT INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
CREATE POLICY "test only: open writes" ON public.user_roles FOR ALL TO authenticated USING (true) WITH CHECK (true);
SELECT t.as_user(t.id('adminone'));
SELECT t.throws(format('INSERT INTO public.user_roles (user_id, role) VALUES (%L, ''superadmin'')', t.id('adminone')),
  'ROLE_WRITE_FORBIDDEN', 'user_roles: with the grant and an open policy restored, the trigger still refuses a signed-in writer');
SELECT t.throws(format('DELETE FROM public.user_roles WHERE user_id = %L', t.id('superone')),
  'ROLE_WRITE_FORBIDDEN', 'user_roles: deletes too');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.user_roles WHERE user_id = t.id('adminone') AND role = 'superadmin'), 0,
  'user_roles: no superadmin row was created along the way');

ROLLBACK;
