# Fix superadmin access

## What's wrong

The `/superadmin` page works, but nobody can get in. The roles table is completely empty: when the superadmin feature was added, it granted the new role to whoever was already an admin — and there were no admins. So every visit fails the access check and bounces back to the home page.

## The fix

Grant the `superadmin` role to **ballacitysports@gmail.com** directly in the database, so that account can open `/superadmin` and manage roles for everyone else from the Users tab.

## Steps

1. Database change: insert a `superadmin` row in the roles table for `ballacitysports@gmail.com` (idempotent — safe if re-run).
2. Verify the role exists and that the access-check function returns true for that account.
3. Confirm `/superadmin` loads for that account (control center shell + tabs), and that other accounts still get bounced.

## Technical notes

- Single migration: `INSERT INTO public.user_roles (user_id, role) SELECT id, 'superadmin' FROM auth.users WHERE email = 'ballacitysports@gmail.com' ON CONFLICT (user_id, role) DO NOTHING;`
- No code changes needed — `is_superadmin`, the server functions, and the route gate are already in place.
- Additional superadmins can then be granted from the Users tab instead of via migrations.
