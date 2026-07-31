# Fix "Could not save profile"

## What's wrong

Saving a profile (onboarding and Edit profile) fails with a permission error from the backend, not a bug in the form code. Verified against the live database:

- The `profiles` table has no table-level or column-level privileges granted to any role (`anon`, `authenticated`, `service_role`) — the grant list is empty.
- Its access rules are otherwise correct: signed-in users may read all profiles and insert/update only their own row; anonymous visitors may read.

Without privileges, every read/write is rejected before the rules are even evaluated. This matches the exact error the app receives on save: `permission denied for table profiles`, with the hint to grant privileges.

Public player cards likely also read stale/cached data or fail for the same reason.

## The fix

One database migration that restores privileges matching the existing policies:

- `authenticated`: SELECT, INSERT, UPDATE on `public.profiles` (no DELETE — deletes stay blocked).
- `anon`: SELECT only, keeping public player cards working.
- `service_role`: ALL, for server-side/admin paths.

Birthday privacy is unaffected: it stays behind the existing `get_my_birthday` function, which the app already calls.

## Verification

- Re-read the grants to confirm they exist.
- Run the security linter to confirm nothing new is flagged.
- Save a profile from the running app and confirm the write persists (no 403), and that a public player card still loads.

No frontend changes are planned.
