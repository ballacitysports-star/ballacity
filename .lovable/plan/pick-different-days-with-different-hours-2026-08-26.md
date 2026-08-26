# Pick different days with different hours

Right now, hosting on multiple days forces one shared start time: you toggle "Repeat on multiple days", pick a start and end date, and every game in that stretch gets the same clock time. This adds a real day-by-day schedule builder.

## Create game — per-day times

Replace the start/end date range with a schedule list:

- Tap a calendar to select any set of individual days (they don't have to be consecutive).
- Each selected day appears as its own row with its own start time, defaulting to the time you set for the previous day so quick setups stay quick.
- Row actions: change the time, "Apply this time to all days", remove the day.
- Quick pickers still available: "Weekdays", "Weekends", and a "same time everywhere" preset.
- Summary line reads e.g. "Creates 3 games: Mon Sep 7 · 6:00 PM, Wed Sep 9 · 7:30 PM, Sat Sep 12 · 10:00 AM".
- Single-day hosting is unchanged: one date-and-time field, no schedule list.
- Everything else on the game (venue, spots, fee, age requirement, approval) still applies to every day, as today.
- Limits kept: up to 60 days, past dates blocked, and each day must have a valid time before publishing.

## Player availability

The availability picker already supports individual dates each with their own start and end time, plus weekly repeating windows. Two small gaps get closed so it matches the create-game feel:

- Selecting a new date copies the previous row's hours instead of resetting to the default window.
- Add a per-row "Apply to all" that is clearly labelled (today's copy button is easy to miss).

No data-model change — slots already store hours per day.

## Team / gym hours

Weekday hours already save independently per day, including closed and 24-hour days. Change here is presentation only: label the section so it's clear each day can differ, and keep the copy-to-all-days shortcut.

## Technical section

- `src/routes/_tabs.create.tsx`: replace `repeatRange` / `rangeStart` / `rangeEnd` / `rangeDates` with `schedule: Array<{ date: string; time: string }>`. Publish loop maps each entry to `new Date(`${date}T${time}`).toISOString()`, keeping the existing per-game `addHostedGame` + `upsertGamePaymentSettings` calls and the multi-game toast / navigation branch.
- New `src/components/create/GameScheduleBuilder.tsx` holding the month calendar, day rows, presets, and validation; `src/lib/game-schedule.ts` for pure helpers (sort, dedupe, format summary, validate) with unit tests.
- Availability tweaks are local to `src/components/availability/AvailabilitySchedulePicker.tsx`; `src/lib/availability-timeslots.ts` is untouched.
- Hours change is label-only in `src/components/org/HoursEditor.tsx`.
- No database or server-function changes: each scheduled day is still one `hosted_games` row.
