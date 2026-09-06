# Publish and verify the live link

Goal: put the current app on its public address, then confirm the sign-up steps and Host a game page work there, outside the preview.

## Steps

1. Run a security check first and report anything critical, since a critical finding can block publishing.
2. Publish the app to its public address: https://open-run-connect.lovable.app (the connected domains ballacity.com / www.ballacity.com serve the same published version).
3. Wait for the deployment to finish, then open the public link in a clean browser session (no preview login) and confirm:
   - the home page loads,
   - the sign-in page loads,
   - after signing in with a test account, the date-of-birth and profile-type steps appear when needed and complete,
   - Host a game opens and shows its heading instead of bouncing to a dead link.
4. Report the results, including anything that behaves differently live than in the preview.

## Notes

- No app code changes are part of this. If the live check turns up a real problem, I'll come back with a separate fix plan rather than patching mid-publish.
- Publishing does not change who can see the site beyond its current visibility setting; if the live link asks for a login, I'll check that setting and flag it.
