## Goal
Let trainers mark one session venue as "primary" and tag each weekly availability slot with a venue, then display availability grouped by venue on the trainer profile.

## Data model changes (`public.teams`)
- Add `primary_venue text` (nullable). Stores the address string of the primary venue — resilient to reordering. If it no longer matches any entry in `venue_addresses`, we treat it as unset.
- Extend `availability_slots` jsonb entries with an optional `venue?: string` (the address string). Existing rows without `venue` stay valid — treated as "Any venue".

No schema change needed for `availability_slots` (already jsonb). Only one new column.

## Type + store (`src/lib/sample-data.ts`, `src/lib/org-store.ts`, `src/lib/teams.functions.ts`)
- `Org.primaryVenue?: string`.
- `Org.availabilitySlots` slot type gains optional `venue?: string`.
- Row ↔ Org mapping in `org-store.ts` reads/writes `primary_venue` and passes slot `venue` through.
- Zod `TeamInput` in `teams.functions.ts`: add `primary_venue: z.string().max(300).nullable().optional()` and add `venue: z.string().max(300).optional()` to each availability slot.

## Wizard (`src/components/CreateOrgWizard.tsx`, trainers only)
- Session venues section: add a small "Primary" radio pill on each row (mutually exclusive). Selecting the row sets `primaryVenue = venueAddresses[i]`. Removing/editing the primary row clears/updates it accordingly.
- Weekly availability rows: add a compact "Venue" dropdown per slot listing current venues + "Any venue" (undefined). Disabled if no venues exist yet, with a hint "Add a venue above".
- Include `primaryVenue` and slot `venue` in `handlePreview` output.

## Edit page (`src/routes/teams.$teamId.edit.tsx`)
- Mirror the wizard: primary toggle on venue rows, venue dropdown on availability rows, persist `primaryVenue` + slot `venue` on save.

## Profile display (`src/routes/trainers.$trainerId.tsx`)
- Session venues list: mark the primary venue with a small "Primary" chip and pin it to the top.
- Weekly availability section: group slots by venue, in this order — Primary venue first, then remaining venues in `venueAddresses` order, then "Any venue" for slots without a venue. Each group shows the address as a subheader and its slots underneath, using the existing slot row rendering.
- If no venues are set, keep the current flat weekly list.

## Validation
- Wizard/edit `submit`/`save`: if `primaryVenue` is set but not present in the current (validated) venue list, silently clear it before submit — no error surfaced to user.
- Slot `venue` values that reference a removed venue are dropped on save.

## Technical notes
- One migration: `ALTER TABLE public.teams ADD COLUMN primary_venue text;`
- No RLS/policy changes; existing team policies cover the column.
- Backward compatible: existing trainers with no primary and no per-slot venues render exactly as today.
