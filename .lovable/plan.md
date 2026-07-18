## Problem

On `/teams/create?kind=coach`, the wizard correctly starts on step 1 (Identity) and skips the step 0 "Type" picker. But the Back button on step 1 still calls `setStep(0)`, sending the user to the type-picker page that the preselected flow was designed to bypass — dead UI in this entry path.

## Fix

In `src/routes/teams.create.tsx`:

- When `kind` was preselected via the URL (`initialKind` is set), treat step 1 as the true first step:
  - Hide the "Back to type picker" behavior — instead the Back button on step 1 navigates to `/trainers` (for coach) or `/teams` (for team) via `useNavigate`.
  - On steps 2+, Back keeps existing behavior (`setStep(s-1)`), stopping at step 1 rather than step 0.
- When `kind` was NOT preselected, keep current behavior (Back returns to step 0 as before).

No other changes; the type-picker (step 0) code stays in place for the unparameterized entry point.
