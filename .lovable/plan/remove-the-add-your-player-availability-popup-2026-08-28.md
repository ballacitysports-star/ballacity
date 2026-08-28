# Remove the "Add your player availability" popup

Tapping "Request to join" / "Pay & join" goes straight through — no availability prompt in between.

## What changes

- `src/routes/games.$gameId.index.tsx`: drop the prompt gate in the join handler (the `availabilityPromptDismissed()` branch around line 972) so the join action runs immediately, and remove the `<AvailabilityPromptDialog>` render plus its state and imports.
- `src/components/availability/AvailabilityPromptDialog.tsx`: delete the dialog, its session-dismissal helpers, and the file if nothing else uses it.

## Kept as-is

- The dismissible banner on the create-game screen (`AvailabilityPromptBanner`) and the Players tab notices stay, unless you want those gone too — say the word and I'll strip them in the same pass.

## Technical notes

Presentation-only: no database, RLS, or join-request logic changes. Verify with a typecheck that no references to the removed exports remain.
