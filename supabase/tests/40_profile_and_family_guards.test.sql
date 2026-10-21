-- Triggers that stop a user (or the API on their behalf) from editing what only
-- the platform or a guardian may set, and the rules for posting a clip about a
-- child. Setup runs as the service role, which these guards let through.
BEGIN;

SELECT t.person('playerone', 30), t.person('adminone', 33), t.person('teenmid', 14),
       t.person('teenold', 17), t.person('kidyoung', 10), t.person('guardian', 41), t.person('stranger', 28);
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('adminone'), 'admin');

-- ---- moderation fields on a profile ---------------------------------------
UPDATE public.profiles SET suspended_at = now(), suspended_reason = 'spam', moderation_state = 'suspended'
 WHERE id = t.id('playerone');

SELECT t.as_user(t.id('playerone'));
SELECT t.lives(format('UPDATE public.profiles SET suspended_at = NULL, suspended_reason = NULL, moderation_state = ''active'', display_name = ''Player Uno'' WHERE id = %L', t.id('playerone')),
  'a suspended user can send an update to their own profile');
SELECT t.reset();
SELECT t.ok((SELECT suspended_at IS NOT NULL AND suspended_reason = 'spam' AND moderation_state = 'suspended'
               FROM public.profiles WHERE id = t.id('playerone')),
  'but cannot lift their own suspension');
SELECT t.eq((SELECT display_name FROM public.profiles WHERE id = t.id('playerone')), 'Player Uno',
  'while their ordinary edits still apply');

-- Lifting a suspension is moderator work done by server code (the service role),
-- never through a user's own API session, even an admin's.
SELECT t.as_user(t.id('adminone'));
SELECT t.eq(t.changed(format('UPDATE public.profiles SET suspended_at = NULL, moderation_state = ''active'' WHERE id = %L', t.id('playerone'))), 0,
  'an admin''s API session cannot edit another user''s profile');
SELECT t.as_service();
SELECT t.lives(format('UPDATE public.profiles SET suspended_at = NULL, suspended_reason = NULL, moderation_state = ''active'' WHERE id = %L', t.id('playerone')),
  'server code can lift a suspension');
SELECT t.reset();
SELECT t.ok((SELECT suspended_at IS NULL AND moderation_state = 'active' FROM public.profiles WHERE id = t.id('playerone')),
  'and it takes effect');

-- ---- age fields on a profile ----------------------------------------------
SELECT t.as_user(t.id('teenmid'));
SELECT t.lives(format('UPDATE public.profiles SET age_cohort = ''adult'', age_category = ''adult'', age_review_required = false WHERE id = %L', t.id('teenmid')),
  'a minor can send an update to their own profile');
SELECT t.reset();
SELECT t.eq(public.age_cohort_of(t.id('teenmid')), 'teen_13_15', 'but cannot declare themselves an adult');

-- ---- posting a clip about a child -----------------------------------------
SELECT t.guardian('guardian', 'kidyoung');
SELECT t.guardian('guardian', 'teenmid');
SELECT t.guardian('guardian', 'teenold');
SELECT t.reel('guardian', 'about-kid');
SELECT t.reel('guardian', 'about-teenmid');
SELECT t.reel('guardian', 'about-teenold');
SELECT t.reel('stranger', 'by-stranger');
UPDATE public.child_controls SET ai_analysis = true;

SELECT t.throws(format('UPDATE public.highlight_reels SET subject_child_id = %L WHERE id = %L', t.id('kidyoung'), t.id('reel-about-kid')),
  'FAMILY_POSTS_OFF', 'a family clip is refused while the family_posts switch is off');

INSERT INTO public.app_settings (key, value) VALUES ('family_posts', '{"enabled": true}')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

SELECT t.throws(format('UPDATE public.highlight_reels SET subject_child_id = %L WHERE id = %L', t.id('kidyoung'), t.id('reel-by-stranger')),
  'FAMILY_POST_NOT_GUARDIAN', 'only a verified guardian can post a clip of a child');
SELECT t.throws(format('UPDATE public.highlight_reels SET subject_child_id = %L WHERE id = %L', t.id('teenold'), t.id('reel-about-teenold')),
  'FAMILY_POST_UNDER_16_ONLY', 'a clip of a 16-17 year old is refused');
SELECT t.throws(format('UPDATE public.highlight_reels SET subject_child_id = %L WHERE id = %L', t.id('playerone'), t.id('reel-about-teenold')),
  'FAMILY_POST_NOT_GUARDIAN', 'an adult cannot be tagged as someone''s child');

UPDATE public.child_controls SET ai_analysis = false WHERE child_user_id = t.id('kidyoung');
SELECT t.throws(format('UPDATE public.highlight_reels SET subject_child_id = %L WHERE id = %L', t.id('kidyoung'), t.id('reel-about-kid')),
  'FAMILY_POST_AI_OFF', 'a clip is refused while the child''s AI analysis is off');
UPDATE public.child_controls SET ai_analysis = true WHERE child_user_id = t.id('kidyoung');

SELECT t.lives(format('UPDATE public.highlight_reels SET subject_child_id = %L WHERE id = %L', t.id('kidyoung'), t.id('reel-about-kid')),
  'a guardian can post a clip of their under-13 child');
SELECT t.lives(format('UPDATE public.highlight_reels SET subject_child_id = %L WHERE id = %L', t.id('teenmid'), t.id('reel-about-teenmid')),
  'and of their 13-15 year old');

ROLLBACK;
