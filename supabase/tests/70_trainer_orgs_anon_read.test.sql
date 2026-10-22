-- What an anonymous visitor can read from a facility listing: the public
-- details, but not who owns it, who listed it, or when, and never contact
-- details. Signed-in users still read the owner.
BEGIN;

SELECT t.person('gymowner', 40), t.person('viewer', 30);
INSERT INTO public.trainer_orgs (id, owner_id, name, handle)
VALUES (t.id('gym'), t.id('gymowner'), 'Apex Hub', 'apexhub');

SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.trainer_orgs'), 1, 'a visitor sees the facility');
SELECT t.lives('SELECT id, name, handle, city, address, website, hidden_at, featured_at, booking_url FROM public.trainer_orgs',
  'a visitor can read the public details');
SELECT t.throws('SELECT owner_id FROM public.trainer_orgs', 'permission denied', 'a visitor cannot read the owner');
SELECT t.throws('SELECT listed_by FROM public.trainer_orgs', 'permission denied', 'nor who listed it');
SELECT t.throws('SELECT listed_at FROM public.trainer_orgs', 'permission denied', 'nor when it was listed');
SELECT t.throws('SELECT claimed_at FROM public.trainer_orgs', 'permission denied', 'nor when it was claimed');
SELECT t.throws('SELECT phone FROM public.trainer_orgs', 'permission denied', 'nor its phone');
SELECT t.throws('SELECT email FROM public.trainer_orgs', 'permission denied', 'nor its email');
SELECT t.reset();

SELECT t.as_user(t.id('viewer'));
SELECT t.eq(t.count('SELECT owner_id FROM public.trainer_orgs'), 1, 'a signed-in user still reads the owner');
SELECT t.reset();

ROLLBACK;
