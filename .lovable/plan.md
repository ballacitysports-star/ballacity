Point the gear icon on `/profile` to `/settings` instead of `/profile/edit`, so the Settings screen (which already has Edit profile, Notifications, Security, Sign out, and Delete account) is reachable from the profile.

## Changes

- `src/routes/_tabs.profile.tsx`: update the gear icon's `Link to` from `/profile/edit` to `/settings`. No other UI or logic changes.

## Notes

- Edit profile remains accessible via the "Edit profile" row inside Settings.
- No backend changes.