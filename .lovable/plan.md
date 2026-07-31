## Goal

Onboarding shows and saves exactly what Edit profile does — no blank/placeholder defaults over real saved data, no missing fields, and edits made in either screen show up in the other.

## 1. Accurate prefill

Today `src/routes/onboarding.welcome.tsx` prefills on the first non-null `useMyProfile(user)` and then latches `prefilled = true`. That value can be a fallback derived from the auth user (email local-part as name, empty sports) while the saved profile row is still loading, so real data gets overwritten in the form.

- Expose a load state from `useMyProfile` (or add a sibling flag in `src/lib/user-prefs-store.ts`) so consumers can tell "still fetching the saved row" from "fetched, empty".
- Gate onboarding's prefill effect on that flag: render the step skeleton until the profile row resolves, then seed `basics`, `sports`, links, and radius once.
- Keep the existing autosave disabled until prefill completes, so the debounce can't write placeholder values back over the saved row.

## 2. Same fields as Edit profile

Compared with `src/routes/profile.edit.tsx`, onboarding's Basics and Sports already use the shared components; the gap is Profile links.

- Extract the links editor from `profile.edit.tsx` into a shared `src/components/profile/ProfileLinksFields.tsx` (same pattern as `ProfileBasicsFields` / `ProfileSportsFields`) and use it in both screens.
- Add links to the onboarding Basics/Sports flow (as part of the "Sports" step or a short "Links" step) and pass `links` into `buildProfileRow` on save, so onboarding writes the identical row shape.
- Account-specific sections of Edit profile (Reviews, Payments, Reels, Pro, Plans, Notifications) stay out of onboarding — they are post-signup settings, not profile data.

## 3. Live two-way sync

- After onboarding saves, keep writing through `setProfileOverrides` and additionally invalidate the same query keys Edit profile invalidates, so a later visit to Edit profile reads fresh values instead of a cached row.
- After Edit profile saves, publish through the same override/listener channel so a returning onboarding visit (Settings → "Edit onboarding details") prefills the new values.
- Clear the onboarding idempotency fingerprint (`onboardingSaveKey`) when Edit profile writes a new row, so re-entering onboarding after an external edit isn't skipped as "already saved".

## Technical notes

- Files touched: `src/routes/onboarding.welcome.tsx`, `src/routes/profile.edit.tsx`, `src/lib/user-prefs-store.ts`, new `src/components/profile/ProfileLinksFields.tsx`.
- No schema changes; `buildProfileRow` in `src/lib/profile-payload.ts` already supports `links` and stays the single canonical payload builder.
- Verification: typecheck plus a manual pass — save a profile in Edit profile, reopen onboarding, confirm every field (including links) is prefilled and unchanged after autosave settles.
