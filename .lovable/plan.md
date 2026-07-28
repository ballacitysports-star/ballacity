## Goal

Make onboarding signup collect the same core details as **Edit profile**, using the same field UI, for every account type (player, team, trainer, gym).

## What onboarding will ask for

**Step 1 — Basics** (all account types), mirroring the Edit profile "Basics" section:
- Cover photo and avatar photo (same uploader as Edit profile)
- Display name, username, avatar initials
- City (same city autocomplete)
- Bio (280-char counter)
- Birthday (with the same validation message) and graduating class

**Step 2 — Sports & skill** (all account types), mirroring the Edit profile "Sports & skill" section:
- Add one or more sports, 1–5 skill slider per sport, position chips per sport
- The first added sport becomes the primary sport saved to the profile

**Step 3 — Location & radius** (players keep today's behavior, now also shown to the others):
- "Use my location" permission request with the existing denial/retry messaging
- Search-radius slider

**Step 4 — Next steps** (team / trainer / gym only):
- The existing three-step checklist and "Create team/trainer/gym profile" call to action, unchanged in content

Players finish with "Continue to feed"; team/trainer/gym finish with their existing create-profile call to action plus "I'll do this later".

## Behavior

- Everything prefills from the existing profile so returning users edit rather than re-enter, matching what the Settings "Edit onboarding details" link already implies.
- Autosave stays: changes save with the same debounce and the same Saving / Saved / Couldn't save status line.
- The step progress bar at the top updates to reflect the new steps and shows completion per step.
- Field-level limits and the birthday check match Edit profile exactly, so nothing invalid can be saved from onboarding.

## Technical notes

- Extract the shared presentational pieces from `src/routes/profile.edit.tsx` — `Section`, `Field`, `Input`, plus the Basics block and the Sports & skill block — into a shared component module (e.g. `src/components/profile/ProfileBasicsFields.tsx` and `ProfileSportsFields.tsx`), driven by value/onChange props. Both `profile.edit.tsx` and `onboarding.welcome.tsx` render those same components, so the two screens cannot drift.
- `onboarding.welcome.tsx` becomes a single stepper shared by all account types: steps 1–3 common, step 4 rendered only for non-player types from the existing `NEXT_STEPS` map.
- Saving continues through the existing paths: `profiles` row update via the browser Supabase client (`display_name`, `username`, `avatar_initials`, `avatar_url`, `cover_url`, `city`, `bio`, `birthday`, `graduating_class`, `sport`, `skill_levels`) plus `setProfileOverrides` / `setFeedPrefs` in `src/lib/user-prefs-store.ts` for sports, positions, and radius — same writes Edit profile already performs. No schema change and no new server functions.
- Keep the existing post-save feed invalidation and `openrun:prefs-updated` broadcast.
- No change to `AccountTypeGate`, the account-type picker, or the account-type lock.
