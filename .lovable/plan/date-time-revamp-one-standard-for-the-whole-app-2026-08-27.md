# Date & Time Revamp — One Standard for the Whole App

Today each surface handles dates its own way: game creation has start/end + multi-day, availability has its own slot model, gym hours have another, and display labels are hardcoded to New York time. This makes one shared date & time system and uses it everywhere a date is picked or shown.

## 1. One shared time engine

A single module owns everything: parsing, math, recurrence, and every label the app prints.

- Every scheduled thing gets a **start**, an **end**, an **all-day flag**, and its **own timezone** (captured from the venue/location when created, falling back to the creator's device zone).
- Labels always render in the event's timezone, with the zone shown (e.g. "Sat, Sep 5 · 6:00–7:30 PM EDT") and a quiet "9:00 PM your time" line when the viewer is in a different zone.
- Standard label set used app-wide: relative ("Today", "Tomorrow", "In 3 days"), day, time range, duration, multi-day range, countdown, and past ("Ended 2h ago").
- Timezone-safe: no more hardcoded New York, and no server/browser mismatch on first paint.

## 2. Richer time control

- Start → end with real duration; minute-level precision (5-minute steps by default, any minute via custom).
- All-day and multi-day events, including events that cross midnight.
- Optional **arrival/buffer time** ("arrive 15 min early") shown to joiners.
- Per-session times on multi-day events (each day can differ), with "same hours every day" as one tap.

## 3. Recurring schedules

- Repeat options: does not repeat, daily, weekly (pick weekdays), every 2 weeks, monthly (same weekday).
- Ends after N occurrences or on a date; hard cap on generated sessions.
- Individual dates can be skipped or given custom times; skipped/edited dates are remembered.
- Recurring events publish as one linked series, so the feed still shows a single card (uses the existing series grouping).

## 4. Better calendar UI

A shared date/time picker component replaces the ad-hoc inputs everywhere:

- Month calendar with drag/tap range select and multi-date select.
- Quick chips: Today, Tomorrow, next weekday, This weekend.
- Time picker with a scrollable list plus typed entry; length chips (1h, 1.5h, 2h, 3h, custom).
- Live summary line so users always see exactly what they're creating.
- Conflict warnings when a new session overlaps something the user already hosts or is joined to.
- "Add to calendar" (Apple/Google/Outlook via .ics) on game and session views.

## 5. Deadlines & reminders

- Signup cutoff and RSVP deadline expressed relative to start ("2h before", "1 day before") or as an absolute time — unified with the existing cutoff field.
- Payment deadline uses the same control.
- Reminder lead times (24h / 2h / 30m before) that drive existing notifications and push.
- All deadlines render with the same standard labels and respect the event timezone.

## 6. Rollout across the app

The shared picker and labels replace current one-off handling in:

- Host a game (create + edit)
- Player availability (dates, slots, recurrence)
- Trainer booking and trainer availability
- Team posts / events
- Gym hours
- Feed cards, game detail, archive, series strip, notifications, messages, superadmin lists

Existing data keeps working: old records without an explicit end/timezone fall back to the current duration text and a sensible zone, so nothing breaks and nothing needs manual fixing.

## Technical notes

- New `src/lib/datetime.ts` as the single source of truth (zone-aware formatting, ranges, durations, relative/countdown labels); `src/lib/format.ts` and `src/lib/game-time.ts` become thin wrappers over it, keeping `isGameFinished` semantics and the 15-minute grace period.
- New `src/lib/recurrence.ts` for rule expansion (daily/weekly/biweekly/monthly, count/until, exceptions) plus unit tests.
- New shared UI in `src/components/datetime/`: `DateTimeRangePicker`, `MultiDateCalendar`, `TimeField`, `RecurrenceFields`, `DeadlineField`, `RelativeTime`. `DateTimeRangeFields.tsx` and `GameScheduleBuilder.tsx` are refactored onto them rather than duplicated.
- Database migration on `hosted_games`: add `ends_at timestamptz`, `all_day boolean`, `timezone text`, `arrive_early_min int`, `rrule jsonb`, `reminder_offsets int[]`; backfill `ends_at` from `date` + existing `duration` text and `timezone` from venue geo/creator zone. `duration` stays for compatibility.
- `player_availabilities`, `team_posts`, and `trainer_orgs.hours` already carry timezone/slot fields — those are mapped onto the shared types instead of new columns.
- `.ics` generation is client-side; no server dependency.
- Tests: extend `src/lib/game-schedule.test.ts`, add datetime + recurrence tests, and a Playwright pass over create → feed → game detail on mobile viewport.
