## Changes to `src/components/CreateOrgWizard.tsx`

**1. Move "Weekly availability" (trainers only) into Step 1 Identity**
- Cut the `<Section title="Weekly availability">` block (lines ~745–823) out of the `{isCoach && (...)}` group in Step 1 Details.
- Re-insert it in Step 0 Identity, right after the Sports selector so it's visible from the start of trainer creation.
- Keep validation wiring (`slotsError`, disabled Add/Publish) unchanged.

**2. Add "Session venues" (trainers only, multiple addresses) in Step 0 Identity**
- Add a new coach-only `venueAddresses: string[]` state, rendered directly under the new Availability section.
- UI: list of rows, each an address input backed by `LocationAutocomplete` (mode not `city`, i.e. full place) with an X to remove, plus a dashed "Add venue" button.
- Persist to a new `Org.venueAddresses?: string[]` field (added to `src/lib/sample-data.ts` `Org` type) so it flows through `handlePreview` → `addOrg`.
- Display on `src/routes/trainers.$trainerId.tsx` as a "Session venues" list under the profile info block (only if present).
- Storage: piggyback on the existing `teams` table by extending the JSON payload persisted via `org-store` (no schema change required if we serialize into an existing jsonb field). Confirmation needed only for the storage column — see Technical notes.

**3. Multi-select for "Preferred format" and "Meeting cadence"**
- Change `format: string` → `formats: string[]`, `cadence: string` → `cadences: string[]`.
- Update the two `<ChipPicker ... single />` in Step 0 to remove `single` and use array toggle handlers like the existing Venues chip picker.
- Update `handlePreview` mapping and `Org` type (`format?: string` → `formats?: string[]`, same for cadence). Add a shim so old single-value data still reads (fallback: `formats ?? (format ? [format] : [])`).
- Update read sites that display these fields (trainer + team profile cards, feed filters) to join arrays with `, ` and, for filter matching, use `.some()` instead of equality.
- Mirror the same change in `src/routes/teams.$teamId.edit.tsx` so edits stay consistent.

## Technical notes

- `Org.venueAddresses`, `Org.formats`, `Org.cadences` need to be added to the `Org` type in `src/lib/sample-data.ts` and mapped in `src/lib/org-store.ts` (row → Org and Org → row insert/update). If the current teams row doesn't have a matching column for these, extend the same `availability_slots`-style pattern: add a jsonb column via migration (`venue_addresses jsonb`, and either widen `format`/`cadence` to `text[]` or add `formats`/`cadences` jsonb) so the wizard's output survives a refresh.
- Consumers of the old scalar `format` / `cadence` fields: profile card, feed filters, trainer profile, edit page — each needs the tiny read-side update above. No business logic changes beyond that.
- Skill range, session types, credentials, rate, etc. stay in Step 1 Details.
