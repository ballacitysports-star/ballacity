## Problem
The user is on `/trainers/create` and doesn't see any of the new organization features. The trainer creation wizard (`CreateOrgWizard`) was never updated to include the "Organization (optional)" step that the plan called for. The org UI only appears after a trainer profile exists (badge on profile, section for owner in edit, `/orgs/$orgId` page, feed filter), so during creation there is no entry point.

## Fix

### 1. Add an "Organization" step to `CreateOrgWizard` (trainers only)
Insert a new step near the end of the trainer branch (before final review/submit), skipped entirely when `kind !== "coach"`. Three mutually-exclusive choices:
- **Independent** (default) — no org linkage.
- **Join existing** — search `listTrainerOrgs`, pick one; stores `pendingOrgJoinId`.
- **Create new** — inline mini-form (name, handle, city, bio); stores `pendingOrgCreate` payload.

Handle field reuses the same slug sanitizer already used for the trainer handle.

### 2. Wire the choice into submit
After the trainer profile is successfully saved and we have the new `teams.id`:
- If **Create new**: call `createTrainerOrg({ name, handle, trainerId: newId, city, bio })`. Creator becomes owner and the new trainer profile is auto-added as owner-member (already implemented server-side).
- If **Join existing**: call `requestToJoinTrainerOrg({ orgId, trainerId: newId })` and toast "Join request sent — awaiting approval."
- If **Independent**: no-op.

Failures in the org step must not roll back the trainer profile — surface a toast and let the user retry from the profile's `TrainerOrgSection` (already available in edit view).

### 3. Redirect
Keep the existing post-create redirect to `/trainers/$trainerId`. The org badge / section will then appear on that page via the existing integration.

## Out of scope
- No changes to `orgs.$orgId.tsx`, feed filter, or `TrainerOrgSection` — those already work.
- No schema changes.
- No copy changes elsewhere.

## Technical notes
- Only file changed: `src/components/CreateOrgWizard.tsx`.
- New step is gated on `isCoach`; total step count updates accordingly.
- Reuse existing `listTrainerOrgs`, `createTrainerOrg`, `requestToJoinTrainerOrg` from `src/lib/trainer-orgs.functions.ts`.
