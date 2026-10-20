-- Who can see a reel, by the owner's age. reel_audience() is the single choke
-- point for public visibility (the highlight_reels read policy calls it), so
-- these check the function and what an anonymous visitor or another signed-in
-- member can actually read through the table.
--
--   adult         draft: nobody else.  Posted: everyone, signed in or not.
--   16-17         posted reels: signed-in members only, never anonymous.
--   13-15         never public; the guardian-approved team path is in
--                 20_teen_team_sharing.test.sql.
--   under 13      never public.
--   family clip   (a guardian posting about a child) never public.
BEGIN;

SELECT t.person('adultowner', 30), t.person('teenold', 17), t.person('teenmid', 14),
       t.person('kidyoung', 10), t.person('guardian', 40), t.person('stranger', 28);
SELECT t.guardian('guardian', 'teenmid'), t.guardian('guardian', 'kidyoung');

-- One completed, posted reel per owner. Setup runs as the superuser.
SELECT t.reel('adultowner', 'adult'), t.reel('teenold', 'teenold'),
       t.reel('teenmid', 'teenmid'), t.reel('kidyoung', 'kid');

SELECT t.eq(public.reel_audience(t.id('reel-adult')), 'public', 'adult posted reel is public');
SELECT t.eq(public.reel_audience(t.id('reel-teenold')), 'members', '16-17 posted reel is members only');
SELECT t.eq(public.reel_audience(t.id('reel-teenmid')), 'none', '13-15 reel is never public');
SELECT t.eq(public.reel_audience(t.id('reel-kid')), 'none', 'under-13 reel is never public');

-- The state of a reel can only narrow its audience.
UPDATE public.highlight_reels SET is_draft = true WHERE id = t.id('reel-adult');
SELECT t.eq(public.reel_audience(t.id('reel-adult')), 'none', 'an adult draft is private');
UPDATE public.highlight_reels SET is_draft = false, hidden_at = now() WHERE id = t.id('reel-adult');
SELECT t.eq(public.reel_audience(t.id('reel-adult')), 'none', 'a hidden reel is private');
UPDATE public.highlight_reels SET hidden_at = NULL, status = 'processing' WHERE id = t.id('reel-adult');
SELECT t.eq(public.reel_audience(t.id('reel-adult')), 'none', 'a reel that has not finished processing is private');
UPDATE public.highlight_reels SET status = 'completed' WHERE id = t.id('reel-adult');
SELECT t.eq(public.reel_audience(t.id('reel-adult')), 'public', 'restoring the adult reel makes it public again');

-- A family clip: a guardian's reel tagged with their child. Posting one needs the
-- family_posts switch on and the child's AI analysis allowed, so set both.
INSERT INTO public.app_settings (key, value) VALUES ('family_posts', '{"enabled": true}')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
UPDATE public.child_controls SET ai_analysis = true WHERE child_user_id = t.id('kidyoung');
SELECT t.reel('guardian', 'family');
SELECT t.eq(public.reel_audience(t.id('reel-family')), 'public', 'a guardian''s own reel is public like any adult reel');
UPDATE public.highlight_reels SET subject_child_id = t.id('kidyoung') WHERE id = t.id('reel-family');
SELECT t.eq(public.reel_audience(t.id('reel-family')), 'none', 'tagging a child makes it a family clip, which is never public');

-- What each kind of viewer can really read through the table.
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-adult'')'), 1, 'an anonymous visitor sees the adult reel');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-teenold'')'), 0, 'an anonymous visitor does not see the 16-17 reel');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-teenmid'')'), 0, 'an anonymous visitor does not see the 13-15 reel');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-kid'')'), 0, 'an anonymous visitor does not see the under-13 reel');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-family'')'), 0, 'an anonymous visitor does not see a family clip');

SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-adult'')'), 1, 'a signed-in stranger sees the adult reel');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-teenold'')'), 1, 'a signed-in stranger sees the 16-17 reel');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-teenmid'')'), 0, 'a signed-in stranger does not see the 13-15 reel');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-kid'')'), 0, 'a signed-in stranger does not see the under-13 reel');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-family'')'), 0, 'a signed-in stranger does not see a family clip');

SELECT t.as_user(t.id('teenmid'));
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-teenmid'')'), 1, 'the 13-15 owner still sees their own reel');
SELECT t.reset();

ROLLBACK;
