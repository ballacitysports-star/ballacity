## Goal
Only allow trainer venue addresses that were selected from Google Places autocomplete. Block save/publish on any free-typed or edited-after-pick entries.

## Approach
Track a client-side set of "verified" address strings per row — an address is verified only when the user taps a Places suggestion. Any manual keystroke after that clears the verified flag for that row. Save/publish is disabled until every non-empty venue row is verified. Server-side validation also rejects unverified entries as a defense-in-depth check.

## Changes

### 1. `src/components/LocationAutocomplete.tsx`
- Add optional prop `requirePick?: boolean` and `onPick?: (v: string, placeId: string) => void` (extend existing `onPick`).
- Pass the Places `placeId` into `pick()` and forward via `onPick`.
- When `requirePick` is on and the user types (not picks), surface a helper message: "Choose an address from the list to save it."

### 2. `src/components/CreateOrgWizard.tsx` (Session venues step)
- Add state `verifiedVenues: Set<string>` (values are trimmed address strings).
- On Places pick: add the address to the set.
- On text edit: remove the old trimmed value from the set.
- Show per-row status: green "✓ Verified" chip when the trimmed value is in the set; amber "Pick from suggestions" hint when non-empty but unverified.
- Extend `venueValidation` gating so `nextDisabled`/`submit` are blocked if any non-empty venue is unverified.

### 3. `src/routes/teams.$teamId.edit.tsx` (Session venues section)
- Mirror the same `verifiedVenues` state and per-row UI.
- Seed the set on load with the org's saved `venueAddresses` (already persisted values are treated as verified — no forced re-pick for existing trainers).
- Block Save when any non-empty row is unverified.

### 4. `src/lib/venue-address.ts`
- Extend `validateVenueAddresses` to accept an optional `verified: Set<string>` and return an "unverified" error message for any non-empty address not in the set. Existing callers stay backward-compatible.

### 5. `src/lib/teams.functions.ts`
- Add a `verifiedVenues?: string[]` field to the venue-carrying inputs (trainer create/update).
- In the Zod `.superRefine`, reject any `venue_addresses` entry not present in `verifiedVenues` with "Venue must be selected from suggestions." Existing trainers editing without touching venues send their saved list back as verified.

## Out of scope
- Persisting `place_id` / lat/lng to the DB (can be a follow-up if you want map pins later).
- Retro-validating existing saved venues.

## Technical notes
- The trimmed address string (`address.trim()`) is the identity key for verification — matches how `venue-address.ts` currently dedupes.
- Placeholder "Any venue" option in the slot dropdown is unaffected — that references venues by their existing string.
