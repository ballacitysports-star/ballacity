## Goal

Add `e2e/google-vendor-rejection.spec.ts` that reproduces the "failed to sign in with vendor" case, verifies the actionable toast shows, and asserts the user lands back in the correct auth/onboarding state so they can retry.

Because a vendor rejection in the current code does NOT navigate (by design — the user stays on `/auth` to retry or switch to email/password), "back into the correct onboarding flow" is interpreted as: the auth screen retains the right mode (signin vs. signup), `next` is preserved, and the pending account-type stash is intact so a subsequent successful sign-in still lands in the correct onboarding step.

## Scenarios

1. **Signin path — vendor rejection surfaces actionable toast**
   - Visit `/auth?next=/feed`.
   - Stub `lovable.auth.signInWithOAuth` to resolve with `{ error: { message: "failed to sign in with vendor" }, redirected: false }`.
   - Click **Continue with Google**.
   - Assert the sonner toast title *"Google sign-in was rejected by the provider"* appears with description containing *"sign in with your email and password"*.
   - Assert URL still matches `/auth?next=%2Ffeed` (no bounce).
   - Assert `sessionStorage["openrun:oauth-next"] === "/feed"` (stashed so a retry keeps the destination).
   - Assert the Google button is re-enabled.

2. **Signup path — account type preserved for onboarding**
   - Visit `/auth`, switch to **Create account**, pick `player`, advance to the form step.
   - Stub the same vendor error.
   - Click **Continue with Google**.
   - Assert the same actionable toast.
   - Assert page is still on `/auth`, still in signup/form step (email field visible).
   - Assert `localStorage["openrun:pending-account-type"] === "player"` — a successful email/password retry will still land in the player onboarding step.

3. **Negative control — non-vendor error uses plain toast**
   - Stub the helper with `{ error: { message: "network unreachable" } }`.
   - Click Google.
   - Assert a toast containing `network unreachable` shows and the vendor-specific description does NOT appear. Confirms the branch is scoped to vendor/provider/oauth wording.

## Test wiring

- No Supabase session required — the spec exercises pre-auth state and does not read `LOVABLE_BROWSER_SUPABASE_*` env vars.
- Stub the OAuth helper by importing the module inside the page and overwriting the method:
  ```ts
  await page.evaluate(async (result) => {
    const mod = await import("/src/integrations/lovable/index.ts");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mod as any).lovable.auth.signInWithOAuth = async () => result;
  }, { error: { message: "failed to sign in with vendor" }, redirected: false });
  ```
  This runs after the page loads but before the button is clicked, so the synchronous call inside `google()` picks up the stub.
- Selectors:
  - Google button: `getByRole("button", { name: /google/i })`.
  - Toast title: `getByText(/rejected by the provider/i)`.
  - Toast description: `getByText(/sign in with your email and password/i)`.
- Read storage back with `page.evaluate` and assert equalities.

## Files touched

- **Create** `e2e/google-vendor-rejection.spec.ts` (~120 lines).
- No production changes — `src/routes/auth.tsx` already implements the branching under test.

## Out of scope

- Real Google OAuth vendor failures (require live provider conditions).
- Verifying the successful email/password retry path (already covered by existing auth specs).
- Changing runtime behaviour to push users to `/onboarding/account-type` on vendor failure — that would require a code change beyond the requested test.
