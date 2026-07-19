# Monthly availability calendar (up to 6 months out)

Replace the trainer "Weekly availability" UI with a monthly calendar. Keep a weekly recurring base as the underlying pattern, layered with per-date overrides. Each time window still picks a venue. Existing weekly slots are discarded on migration — trainers start fresh.

## Model

Two-layer availability:

- **Weekly base** (existing `availability_slots` jsonb): `{ weekday, start, end, venue? }[]` — recurring pattern that projects forward every week.
- **Date overrides** (new `availability_overrides` jsonb): keyed by ISO date `YYYY-MM-DD`:
  - `{ "2026-08-14": { blocked: true } }` — cancel all base slots that day.
  - `{ "2026-08-14": { windows: [{ start, end, venue? }] } }` — replace base with explicit windows (empty array also blocks).
  - Overrides are only allowed for dates within the next 6 months (rolling window from today).

Resolution per date = override.windows if present, else (blocked ? [] : projected base slots for that weekday).

## Data changes

Migration on `public.teams`:
- Add `availability_overrides jsonb NOT NULL DEFAULT '{}'::jsonb`.
- Clear existing weekly slots: `UPDATE public.teams SET availability_slots = '[]'::jsonb WHERE kind = 'trainer'` (fresh start, per user choice).
- No RLS changes (existing team policies apply).

## UI

New component `src/components/AvailabilityCalendar.tsx`:
- Month grid (Sun–Sat), prev/next month arrows, clamped to `[thisMonth, thisMonth+5]` (6-month horizon).
- Each day cell shows: dot count of resolved windows, "blocked" indicator, or "+" if empty.
- Tap a date → bottom sheet (mobile) / popover (desktop) with:
  - Base slots for that weekday (read-only preview, "Edit weekly pattern" link).
  - Override editor: `[+ Add window]` rows with start/end time pickers and venue dropdown (reuses verified `venue_addresses`, primary first).
  - "Block this day" toggle.
  - "Reset to weekly" clears the override for that date.
- Legend at top: weekly base • override • blocked.
- Secondary "Weekly base pattern" accordion below the calendar for editing the recurring baseline (same row UI as before, but collapsed).

Integration points:
- `src/components/CreateOrgWizard.tsx` (Step 0, trainer only): replace the current weekly list with `<AvailabilityCalendar />`; weekly base editor lives inside the collapsed accordion.
- `src/routes/teams.$teamId.edit.tsx`: same swap; seed with existing `availability_overrides`.
- `src/routes/trainers.$trainerId.tsx` (public profile): read-only calendar variant — highlight dates with any resolved availability, tap to see that day's windows grouped by venue.

## Validation

Extend `src/lib/availability-slots.ts`:
- `validateOverrides(overrides, venues)` — reject windows outside 6-month horizon, past dates, overlapping windows within the same date, invalid `start >= end`, or venues not in the verified list.
- Called client-side in wizard/edit and server-side via Zod `superRefine` in `src/lib/teams.functions.ts` (`TeamInput` gains `availability_overrides`).

## Booking flow

`src/components/BookSessionSheet.tsx` and `src/lib/trainer-requests.ts`:
- Replace weekday-based slot picking with a date picker (next 6 months) + resolved-window dropdown for the selected date.
- Persist `session_date` (already exists on `trainer_session_requests` as scheduled timestamp).

## Out of scope

- No recurrence beyond the weekly base (no biweekly/monthly rules).
- No iCal export.
- No timezone changes — continue using trainer's stored timezone.

## Technical section

- Zod schemas:
  - `OverrideWindow = { start: HHmm, end: HHmm, venue?: string }`
  - `DayOverride = { blocked?: boolean, windows?: OverrideWindow[] }`
  - `AvailabilityOverrides = Record<ISODate, DayOverride>`
- New utility `src/lib/availability-resolve.ts`:
  - `resolveDay(date, base, overrides): OverrideWindow[]`
  - `resolveRange(start, end, base, overrides): Map<ISODate, OverrideWindow[]>` (used by the public profile and booking sheet).
- `AvailabilityCalendar` is fully controlled: props `{ base, overrides, venues, primaryVenue, onChange }`. No internal server calls.
- Persistence flows through existing `updateOrg` / `createTeam` in `src/lib/org-store.ts` and `src/lib/teams.functions.ts` — add `availability_overrides` mapping alongside `availability_slots`.
- 6-month horizon computed as `addMonths(startOfToday(), 6)`; enforced in validator and calendar navigation.
