-- P2-4 slice 1: businesses as listings (supabase/migrations/20261108170000_business_listings.sql).
-- Every listing is a venue unless its owner makes it a business; only 'facility' and 'business' are allowed;
-- signed-out visitors can read the type; only the owner (or an admin) changes it; claims and reviews are unchanged.
BEGIN;

SELECT t.person('shopowner', 40), t.person('stranger', 33);
INSERT INTO public.trainer_orgs (id, owner_id, name, handle) VALUES
  (t.id('shop'), t.id('shopowner'), 'City Sports Shop', 'city-sports-shop-740');

SELECT t.eq((SELECT org_type FROM public.trainer_orgs WHERE id = t.id('shop')), 'facility',
  'a new listing is a venue unless its owner says otherwise');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.trainer_orgs WHERE org_type IS NULL OR org_type NOT IN ('facility', 'business')),
  'every existing listing has a valid type');
SELECT t.throws(format($$UPDATE public.trainer_orgs SET org_type = 'restaurant' WHERE id = %L$$, t.id('shop')),
  'check constraint', 'only facility or business is allowed');

SELECT t.as_user(t.id('shopowner'));
UPDATE public.trainer_orgs SET org_type = 'business', category = 'Sporting goods' WHERE id = t.id('shop');
SELECT t.reset();
SELECT t.eq((SELECT org_type FROM public.trainer_orgs WHERE id = t.id('shop')), 'business',
  'the owner makes it a business');

SELECT t.as_user(t.id('stranger'));
UPDATE public.trainer_orgs SET org_type = 'facility' WHERE id = t.id('shop');
SELECT t.reset();
SELECT t.eq((SELECT org_type FROM public.trainer_orgs WHERE id = t.id('shop')), 'business',
  'someone else cannot change it');

SELECT t.as_anon();
SELECT t.eq((SELECT org_type FROM public.trainer_orgs WHERE id = t.id('shop')), 'business',
  'a signed-out visitor can read the type');
SELECT t.throws($$SELECT phone FROM public.trainer_orgs LIMIT 1$$, 'permission denied',
  'and still cannot read contact details');
SELECT t.reset();

ROLLBACK;
