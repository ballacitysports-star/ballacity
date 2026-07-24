## Add Apple sign-in to `/auth`

Mirror the existing Google flow in `src/routes/auth.tsx` and enable the provider server-side.

### Steps

1. **Enable Apple provider** via `supabase--configure_social_auth` with `providers: ["apple"]` (managed Apple auth — no BYO credentials).
2. **`src/routes/auth.tsx`**:
   - Add an `apple(opts)` handler that mirrors `google(...)`: same synchronous first call to `lovable.auth.signInWithOAuth("apple", { redirect_uri: window.location.origin })`, same `next` stashing to `sessionStorage`, same `pendingAccountType` handling, same popup/vendor error toasts (labels swapped to "Apple"), same analytics events.
   - Add a "Continue with Apple" button under the Google button using the existing pill style, with an Apple logo SVG and `disabled={busy}`.
3. **Analytics**: reuse `trackSigninEvent`; include `{ provider: "apple" | "google" }` in event payloads so we can distinguish. Update the two existing Google call sites to pass `provider: "google"` for parity (small, additive).
4. **No other changes**: `__root.tsx` post-auth flow (`openrun:oauth-next` consumption, account-type reconciliation) already works for any provider, since it listens to `SIGNED_IN` regardless of source.

### Verification

- Manually click "Continue with Apple" in preview → popup opens; on cancel, no error toast crash.
- Confirm `pending_account_type` still stored in localStorage when signing up as a new type via Apple.
- Extend `e2e/google-vendor-rejection.spec.ts` (or add a sibling `apple-vendor-rejection.spec.ts`) that stubs `lovable.auth.signInWithOAuth("apple", ...)` and asserts the actionable toast + preserved `next` behavior.