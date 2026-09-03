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
UPDATE public.profiles SET age_cohort = 'unknown' WHERE id = '<TEST_USER>';
SELECT public.profile_visibility_of('<TEST_USER>');   -- expect 'private' (unknown cohort, e.g. pre-birthday signup window)
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

## 5. Guardian family overview (protected age columns)

`profiles.age_cohort` is not selectable by the `authenticated` role, so any
parent-facing read of a child's cohort must go through the guardian-scoped
`guardian_children_overview()` SECURITY DEFINER RPC. Confirm the column really
is protected and the RPC is reachable only when signed in:

```sql
-- expect: false for age_cohort, true for display_name
select has_column_privilege('authenticated','public.profiles','age_cohort','SELECT') as cohort,
       has_column_privilege('authenticated','public.profiles','display_name','SELECT') as name;

-- expect: prosecdef true, authenticated true, anon false
select p.prosecdef,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'guardian_children_overview';
```

The append-only `family_audit_log` is written only by database triggers on
`child_controls`, `parental_consents` and `guardian_links`; updates and deletes
raise `family_audit_log is append-only`, and reads are limited to the child,
their active guardians and moderators.

## 5. Live end-to-end family verification (parent → two minors)

Executed against the live backend with three throwaway accounts (one adult, a
10-year-old and a 14-year-old), each acting through the Data API with its own
user token — not through the UI. The accounts were deleted afterwards.

Observed and passing:

- `set_my_birthday` returned the authoritative cohorts (`adult`,
  `child_under_13`, `teen_13_15`) and `consent_required` for both minors.
- Only the adult could call `create_minor_invite` (`ADULT_REQUIRED` for minors);
  invites are single use (`INVITE_USED` on replay) and hashed-token lookup works.
- Both minors redeemed their own invite; `guardian_children_overview()` returned
  both children for the parent and an empty set for a minor caller.
- Protected `profiles.age_cohort` remains unreadable by `authenticated`
  (`42501`), so the overview RPC is the only cohort path.
- `set_child_controls` succeeded only for the linked parent — `NOT_AUTHORIZED`
  for an unrelated minor and for the child itself. Each child reads only its own
  `child_controls` row; the parent reads all linked children's rows.
- `family_audit_log` showed `consent.required`, `link.active`,
  `consent.approved`, `controls.created`; a child sees only its own rows, and a
  direct `PATCH` changed nothing (no UPDATE policy).
- `revoke_guardian_link` was rejected for a non-parent (`NOT_FOUND`) and, for
  the parent, revoked the link plus that parent's consent; afterwards the child
  disappeared from the overview, its controls became unreadable to the parent,
  and its writes failed with `CHILD_CONSENT_REQUIRED`.
- Minors cannot host (`CHILD_CANNOT_HOST`); anonymous callers cannot execute
  `guardian_children_overview` (`42501`); minor privacy rows default to
  `profile_visibility = private`.

Two real defects were found by this run and fixed:

1. `block_locked_child_activity()` resolved the owner column with one SQL `CASE`
   over `NEW.sender_id`/`NEW.host_id`/`NEW.user_id`. Postgres prepares that whole
   expression against `NEW`'s rowtype, so every insert into `hosted_games`,
   `highlight_reels` and `player_availabilities` failed with
   `record "new" has no field "sender_id"` — for adults too. Now branched with
   `IF`/`ELSIF`, verified by a successful adult game insert while both minors
   still hit `CHILD_CANNOT_HOST`.
2. `minor_messaging_allowed()` honoured only `child_controls.messaging = 'off'`,
   so a `guardian_only` minor could still DM (and be DM'd by) non-guardians —
   reproduced between the two test minors. The control is now enforced on both
   sides for all minor cohorts: after the fix, minor→minor raised
   `MINOR_MESSAGING_BLOCKED` while minor→linked guardian still succeeded.
