# Fix image uploads app-wide ("new row violates row-level security policy")

## What's wrong

Every image uploader in the app saves files into a folder named after the **signed-in user's id**, but the storage rules for gym, team, and trainer image buckets only allow folders named after the **gym's / team's id**. So those uploads are rejected.

Confirmed by reading the code and the live storage rules:

| Upload surface | Folder used in code | Rule requires | Result |
| --- | --- | --- | --- |
| Gym logo / cover / gallery (create + edit) | user id | gym id | blocked |
| Team logo / cover (create + edit) | user id | team id | blocked (team-covers inserts pass, edits/removals don't) |
| Trainer avatar / cover (create + edit) | user id | team id | blocked |
| Player avatar / cover | user id | user id | works |
| Game cover | user id | user id | works |

Gym and team creation happen *before* the entity exists, so the folder can never be the entity id there — the folder-per-user convention the code already uses is the right one.

## The fix

Align the storage rules with the convention the app already follows, in one migration:

- Allow signed-in users to upload, replace, and remove image files inside a folder named after their own user id, for the gym and team image buckets (`org-avatars`, `org-covers`, `trainer-avatars`, `team-avatars`, `team-covers`). Each user can only touch their own folder.
- Keep the existing gym-admin and team-owner rules untouched, so files already stored under a gym or team id keep working.
- Tidy the partial `team-covers` rules so insert/replace/remove behave the same.
- Public viewing of these images is unchanged; nothing becomes readable that wasn't already.

No application code changes are needed — every uploader already passes the user id.

## Technical notes

- Migration adds INSERT / UPDATE / DELETE policies on `storage.objects` for role `authenticated`, scoped to `bucket_id = ANY (...)` AND `(storage.foldername(name))[1] = auth.uid()::text`.
- Existing policies `Org admins write org images` and `Team owners write team images` are preserved; policies are permissive, so either path grants access.
- Existing `team_covers_owner_insert/update/delete` policies are replaced by the unified set to avoid duplicate overlapping rules.

## Verification

- Gym edit page: upload logo, cover, and a gallery photo — no RLS error, images persist and render.
- Gym create page (before the gym exists): same three uploads succeed.
- Team edit/create and trainer edit/create: avatar and cover upload succeed.
- Player profile avatar/cover and game cover still upload (no regression).
