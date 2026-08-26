# Simpler "When" section

The When step currently stacks three things at once: a start/end date-time grid, an all-day switch, a length row, and a separate "Multiple days, different hours" toggle that swaps in a whole calendar builder. Too many controls compete for attention. This rebuild keeps every capability but shows only what's needed at each moment.

## New layout

**1. Mode picker (one row of two pills)**
- "One day" (default) and "Multiple days" replace the toggle switch. Choosing "Multiple days" swaps in the existing day calendar builder.

**2. Pick the day (quick chips)**
- Chips: Today, Tomorrow, this coming weekday (e.g. "Sat"), and "Pick date…" which reveals the date field.
- The chosen day is echoed in plain words above the time row.

**3. Pick the time**
- One row: start time, then a length chip group (1h, 1h 30m, 2h, 3h, Custom).
- The end time is shown as read-only text ("ends 8:00 PM") and only becomes an editable field after tapping "Custom" or the end text itself.
- "All day" is a small checkbox-style chip in the same row; when on, the time row collapses to a single line.

**4. Ends on a different day**
- The end-date field is hidden by default and revealed by a small "Ends on another day" link, so overnight and multi-day single events stay possible without cluttering the default case.

**5. One summary line**
- Keeps the existing plain-language summary ("Sat Sep 5, 6:00 PM – 8:00 PM · 2h") and shows validation errors in the same slot, so there's never more than one status line.

Multiple-days mode gets the same treatment inside each day row: start time, length chips, all-day chip, and a single "Same hours for every day" action instead of the current per-row copy button.

## Not changing

- All existing behaviour: end auto-shifts with the start, past dates blocked, up to 60 days, one game per day, stored duration.
- No database, server-function, or validation-rule changes.

## Technical notes

- `src/components/create/DateTimeRangeFields.tsx`: rewritten presentationally — quick day chips, collapsible end-date, read-only end time with reveal, length chips, all-day chip. Continues to read/write the same `WhenRange` and to call `setRangeDuration`, `validateWhenRange`, `formatWhenRange`, `whenRangeDurationMin` from `src/lib/game-schedule.ts`.
- New small presentational helpers in the same file (chip button, revealable field); no new library.
- `src/components/create/GameScheduleBuilder.tsx`: day rows adopt the same chip pattern; keeps `toggleScheduleDate`, `setScheduleTime`, `setScheduleEndTime`, `setScheduleAllDay`, `applyTimeToAll`.
- `src/routes/_tabs.create.tsx`: replace the multi-day switch block (lines ~572-593) with the two-pill mode picker bound to the existing `multiDay` state. Publish logic, `plans`, and duration text untouched.
- `src/lib/game-schedule.ts` gains only date-chip helpers if needed (e.g. next weekday key) with unit tests added to `game-schedule.test.ts`; existing exported behaviour unchanged so `GameScheduleBuilder.test.tsx` keeps passing.
