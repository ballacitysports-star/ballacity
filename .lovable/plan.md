## Goal

`CreateOrgWizard` is one 1,431-line component reused for both teams and trainers. The trainer path crams ~30 fields into 3 steps ("Identity", "Details", "Branding"), with only name/handle/sports/city gating step 1. Result: overwhelming forms, easy drop-off, blockers (venue verification, availability validation) surface only at submit, and the "Branding" step secretly hides critical things like organization affiliation and availability.

Optimize the trainer flow specifically — keep team flow intact — by restructuring into shorter, purpose-labeled steps, moving heavy configuration to "post-create" edit, and adding smart defaults.

## New trainer wizard structure

Reduce required steps from 3 (mixed) to 4 short, single-purpose ones. Each step gates only on what's essential to publish a usable profile; everything else is optional and can be edited later from the trainer profile edit page.

```text
Step 1  Basics       name, handle (auto-suggested from name), primary sport
                     (single-select; more added later), city
Step 2  Expertise    bio (min 40 chars), credentials, rate/hr, session types,
                     skill range
Step 3  Where        one primary venue (Google Places, required); "Add more
                     venues later" link. Timezone auto-detected.
Step 4  Availability quick-pick weekly template ("Weekday evenings",
                     "Weekends", "Custom") that pre-fills slots; rules and
                     date overrides deferred to profile edit.

Publish → land on trainer profile with a persistent "Complete your profile"
checklist (cover photo, extra venues, org affiliation, availability rules,
achievements, staff N/A).
```

Move out of the create flow (to profile edit only): additional venues beyond the first, availability rules, date overrides, organization affiliation, achievements, accent color, custom cover upload, positions-needed, distances (running), rating min/max, team-only blocks (league/record/home court/staff), founded year.

## UX improvements

- Auto-suggest `@handle` from the entered name; user can override. Live-validate uniqueness against existing orgs.
- Auto-detect timezone from browser (already partially done) and hide the field unless the user expands "Advanced".
- Detect the user's city via `useUserLocation` and prefill.
- Show a live one-card preview beside the form on desktop (already exists — keep, but shrink on mobile to a collapsible "Preview" sheet so the form isn't squeezed).
- Progress bar with step labels, not just dots; "Step 2 of 4 · Expertise".
- Surface validation inline as the user types (venue verification, bio length, slot overlaps) instead of only at submit.
- Save draft to `localStorage` under a per-user key so a refresh mid-wizard restores state; clear on successful publish.
- "Skip for now" button on steps 2–4 so a trainer can publish a minimal profile in under a minute and finish setup from the profile.

## Code changes

- Split `CreateOrgWizard.tsx` into a shared shell + two thin flows:
  - `src/components/create/CreateTrainerWizard.tsx` (new, 4 steps above)
  - `src/components/create/CreateTeamWizard.tsx` (extracted from current wizard, unchanged behavior)
  - `src/components/create/shared/` for the small reusable pieces (StepHeader, SportPicker, VenuePicker, WeeklyQuickPick, LivePreview, useHandleSuggestion, useDraftPersistence).
- Update `src/routes/trainers.create.tsx` to render `CreateTrainerWizard` and `src/routes/teams.create.tsx` to render `CreateTeamWizard`. Keep the `/teams/create?kind=coach` redirect that already canonicalizes to `/trainers/create`.
- Add `WeeklyQuickPick` presets that expand to `Slot[]` matching the existing `availability_slots` shape so nothing changes server-side.
- Add a `TrainerProfileChecklist` card rendered at the top of `src/routes/trainers.$trainerId.tsx` when the viewer owns the profile and completeness < 100%. Each checklist item deep-links into the corresponding section of `teams.$teamId.edit.tsx`.
- Draft persistence: `useDraftPersistence("trainer-wizard-draft", state)` — write on change (debounced 400ms), read on mount, clear on submit success.

## Out of scope

- No changes to team creation UX beyond extracting it into its own file.
- No schema changes; all new UI writes into existing columns (`availability_slots`, `venue_addresses`, `verified_venues`, `venue_geo`, `primary_venue`, etc.).
- No changes to org affiliation logic itself — it just moves to the profile edit page.
