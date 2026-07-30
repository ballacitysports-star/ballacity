## Goal

Remove the player profile skill rating (the 1–5 self-rated slider per sport). Sports stay — players still pick favorite sports and positions, just without a numeric skill score.

Out of scope (left untouched): game skill level ("Intermediate"/"All levels"), player availability `skill_level` and its filter chips on the Players screen, and team/trainer skill ranges.

## UI changes

- `src/components/profile/ProfileSportsFields.tsx` — drop the skill slider and the "X.X / 5" readout from each sport card; keep the sport chip, remove button, and Positions picker.
- `src/routes/_tabs.profile.tsx` (Sports & skill block) — remove the numeric score and the animated skill progress bar; render sports (and positions) as plain chips. Rename the heading to "Sports".
- `src/routes/players.$userId.tsx` — same treatment on the public player profile; stop synthesizing a placeholder `skill: 3` when deriving sports from availability/profile.
- `src/routes/profile.edit.tsx` and `src/routes/onboarding.welcome.tsx` — rename the "Sports & skill" section/step label to "Sports"; both keep using the shared fieldset, so no other change.

## Data model changes

- `src/lib/profile-payload.ts` — remove the `skill_levels` map from `buildProfileRow`; sports input becomes `{ name, positions? }`. Fingerprint updates automatically.
- `src/lib/user-prefs-store.ts` — drop `skill` from the stored sports entry type.
- `src/lib/sample-data.ts` — remove `skill` from the per-sport profile stat entries (keeps `tier`, `gamesPlayed`, `winRate`, `favorite`).
- Fix any remaining type errors that fall out of these type changes.

## Database migration

- `ALTER TABLE public.profiles DROP COLUMN skill_levels;`
- Regenerated types then drop `skill_levels` from `profiles`.

Order: run the migration first, then update the code that writes/reads the column.

## Technical notes

- `profiles.sport` (primary sport) is unaffected.
- No RLS/grant changes needed — dropping a column doesn't alter policies.
- Existing skill values in `skill_levels` are permanently deleted, per your choice.
