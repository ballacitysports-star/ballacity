# Start-to-end times when hosting a game

Today the "When" section only asks for a start time — every game silently becomes 90 minutes long. This replaces it with a real start → end picker, keeps the multi-day option, and adds all-day events.

## What changes

**Single event (default)**
- "Starts" date + time and "Ends" date + time. End defaults to 90 minutes after the start and auto-shifts when you change the start (until you edit it yourself).
- End may fall on a later day, so an overnight or multi-day single event works.
- Quick-length chips (1h, 1h30, 2h, 3h) set the end for you.
- "All day" toggle: hides the times, keeps the dates, and the event runs the full day (or full span of days).
- Inline validation: the end must be after the start.
- The section shows a plain summary, e.g. "Sat Sep 5, 6:00 PM – 8:00 PM · 2h" or "All day, Sat Sep 5 – Sun Sep 6".

**Multiple days, different hours (existing toggle)**
- Each picked day now has a start time *and* an end time, instead of just a start.
- Per-day "All day" checkbox.
- Existing helpers stay: quick-add weekdays/weekends, "apply to all days" (now applies start + end together), clear.
- Still creates one game per day, each with its own length.

**Where the length shows up**
- The stored game length drives the existing "finished game" logic and the Archive/Upcoming split, so a 3-hour game no longer disappears after 90 minutes.
- The game detail page already displays the length field; it will now read the real value (e.g. "180 min", "All day").

## Technical notes

- `src/lib/game-schedule.ts`: extend `ScheduleEntry` to `{ date, time, endTime, allDay }`; update `normalizeSchedule`, `toggleScheduleDate`, `setScheduleTime` (+ new end/all-day setters), `applyTimeToAll`, `validateSchedule` (end after start), and `scheduleToIsoDates` → return `{ startIso, durationMin }` pairs. Backfill the existing unit tests in `src/lib/game-schedule.test.ts`.
- `src/components/create/GameScheduleBuilder.tsx`: add the end-time input and all-day checkbox per row; summary line reflects ranges.
- New `src/components/create/DateTimeRangeFields.tsx` for the single-event start/end/all-day UI.
- `src/routes/_tabs.create.tsx`: replace the single `when` input with the new range fields; on publish pass `duration` per created game.
- `src/lib/hosted-games-store.ts`: accept `duration` on `HostedGameInput` instead of hardcoding `"90 min"` (existing `duration` text column is used — no migration needed).
- `src/lib/game-time.ts` already parses "N min"/"N h"; all-day maps to a full-day minute count so nothing else needs to change.
