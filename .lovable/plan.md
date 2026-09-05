# Restore private preview access and verify onboarding

## Goal
Make the project’s private `id-preview` URL authorize successfully, then confirm `/create` and both onboarding steps render and complete normally.

## Confirmed state
- The current `id-preview` URL returns `401` before app HTML is served.
- The latest app build succeeds and there are no current runtime errors.
- The hosted backend, authentication, and database were confirmed healthy in the immediately preceding diagnosis.
- The app already has real routes for `/onboarding/age` and `/onboarding/account-type`, backed by the same screens used by the in-place setup gate.

## Plan
1. Refresh the managed private-preview access session/link rather than changing application authentication or embedding the shared token in code.
2. Open the refreshed `id-preview` URL in a clean browser and verify it reaches the app instead of returning `401`.
3. Sign in with the player fixture account and open `/create`; confirm the page renders either `Host a game` or the required setup step rather than a blank page or dead redirect.
4. Exercise the missing-birthday state and confirm the date-of-birth screen renders, saves, and returns control to `/create`.
5. Exercise the missing-account-type state and confirm the account-type screen renders, saves, and returns control to `/create` or the correct profile-creation destination.
6. Check browser, network, runtime, and server-function logs after each path; only change app code if authorization succeeds and a reproducible app-level failure remains.

## Technical details
- Keep private preview authorization in Lovable’s managed access layer; never persist preview JWTs in source, browser defaults, or environment files.
- Preserve the existing inline onboarding gate and standalone onboarding routes.
- Do not restart or modify the healthy backend unless new evidence shows a backend failure.
- Success means a clean authorized browser loads the private preview and the `/create`, age, and account-type flows render without dead redirects.