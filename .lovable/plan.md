## Next available windows on trainer profiles & booking

Add a compact "Next available" section that surfaces the soonest bookable windows for a trainer, shown on both the public trainer profile and the booking sheet.

### Behavior
- Scans forward from now up to 30 days, honoring the trainer's weekly + rules + overrides layers (already merged by `resolveDay`), the selected venue filter, and existing booked slots from `list_trainer_booked_slots`.
- Returns the next 3 bookable windows (grouped: today / tomorrow / date label).
- Skips days fully booked or with no windows; clips past-time from today.
- Timezone-aware: displays in viewer tz with a small "(trainer 6pm PT)" secondary label when tz differs.
- Each entry is tappable:
  - On the profile: opens BookSessionSheet pre-filled with that date + start time + venue.
  - Inside BookSessionSheet: sets date/start/venue directly.

### Files
- New `src/lib/next-available.ts`: `computeNextAvailable(org, { now, viewerTz, venueFilter, bookedSlotsByDate, limit })` returning `Array<{ dateKey, start, end, venue?, source, trainerStart?, trainerEnd? }>`.
- New `src/components/NextAvailableList.tsx`: presentational list with skeleton + empty state + "See full calendar" link.
- `src/routes/trainers.$trainerId.tsx`: render `NextAvailableList` above the Availability calendar section; wire click → open BookSessionSheet with prefilled state (lift `bookOpen` + add `prefill` state).
- `src/components/BookSessionSheet.tsx`: accept optional `prefill` prop (date/start/venue); show `NextAvailableList` near the top when no date is picked yet.
- `src/lib/trainer-requests.ts`: expose a helper to fetch booked slots for a date range (batched) if not already available; used to filter out conflicts.

### Notes
- Purely presentational + read-side; no schema changes, no new server functions beyond reusing `list_trainer_booked_slots` across a date range.
- Booked-slot lookup is throttled: fetch on demand for the ~30-day window once, cache in a `useQuery` keyed by trainerId + venueFilter + viewerTz.
