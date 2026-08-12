# Fix the Lovable mobile preview loading failure

## Verified current state

- The affected preview is on the authenticated `/players` screen at a 469×1050 mobile viewport.
- Authentication and the Players data requests are succeeding with HTTP 200 responses, including the account profile, player availability, and profile details.
- The live preview did not respond to a lightweight page-state check, so the failure is in the client boot/render path rather than a confirmed backend outage.
- The root currently has three separate loading/recovery layers: the pre-React boot watchdog, the authentication gate, and the onboarding/profile setup guards. The Players screen also starts several profile and availability reads at mount.

## Plan

1. **Reproduce and identify the exact stalled layer**
   - Run the authenticated mobile preview from a clean load and from a refresh of `/players`.
   - Capture the rendered DOM, browser errors, pending requests, navigation changes, and the root auth-gate diagnostics.
   - Distinguish whether the tab is stuck before React starts, inside account hydration/onboarding verification, or while rendering Players.

2. **Remove the confirmed blocking or loop condition**
   - If account hydration is stalled, make its verification bounded and ensure a valid persisted session cannot leave the screen waiting indefinitely.
   - If repeated auth/profile subscriptions or mount-time reads are causing a render/request loop, consolidate them around the existing shared auth/profile state and stabilize effect dependencies.
   - If Players rendering is blocking the mobile tab, isolate the expensive mount path and defer only the nonessential panel/map work while keeping the player list immediately usable.
   - Preserve the existing signed-out redirect and incomplete-onboarding behavior.

3. **Keep recovery visible and bounded**
   - Ensure every loading state exits into either the requested page, sign-in, onboarding, or an actionable retry screen.
   - Prevent automatic reload loops and avoid showing a permanent spinner when the app or network genuinely fails.

4. **Add regression coverage**
   - Add an authenticated mobile E2E check for opening and refreshing `/players` with a persisted social-login session.
   - Assert that the page leaves all boot/auth loading fallbacks, renders Players, and does not continuously repeat account verification or navigation.

5. **Verify in the Lovable preview**
   - Test the exact mobile viewport with the current signed-in session.
   - Confirm `/players` loads after cold navigation and refresh, controls respond, and no new console errors or failed critical requests appear.

## Technical scope

Likely files are the root authentication/boot flow, shared auth/profile hooks, and—only if the trace points there—the Players route or its mount-time child panels. No visual redesign, data-model change, or unrelated route work is included.
