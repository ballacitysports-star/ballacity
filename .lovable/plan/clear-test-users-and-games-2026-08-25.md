# Clear test users and games

Wipe every account except `ballacitysports@gmail.com` (your superadmin) and remove all game content, keeping the schema, policies, and app code untouched.

## What gets deleted

Accounts removed (8):
- choelogic@gmail.com, choesoft@gmail.com, choelives@gmail.com
- davidchoe78@gmail.com, nathanielchoe30@gmail.com
- americandeli237@gmail.com
- 2b86w4kb6d@privaterelay.appleid.com (Apple private relay)
- e2e-player@lovable.test (E2E fixture)

Kept: ballacitysports@gmail.com and its profile/role.

Games removed (both are owned by a host id that no longer has an account):
- "sdfgdfhgsdfgfdsg" (Baseball, Aug 11)
- "sdafasdfasdfasdf" (Basketball, Aug 11)

Game-related rows cleared with them: join requests (10), game participants (3), position waitlist entries, game payment settings, payment submissions and their verification events, and conversations/messages attached to a game.

Also removed as a consequence of deleting those accounts (they belong to the deleted users): their profiles, player availabilities, notifications, follows, feed preferences, highlight reels, and the 2 gym/trainer org listings owned by them. Anything owned by ballacitysports stays.

## Order of operations

1. Delete the game-scoped child rows (payment verification events → payment submissions → game payment settings → waitlist → participants → join requests), then game-linked conversations and their messages.
2. Delete both rows from `hosted_games`.
3. Delete the 8 auth accounts; the existing cascade rules from the account table remove each user's profiles, availabilities, notifications, org/team rows, and reels automatically.
4. Re-query the affected tables to confirm only ballacitysports-owned rows remain, and confirm the feed and profile pages load clean in the preview.

## Notes

- This is data-only: no tables, policies, grants, or triggers change.
- Uploaded images belonging to deleted users stay in storage as orphaned files. Say the word and I'll add a storage sweep for them (avatars, covers, org photos, reel videos) in the same pass.
- The E2E fixture account can be re-created any time from the existing admin-only seeding function, so tests aren't permanently broken.
