## Goal
Restore the pre-wizard-refactor availability editor (full monthly calendar with Weekly base + Recurring rules + Date overrides) inside the trainer creation flow, replacing the streamlined Weekly quick-pick + Confirm-preview steps.

## Changes

### `src/components/create/CreateTrainerWizard.tsx`
- Reduce `STEP_LABELS` from 5 → 4: `["Basics", "Expertise", "Where", "Availability"]`.
- Remove Step 4 ("Confirm your schedule") block entirely.
- Add `rules` to `Draft` (typed as `AvailabilityRule[]`), default `[]`, persisted via draft storage.
- Include `availabilityRules: draft.rules` on `previewOrg` and the published `org`.
- Replace Step 3 body: swap `WeeklyQuickPick` for the full `AvailabilityCalendar` (weekly + overrides) plus `AvailabilityRulesEditor` for recurring rules — same components used on the edit page.
- Keep the Live preview card underneath.
- Drop `WeeklyQuickPick` and `AvailabilityConfirm` imports.
- Update `canSkip` (step 3 still skippable) and header copy for step 3.

### `src/lib/org-store.ts` mapping
- Confirm `availabilityRules` is already forwarded (it is, per prior work). No change expected; verify only.

### Files to leave alone
- `AvailabilityCalendar.tsx`, `AvailabilityRulesEditor.tsx`, `availability-resolve.ts`, `tz.ts` — reuse as-is.
- `AvailabilityConfirm.tsx` and `WeeklyQuickPick.tsx` stay on disk but become unused (safe to keep; no other importers). Can delete if you prefer a clean tree.

## Result
Creation flow becomes 4 steps ending on **Availability**, matching the trainer edit page: pick weekly slots, add recurring rules, set date-specific overrides on a monthly calendar with tz handling. No separate Confirm step.

## Question
Delete the now-unused `AvailabilityConfirm.tsx` and `WeeklyQuickPick.tsx`, or keep them around?