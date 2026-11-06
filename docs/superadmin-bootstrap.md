# Superadmin bootstrap

## How the first superadmin was made

Migration `supabase/migrations/20260813172852_fbb914ad-7600-4056-8959-6f7e1ae70460.sql`
grants `superadmin` to the account with one specific email address:

```sql
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'superadmin'::public.app_role FROM auth.users WHERE email = '<owner address>'
ON CONFLICT (user_id, role) DO NOTHING;
```

It ran once, on production, on 2026-08-13. That is applied history, so the file is
not edited or deleted: changing an applied migration breaks the ledger check in
`docs/migration-history-reconciliation.md`.

What it does elsewhere:

| Where it runs | What happens |
| --- | --- |
| Production (already applied) | Nothing more. It ran once and will not run again. |
| A fresh replay (`scripts/db-test.mjs`, a new project, the E2E sandbox) | Nothing. `auth.users` is empty at migration time, so the `SELECT` finds no row. |
| A copy of production data replayed again | It is idempotent (`ON CONFLICT DO NOTHING`), so it only re-asserts a role that account already holds. |

So no environment gets a superadmin from this file except production, and production
already has one. Every other environment needs a deliberate grant.

## Granting a superadmin now

Use `scripts/bootstrap-superadmin.mjs`. Do not write a migration that names a person.
A unit test (`scripts/migrations-no-identities.test.mjs`) fails if a migration contains
an email address literal. The file above is the only allowed exception.

1. Sign up the account in that environment as usual.
2. Do a dry run. It writes nothing:

   ```bash
   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service role key> \
     node scripts/bootstrap-superadmin.mjs --email <address>
   ```

3. If the output names the right project and account, run it again with `--apply`.

Safety properties:

- The default is a dry run.
- It only adds the `superadmin` role. It never removes or changes other roles.
- The account must already exist. The script does not create accounts.
- Production (`cpqihhcqeivbgxqbzatv`) is refused unless `--allow-production` is also
  passed.
- The key comes from the environment and is never printed. Do not paste it into
  chat, a commit, or a CI log.
- The write goes through the service role. If PR #300 has been applied, signed-in API
  callers cannot write `user_roles` at all, and the `aa_guard_user_roles_write_trg`
  trigger rejects any write that has a signed-in user behind it.

After the first superadmin exists, give further roles from the app's superadmin Users
tab, which runs on the server.
