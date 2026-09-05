# Restore the private preview link

## Goal
Make the shared preview URL open reliably instead of stopping before the ballaCity app loads.

## Confirmed diagnosis
- The current preview URL is the expected `id-preview` address, but a direct request without an accepted preview session returns `401` before any app HTML is served.
- The already-connected preview session renders the signed-in feed normally.
- The latest app build is successful, and the hosted backend, authentication, and database are responding normally.
- This points to the private preview access/session layer, not the onboarding, feed, or database code.

## Plan
1. Open the token-bearing preview URL in a clean browser and record its redirect and final response without exposing the token.
2. Confirm whether the shared token is accepted, expired, or replaced by the preview access session during the redirect to the live preview host.
3. Refresh the preview access link/session through the managed preview controls if the token is rejected; do not place the token in app code or environment files.
4. Verify the refreshed link in a clean browser, then confirm `/`, `/auth`, and the signed-in feed render.
5. Recheck browser and server logs for fresh failures. Only investigate app code if the access layer succeeds and the app then fails to render.

## Technical details
- Preserve all current authentication, onboarding, and backend behavior.
- Do not restart the healthy backend or change database policies.
- Success means a new private browser session can follow the shared preview link into the app, while existing preview sessions continue to work.