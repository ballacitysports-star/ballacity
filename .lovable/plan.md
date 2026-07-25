## Goal

Lock in the routing contract for `getOnboardingStatus` (`src/lib/onboarding.functions.ts`) with tests that exercise the three cases the user called out plus the surrounding branches, so onboarding routing never silently regresses.

## Approach

`getOnboardingStatus` is a `createServerFn` handler that mixes three inputs: the `profiles.account_type` row read under RLS, the admin API `identities` list, and the session `claims.app_metadata.provider` fallback. That combination is not cleanly testable end-to-end without a signed-in user + admin key, so extract the decision logic into a pure helper and test that directly. The `createServerFn` handler becomes a thin adapter that fetches inputs and delegates.

### 1. Refactor `src/lib/onboarding.functions.ts`

Extract a pure function next to the server fn (same file, exported):

```ts
export function resolveOnboardingStatus(input: {
  accountType: string | null | undefined;
  identities: Array<{ provider: string }> | null | undefined;
  appMetadataProvider: string | null | undefined;
  claimsProvider: string | null | undefined;
  adminLookupFailed?: boolean;
}): OnboardingStatus
```

Rules mirrored exactly from the current handler:
- Identity match against `SOCIAL_PROVIDERS` wins first — sets `isSocial: true` and `provider`.
- Otherwise fall back to `appMetadataProvider` (string only) for `provider`, `isSocial` stays false unless it is also a social provider.
- When `adminLookupFailed`, ignore identities/appMetadata and use `claimsProvider`: set `provider`, and `isSocial` when it's in `SOCIAL_PROVIDERS`.
- `needsOnboarding = !(accountType is one of ALLOWED_TYPES)`.
- Returned `accountType` is the valid type or `null`.

The handler is updated to call `resolveOnboardingStatus` with fetched inputs; no behavior change.

### 2. Add `src/lib/onboarding-status.test.ts` (vitest, pure — no backend, no skip)

Cases the user asked for, plus the natural neighbors so the matrix is complete:

1. **Missing `app_metadata.provider`, identity present (google)** → `isSocial: true`, `provider: "google"`, `needsOnboarding: true` when accountType null.
2. **Missing `app_metadata.provider`, identity present (apple)** → same shape with `provider: "apple"`.
3. **Identity present but non-social (e.g. `email`)**, no metadata → `isSocial: false`, `provider: null`.
4. **Identity missing, `app_metadata.provider = "google"`** → `isSocial: true`, `provider: "google"` (populated from metadata fallback).
5. **Identity missing, `app_metadata.provider = "email"`** → `isSocial: false`, `provider: "email"`.
6. **Identity missing, no metadata** → `isSocial: false`, `provider: null`.
7. **Admin lookup failed, `claimsProvider = "google"`** → `isSocial: true`, `provider: "google"` (identities ignored).
8. **Admin lookup failed, no claims** → `isSocial: false`, `provider: null`.
9. **`accountType` valid (`"player"`)** → `needsOnboarding: false`, `accountType: "player"` regardless of identity.
10. **`accountType` invalid (`"admin"`)** → `needsOnboarding: true`, `accountType: null`.
11. **Multiple identities, first non-social + second social** → picks the social one, `isSocial: true`.

Each test asserts the full `OnboardingStatus` object shape to catch drift on any field.

### 3. Add `src/lib/onboarding.integration.test.ts` (real backend, auto-skips)

Follows the pattern in `src/lib/invite-deeplink.integration.test.ts`: skips when `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` are absent, uses `TEST_ACCOUNTS` to sign in, and invokes the server fn via `useServerFn` isn't available in Node — instead directly call the server-fn stub over `fetch` is blocked by the RPC protocol. So this file will only:
- Sign in as the seeded player fixture (which has `account_type = "player"` and email provider).
- Assert `resolveOnboardingStatus` returns `needsOnboarding: false, isSocial: false` for that shape when fed the real profile row + a synthetic `identities: [{provider:"email"}]` list.
- Confirms the pure helper's assumptions match a real profile row (defensive against schema drift in `profiles.account_type`).

Full end-to-end coverage of the `createServerFn` handler stays in the existing Playwright specs (`e2e/oauth-missing-provider-metadata.spec.ts`, `e2e/oauth-new-user-onboarding.spec.ts`) which already exercise the wire behavior via the browser.

## Files

- `src/lib/onboarding.functions.ts` — extract `resolveOnboardingStatus`, keep handler wiring.
- `src/lib/onboarding-status.test.ts` — new, ~11 pure cases.
- `src/lib/onboarding.integration.test.ts` — new, backend-guarded schema check.

## Verification

- `bunx vitest run src/lib/onboarding-status.test.ts src/lib/onboarding.integration.test.ts`
- Existing OAuth E2E specs continue to pass unchanged (no behavior change in the handler).
