## Goal

On Step 2 of the trainer creation wizard, let trainers add **multiple verified venues** (Google Places), mark one as **primary** (default), and on Step 3 associate each weekly hour, recurring rule, and date override with a specific venue. Availability components already support this — the wizard currently only feeds them a single venue.

## Changes

### 1. Wizard draft model — `src/components/create/CreateTrainerWizard.tsx`
Replace the single `venue / venuePlaceId / venueGeo` fields with a list:

```ts
type VenueEntry = {
  address: string;
  placeId: string;
  geo: { lat: number; lng: number } | null;
};
// Draft:
venues: VenueEntry[];
primaryVenueIdx: number; // defaults to 0
```

Migrate `loadDraft` so older drafts (with the old single-venue shape) hydrate into a one-item list without losing progress.

### 2. Step 2 UI — "Venues" section
- List of added venues as cards. Each card shows address, a "★ Primary" chip when it's primary, a "Make primary" button when not, a small `VenueMapPreview`, and a remove (X) button.
- Below the list: `LocationAutocomplete` + "Add venue" button. Only accepts Google-picked addresses (existing `verified_venues` rule — same UX as today). Duplicates blocked by `placeId`.
- `venueOk` guard: at least one entry with a `placeId`.
- Removing the primary auto-promotes the next entry to primary.

### 3. Step 3 wiring
Pass all verified venue addresses and the primary to both editors — they already render a per-window venue dropdown with the ★ marker:

```tsx
const verifiedVenueAddresses = draft.venues.filter(v => v.placeId).map(v => v.address);
const primaryAddress = draft.venues[draft.primaryVenueIdx]?.address ?? null;

<AvailabilityCalendar
  venues={verifiedVenueAddresses}
  primaryVenue={primaryAddress}
  ...
/>
<AvailabilityRulesEditor venues={verifiedVenueAddresses} ... />
```

Result: for every weekly slot, recurring rule, and date-override window the trainer can pick which venue it applies to; leaving it blank means "any venue" (existing behavior).

### 4. Publish payload (`previewOrg` + `submit`)
Update the `Org` we send to `addOrg` so multi-venue persists to `public.teams` using existing columns:

- `venueAddresses`: all verified addresses
- `verifiedVenues`: same, lowercased
- `venueGeo`: object keyed by lowercased address → `{ address, placeId, lat, lng }` for each entry that has `geo` (matches current shape already read by `TeamsMapView`)
- `primaryVenue`: the primary entry's address

Availability payload (`availabilitySlots`, `availabilityRules`, `availabilityOverrides`) is unchanged in shape — windows carry their optional `venue` string that the editors now set.

### 5. No DB migration
`teams.venue_addresses`, `verified_venues`, `venue_geo`, `primary_venue`, `availability_*` columns already exist and already back the trainer edit page's multi-venue flow. This change just brings the creation wizard to parity.

## Out of scope

- No changes to `AvailabilityCalendar`, `AvailabilityRulesEditor`, `next-available`, booking sheet, or profile/map rendering — they already handle multiple venues.
- No changes to the trainer edit page.
- No draft-schema versioning beyond the one-shot migration in `loadDraft`.

## Files touched

- `src/components/create/CreateTrainerWizard.tsx` (draft type, Step 2 UI, Step 3 props, `previewOrg`, draft hydration)
