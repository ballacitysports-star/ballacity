## What's broken

The public player card at `/players/:userId` fails for signed-out visitors. Verified in the database:

- `public.profiles` has **no table or column SELECT privilege for `anon`** (only `authenticated` has column-level SELECT on the safe columns). The card's `profiles` query therefore returns a permission error, and the page falls through to "Player not found".
- The only SELECT policy on `profiles` (`Profiles viewable by authenticated users`) is scoped to the `authenticated` role, so even with grants, anon rows would be filtered out.
- `profile_ages()` has EXECUTE for `authenticated` only (`anon` = false), so the age lookup also errors when signed out.

This is fallout from the earlier PII-hardening migration, which revoked broad access and re-granted it to `authenticated` only.

## Fix

**1. Migration — restore public read of non-PII profile fields**

- `GRANT SELECT (id, username, display_name, avatar_initials, bio, sport, created_at, updated_at, links, city, avatar_url, cover_url, graduating_class, account_type, sport_levels) ON public.profiles TO anon;` — `birthday` stays revoked for both anon and authenticated (owner-only), preserving the security finding fix.
- Add an anon SELECT policy: `CREATE POLICY "Profiles viewable by anon" ON public.profiles FOR SELECT TO anon USING (true);`
- `GRANT EXECUTE ON FUNCTION public.profile_ages(uuid[]) TO anon;` — it returns only a derived age, no birthdate.

**2. Same-category check for the other queries the public card makes**

Before finishing, verify grants/policies for `anon` on the sibling reads on this page so the card is not half-broken:
- `trainer_org_members` + `trainer_orgs` (the gyms chips)
- `reviews` (reputation badge / reviews dialog)
- `player_availabilities` (open availability block)
- `follows` (follower/following counts)

Where a table is already meant to be publicly readable, add the matching `anon` SELECT grant and policy; where it is intentionally auth-only, leave it and let the card degrade gracefully instead of erroring.

**3. Verify**

Load `/players/:userId` in a signed-out browser session and confirm the name, avatar, sports, and age render with no console/network errors, then re-check signed-in rendering is unchanged.

## Notes

No UI changes are needed — the component logic is fine; it is purely a database access problem.
