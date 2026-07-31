## Problem

Today's "when are you free" input is thin and partly lossy:

- It offers one start date and one end date plus weekday chips.
- The two inputs are `datetime-local`, but the times you type are **thrown away** — only the date part is saved (`starts_on`/`ends_on` are date columns).
- There's no way to say "Sat morning and Tue evening" — only a blanket range.

## What we'll build

Two modes in the availability composer, switched by a segmented control:

**1. Specific dates (new default)**
- A month calendar where you tap to select any number of individual dates (multi-select, tap again to deselect, forward-looking only).
- Selected dates appear as a list below. Each row gets its own time window (start–end) via a compact time picker.
- Quick actions: "Apply this time to all dates", plus presets (Morning 6–11, Afternoon 12–5, Evening 5–10, All day).
- Timezone is captured from the device so viewers see it in their own time (same helpers the trainer calendar already uses).

**2. Recurring weekly (existing behavior, cleaned up)**
- Weekday chips + a date range for how long the pattern runs.
- Each selected weekday can carry its own time window, with the same "apply to all" shortcut.

Both modes share one summary line at the bottom ("3 dates · Sat 8–11 AM, Sun 6–9 PM") so it's obvious what will be posted before submitting.

## Where it shows up

- Player cards and the Nearby Players panel show the next upcoming date + time instead of a raw date range.
- The Players tab time filters (Today / This week / Weekend / Anytime) match against the concrete dates and times, so results are accurate rather than range-approximate.
- The availability detail and contact-request screens show the full list of dates and times.

## Technical notes

- Add a `time_slots` JSONB column to `player_availabilities`: an array of `{ date: "YYYY-MM-DD", start: "HH:MM", end: "HH:MM" }` for specific dates, plus `{ weekday: 0-6, start, end }` entries for recurring mode, and a `timezone` text column. Existing `starts_on` / `ends_on` / `recurring_days` stay populated (derived from the slots) so current queries, filters, and older posts keep working.
- New helper module `src/lib/availability-timeslots.ts`: normalize/validate slots, derive the legacy range and weekday list, compute the next upcoming slot, and format summaries. Unit-tested.
- New component `src/components/availability/AvailabilitySchedulePicker.tsx` holding the calendar, slot rows, and presets; the composer dialog in `src/routes/_tabs.players.tsx` and the availability screens consume it.
- Filtering: extend `listOpenAvailabilities` to keep the existing coarse SQL window filter, then refine client-side against `time_slots` so "Today"/"Weekend" are exact.
- Validation: end after start, max ~20 dates per post, dates must be in the future, overlapping same-day windows merged.
