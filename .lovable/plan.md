## Add venue location filter to trainer search & profile

### 1. Trainers feed (`src/routes/_tabs.trainers.tsx`)

Add a **Venue** filter that narrows the trainer list to those whose `venueAddresses` include the selected location.

- Extend `trainersSearchSchema` with `venue: fallback(z.string(), "").default("")` so the selection persists in the URL and survives refresh/sharing.
- Derive a deduped, sorted list of venue options from `orgs.filter(kind==="coach")` — flatten `venueAddresses`, trim, case-insensitive dedupe. Primary venues surface first.
- Render a new chip row inside the existing `filtersOpen` panel labeled "Venue", styled like the Specialty/Available rows. Chips toggle the active venue; include an "Any venue" chip for reset. Use a horizontally scrollable list to handle many venues.
- Add the venue predicate to the `list` `useMemo` filter chain (case-insensitive substring / equality match against `o.venueAddresses`).
- Include venue in the active-filter badge count next to the filter toggle.

### 2. Trainer profile (`src/routes/trainers.$trainerId.tsx`)

When a trainer has multiple `venueAddresses`, let visitors focus the profile on one venue:

- Add local state `selectedVenue: string | null` (default = `primaryVenue` when present, else null).
- Persist selection in the route search params (extend the existing `validateSearch` with `venue`) so a shared/refreshed URL keeps the choice.
- Above the venue list in the "Session venues" section, render chip filters (one per venue + "All venues"). Selecting a chip:
  - Highlights that venue row (and hides others if we want strict focus — plan: keep all visible but visually emphasize the selected).
  - Filters the "Availability" `TrainerAvailabilityMonth` view by passing a new `venueFilter` prop; the resolver hides slots whose `venue` doesn't match.
- Skip the filter UI when the trainer has ≤1 venue.

### 3. Availability month helper

- Update `TrainerAvailabilityMonth` (and the underlying `availability-resolve.ts` resolver) to accept an optional `venueFilter` string. When set, only slots/overrides tagged with that venue (or untagged/primary when it matches primary) are returned.
- Booking sheet (`BookSessionSheet.tsx`) — out of scope for this change; venue selection there already exists per-slot.

### Technical notes

- No DB schema changes: filter operates on existing `venueAddresses` / `primary_venue` / slot `venue` fields.
- All new state flows through `validateSearch` + `Route.useSearch()` for URL persistence, matching existing filter patterns.
- No changes to org-store, server functions, or Supabase policies.

### Files touched

- `src/routes/_tabs.trainers.tsx` — schema + chip row + filter predicate.
- `src/routes/trainers.$trainerId.tsx` — schema + venue chip UI + wire `venueFilter` into month view.
- `src/components/TrainerAvailabilityMonth.tsx` + `src/lib/availability-resolve.ts` — optional `venueFilter` support.
