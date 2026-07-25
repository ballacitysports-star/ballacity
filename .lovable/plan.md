Plan to fix the Google/Apple rejection:

1. Update the profile onboarding schema
   - Change `profiles.account_type` so it can be empty for brand-new social sign-ins.
   - Remove the database default that currently forces new profiles toward `player`.
   - Keep existing valid account types intact: `player`, `team`, `trainer`, `gym`.

2. Preserve onboarding behavior
   - Keep email/password signup passing the selected account type.
   - Keep Google/Apple signup creating a profile with no account type so the app routes the user to `/onboarding/account-type`.
   - Do not auto-create social users as players.

3. Reconfirm social auth setup
   - Re-enable/configure Google and Apple managed social sign-in in the backend so provider settings are current.

4. Verify the fix
   - Run the OAuth/new-user regression tests already present for Google and Apple onboarding.
   - Check auth logs after the change to confirm the previous database error is gone.

Confirmed cause from current backend state: the profile creation trigger inserts `NULL` for new social users, but `profiles.account_type` is currently `NOT NULL` with a `player` default, which matches the auth error shown: `null value in column "account_type" violates not-null constraint`.