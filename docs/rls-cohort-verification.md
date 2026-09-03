# Cohort RLS verification notes

RLS policy correctness cannot be asserted from unit tests (the client always runs
as one role). Use these SQL-editor checks with synthetic accounts after any change
to `reel_publicly_visible`, `profile_visibility_of`, or `block_child_hosting`.

Setup (inside a transaction so nothing persists):

```sql
BEGIN;
-- pick an existing auth user id per cohort, or fake the cohort on a test profile
UPDATE public.profiles SET age_cohort = 'teen_13_15' WHERE id = '<TEST_USER>';
```

## 1. Public reel visibility respects the cohort

```sql
-- as anonymous
SET LOCAL ROLE anon;
SELECT id FROM public.highlight_reels WHERE user_id = '<TEST_USER>';   -- expect 0 rows
RESET ROLE;

-- 16-17 = "protected": members only, never anon
UPDATE public.profiles SET age_cohort = 'teen_16_17' WHERE id = '<TEST_USER>';
SET LOCAL ROLE anon;
SELECT count(*) FROM public.highlight_reels WHERE user_id = '<TEST_USER>';  -- expect 0
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<OTHER_ADULT_USER>","role":"authenticated"}';
SELECT count(*) FROM public.highlight_reels WHERE user_id = '<TEST_USER>';  -- expect >0
RESET ROLE;
```

Only one permissive SELECT policy exists for anon/authenticated
(`Anyone can view visible completed reels`); the cohort check is folded into its
`USING` clause so it cannot be OR'd away. Admin policies (`Admins view all reels`)
are intentionally exempt.

## 2. Missing privacy_preferences row is not public for minors

```sql
DELETE FROM public.privacy_preferences WHERE user_id = '<TEST_USER>';
UPDATE public.profiles SET age_cohort = 'child_under_13' WHERE id = '<TEST_USER>';
SELECT public.profile_visibility_of('<TEST_USER>');   -- expect 'private'
UPDATE public.profiles SET age_cohort = 'teen_13_15' WHERE id = '<TEST_USER>';
SELECT public.profile_visibility_of('<TEST_USER>');   -- expect 'members'
UPDATE public.profiles SET age_cohort = 'adult' WHERE id = '<TEST_USER>';
SELECT public.profile_visibility_of('<TEST_USER>');   -- expect 'public' (unchanged behaviour)
```

Layer two: `handle_new_user()` now inserts a `privacy_preferences` row at signup,
and `trg_reclamp_privacy_on_cohort_change` re-runs
`enforce_minor_privacy_floor` whenever `profiles.age_cohort` changes, so a row
created before the birthday is known is clamped as soon as the cohort resolves.

## 3. Hosting is blocked below 16 at the DB level

```sql
UPDATE public.profiles SET age_cohort = 'teen_13_15' WHERE id = '<TEST_USER>';
INSERT INTO public.hosted_games (host_id, title, sport)
VALUES ('<TEST_USER>', 'bypass attempt', 'basketball');
-- expect: ERROR  CHILD_CANNOT_HOST
ROLLBACK;
```

The trigger checks `age_cohort_of(host_id) NOT IN ('teen_16_17','adult')`, so a
renamed or newly added minor cohort stays blocked by default.
