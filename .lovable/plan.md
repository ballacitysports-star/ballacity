## Problem

Confirmed in code: on `/trainers/{id}`, the owner-only Edit affordance renders a `<Link to="/teams/$teamId/edit" params={{ teamId: org.id }} data-render="client-only">` (`src/routes/trainers.$trainerId.tsx:238-247`). Root cause of "button does not work" is unconfirmed — the target route exists and handles `kind === "coach"`. Two plausible causes to verify:

1. The `data-render="client-only"` attribute is suppressing hydration/click on that node.
2. `getOrgById(params.teamId)` in the `/teams/$teamId/edit` loader returns undefined on cold navigation (org store not yet hydrated when clicking from a trainer page), throwing `notFound()` and appearing as "nothing happens."

## Fix

Give trainers their own edit route so the UX no longer piggybacks on the teams route, and make the loader hydration-safe.

1. **New route** `src/routes/trainers.$trainerId.edit.tsx`
   - Loader awaits org-store hydration, then `getOrgById(params.trainerId)`; throws `notFound()` if still missing.
   - Renders the same edit form used today for coaches (extract the coach branch of `EditOrg` into a shared `<TrainerEditor org={} />` component in `src/components/edit/TrainerEditor.tsx`, or import and reuse `EditOrg` gated to `kind === "coach"`).
   - `errorComponent` + `notFoundComponent` with a "Back to profile" link.
   - After save, navigate to `/trainers/$trainerId`.

2. **Update the Edit link** in `src/routes/trainers.$trainerId.tsx:238-247`
   - Point to `/trainers/$trainerId/edit` with `params={{ trainerId: org.id }}`.
   - Remove `data-render="client-only"` — the surrounding page is client-rendered already.

3. **Harden ownership + hydration**
   - In the new loader, if the org store hasn't ingested realtime rows yet, `await` a one-shot fetch (existing `ensureOrgsLoaded()` pattern, or call the same server fn the trainers list uses) before `getOrgById`.
   - Keep the existing `isMyOrg` guard in the editor; if false, redirect to the trainer profile with a toast "You can't edit this profile."

4. **Keep `/teams/$teamId/edit`** as-is for team owners; no behavior change there.

## Out of scope

- No schema changes.
- No changes to `CreateTrainerWizard` — edit reuses the current coach fields (identity, expertise, venues, availability, media).

## Verification

- Sign in as trainer owner → open own trainer profile → click Edit → lands on `/trainers/{id}/edit` with fields pre-filled.
- Edit name, rate, primary venue, and one availability slot → Save → redirected to trainer profile with updated values visible.
- Sign in as another user → Edit button hidden; visiting `/trainers/{id}/edit` directly redirects away.
- Hard refresh on `/trainers/{id}/edit` still loads (loader awaits hydration).
