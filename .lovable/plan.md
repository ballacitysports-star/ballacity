## Goal
Prevent trainers from saving empty or malformed venue addresses in both the create-trainer wizard (`CreateOrgWizard.tsx`) and the edit page (`teams.$teamId.edit.tsx`). Today empty rows are silently stripped and any free-typed string is accepted.

## Validation rules (shared)
Add `src/lib/venue-address.ts` exporting:
- `validateVenueAddress(raw: string): { ok: boolean; error?: string; value: string }` — trims, then flags:
  - empty → "Address is required"
  - length < 5 → "Address is too short"
  - length > 200 → "Address is too long"
  - no letter or no digit/comma (heuristic for a real place) → "Enter a full address (street, city)"
  - control chars / URLs (`http`, `<`, `>`) → "Enter a plain address"
- `validateVenueList(list: string[]): { errors: (string|null)[]; hasError: boolean; deduped: string[] }` — also flags case-insensitive duplicates.

## Server-side hardening
- `src/lib/teams.functions.ts` `TeamInput.venue_addresses`: tighten from `z.array(z.string().max(300))` to `z.array(z.string().trim().min(5).max(200))` with a `.superRefine` that reuses the same regex checks and rejects duplicates. Same tightening applied via `TeamPatch` (already `.partial()`).

## Optional geocode verification
Add a lightweight "Verify" affordance: on blur of a venue row, call the existing `geocodeAddress` server fn (`src/lib/geocode.functions.ts`). If it resolves, mark the row verified (green check, replace value with `formatted`). If it fails, show inline error "We couldn't find this address". Verification is best-effort — a network failure does not block save as long as the local heuristic passes, so users in offline/dev still work.

## Wizard changes — `src/components/CreateOrgWizard.tsx`
- Track per-row error state `venueErrors: (string|null)[]` and `venueVerified: boolean[]`.
- On every `onChange`/add/remove, re-run `validateVenueList` and update errors.
- Render error text under each `LocationAutocomplete` row (reuse existing muted-text pattern) and a red border when invalid.
- On blur, call `geocodeAddress`; on success snap to formatted address and mark verified; on failure set row error.
- Extend the existing `slotsError`/disabled logic: compute `venuesError = isCoach && venueErrors.some(Boolean)`. Publish button is disabled and shows the first error when `venuesError` is true.
- In `handlePreview`, stop silently filtering empty rows — instead early-return with a toast if any row is invalid.

## Edit page changes — `src/routes/teams.$teamId.edit.tsx`
- Mirror the wizard: `venueErrors` state, inline error rendering under each row, disable Save while any row is invalid, blur-time geocode verification with the same behavior.
- Replace the current `.map(a => a.trim()).filter(a => a.length > 0)` in the save payload with the validated list; if invalid, show a toast and abort save.

## Trainer profile display — `src/routes/trainers.$trainerId.tsx`
No behavior change; already only renders non-empty entries. Confirmed venueAddresses render stays the same.

## Technical notes
- No DB migration needed; column stays `jsonb`.
- Reuse existing `LocationAutocomplete` — no changes to the component itself; the new error UI lives in the parent forms.
- Geocode call is auth-protected (already the case) and only fires on blur to keep the Places autocomplete UX unchanged while typing.
- `venue-address.ts` has no React deps so it's importable from both the wizard and the edit page; the same rules run client-side and are mirrored in the server Zod schema so a hand-crafted API call can't bypass them.
