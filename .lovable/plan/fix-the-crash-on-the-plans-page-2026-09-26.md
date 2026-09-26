# Fix the crash on the Plans page

## What's wrong
Opening the Plans page while signed in shows the error screen. The browser error is:
"cannot add `postgres_changes` callbacks for realtime:entitlements-<user id> after `subscribe()`".

The Plans page checks your subscription in more than one place at the same time. Each check opens a live-update listener with the **same name**. The second one gets back the listener the first one already started, tries to add to it, and crashes the page.

## Fix
- In `src/hooks/useEntitlements.ts`, give each listener its own unique name (user id plus a random suffix made once per mount), so two checks on one page no longer collide.
- Nothing else changes: the same data is read and updates still arrive live.

## Check
- Open /plans signed in and confirm it loads with no error screen.
- Confirm other pages that show plan status (settings, superadmin payments) still load.
