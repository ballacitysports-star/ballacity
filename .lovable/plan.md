## Goal

Stop making people hunt for a Save button. Any profile you're **editing** saves itself a moment after you stop typing. Any profile you're **creating** keeps a local draft as you go, and only becomes real when you submit.

## Behavior

**Edit screens** (profile, team, trainer, gym) — real auto-save:
- ~800ms after you stop typing, changes are written to the backend.
- Nothing is sent while a field is invalid (bad birthday, malformed link URL, missing required name) — the status line shows the reason instead of failing silently.
- Repeat saves of unchanged data are skipped, and only one write is ever in flight at a time.
- A failed save shows "Couldn't save — retry" with a retry action; nothing is lost, the next edit retries.
- Leaving the page flushes any pending save first.

**Create screens** (new team, new trainer, new gym, onboarding sign-up steps) — draft auto-save:
- Your in-progress input is stored locally and restored if you close the tab or navigate away.
- No row is written to the database until you press the create/finish button, so half-built profiles never show up to anyone else.
- Status line reads "Draft saved" instead of "Saved".

**Status indicator** (subtle text, no toasts):
- Idle: nothing shown
- Typing: "Saving…"
- Done: "Saved just now" → "Saved 2m ago"
- Blocked: "Not saved — fix birthday" (or whichever field)
- Failed: "Couldn't save · Retry"

Placed in the screen header next to the title. On edit screens the explicit Save button is removed and replaced by a Done/Back action that flushes pending changes; on create screens the create button stays as-is.

## Screens covered

| Screen | Mode |
| --- | --- |
| `/profile/edit` | auto-save |
| `/onboarding/welcome` (existing profile row) | auto-save per step |
| `/teams/:id/edit`, `/trainers/:id/edit` | auto-save |
| `/orgs/:id/edit` | auto-save |
| `/teams/create`, `/trainers/create`, `/orgs/create` | draft only |

## Technical notes

- New `src/hooks/use-autosave.ts`: generic hook taking `{ value, save, validate, delay, enabled }`. Internals: value fingerprint (JSON hash, same approach as `profileRowFingerprint`), debounce timer, in-flight promise ref for dedupe, sequence counter so a stale response can't overwrite a newer one, `flush()` for unmount/navigation, and a `status` union (`idle | dirty | saving | saved | invalid | error`).
- New `src/components/SaveStatus.tsx`: renders the status union as muted text, with relative "Saved Xm ago" ticking and a retry button on error.
- `profile.edit.tsx`: wire `useAutosave` around the existing `save()` body, split into `validate()` (name/links/birthday/grad-year checks that currently toast) and `persist()` (overrides + `buildProfileRow` upsert + feed prefs). Remove the header Save button and the post-save `nav({ to: "/profile" })`; keep the local-override write immediate so other screens reflect edits instantly.
- `teams.$teamId.edit.tsx` / `orgs.$orgId.edit.tsx`: same treatment around their existing `save()` / `onSubmit()`, calling `updateTeam` / the org update fn. Org join-request side effects stay on the explicit action, not on autosave.
- Create screens (`CreateOrgWizard`, `CreateTrainerWizard`, `orgs.create.tsx`, and any team-create wizard): already have `useDraftPersistence`; extend that hook to expose a `status` so `SaveStatus` can render "Draft saved", and add it where missing.
- `onboarding.welcome.tsx`: reuse its existing `runSave` + fingerprint/in-flight guards as the autosave `save` fn — the idempotency work already there stays intact.
- No schema or RLS changes.
