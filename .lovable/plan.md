# Publish a public link and verify setup steps

## Goal

Put the current app live at a public address so you can open it in a normal browser (no Lovable login) and confirm the "Host a game" screen and the birthday / profile-type setup steps behave correctly outside the preview.

## Current state (checked)

- The project is already published and its visibility is **public**, so the live address works for anyone: https://open-run-connect.lovable.app (plus your own domains ballacity.com / www.ballacity.com).
- The security check shows **no critical issues**. Two lower-level warnings exist and do not block going live:
  - trainer / organisation listings expose phone and email to visitors who aren't signed in.
  - one database helper can be called without signing in.
- No build errors are recorded for the current code.

## Steps

1. Re-publish so the live address serves the latest code, including the setup-step work (birthday step and profile-type step now shown in place instead of sending you to a link that never loads).
2. Wait for the deployment to finish, then confirm the public address answers in a clean browser session with no Lovable login.
3. Walk the live site: open the home page, sign in with the test player account, then open the page for hosting a game and confirm the "Host a game" heading appears.
4. Check the two setup steps on the live site: their own pages load directly, and when a birthday or profile type is missing the step appears in place and continues to the requested page once completed.
5. Report what loaded, with any error seen in the browser or on the server, and the exact live address to open.

## Notes

- No app code changes are planned. If step 3 or 4 reveals a real failure on the live site, I'll come back with a separate fix plan rather than patching blindly during verification.
- The two security warnings are worth addressing later; say the word and I'll plan hiding trainer phone/email from anonymous visitors and locking down that database helper.
