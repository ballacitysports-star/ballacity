# Clear all sample data

Wipe the leftover demo/test content so the app starts from a clean slate, keeping only your admin login (`ballacitysports@gmail.com`).

## What gets deleted

- The one sample game: "Team Ballacity" (Baseball, Aug 27) plus any related join requests, participants, waitlist entries, and payment rows.
- The sample team profile "Ballacity" (@ballacity).
- The sample gym/organization "Ballacity" (Buford, GA) and its membership rows.
- The two extra accounts: "David Choe" and "American Deli Perimeter Mall", including their profiles and anything they own.
- Any leftover availability posts, team posts, reviews, notifications, conversations/messages, follows, and uploaded-image moderation rows tied to the above.

## What stays

- Your admin account and login, with its superadmin/admin/moderator roles intact.
- Your profile row itself is kept but reset to a blank state (no linked team/gym profiles), so you can pick a profile type fresh.
- All tables, policies, and app functionality unchanged — only data is removed.

## Technical notes

- Done as one migration that deletes in FK-safe order: game child rows → games → org/team membership + invites/requests → teams/orgs → per-user content (availabilities, posts, reviews, notifications, messages, follows, blocks, reports) → `account_profiles` → `profiles` → `auth.users` for the two non-admin accounts.
- Admin user id `a5f88caf-…` is excluded from all account deletions; its `profiles` row is cleared of `active_profile_id` / `default_profile_id` / `account_type` so profile setup can be redone.
- Storage objects in the image buckets owned by the deleted accounts are removed too, so no orphaned uploads remain.
