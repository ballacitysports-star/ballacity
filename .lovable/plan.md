# All-day availability slots should not show clock times

## Problem
Availability slots created with the "All day" preset are stored as `08:00–22:00`, so every place that renders a slot shows times: "Next: Sat, Sep 12 8 AM–10 PM · Sat, Sep 12 8 AM–10 PM …". All-day selections should render as the date plus an "All day" marker with no clock times — the same rule the app already applies to all-day games (`formatGameWhen`).

## Changes (all in slot formatting, one shared module)

**`src/lib/availability-timeslots.ts`**
- Add `isAllDaySlot(slot)`: true when the slot spans the whole day — `start === "00:00"` with `end === "24:00"`/`"23:59"`, or it matches the "All day" preset window (`08:00–22:00`).
- `formatSlot`: all-day slots render as `Sat, Sep 12 · All day` (no times).
- `summarizeSlots`: inherits the all-day label via `formatSlot`.
- `formatAvailabilityWindow`: the "Next:" line for an all-day slot renders `Next: Sat, Sep 12 · All day` with no times.
- Mixed lists (some timed, some all-day) keep times on the timed slots only.

This one module feeds every surface, so the fix applies everywhere at once:
- Players browse list (`_tabs.players.tsx`) — the selected element
- Availability detail dialog (`AvailabilityDetailDialog.tsx`)
- Player profile page (`players.$userId.tsx`)
- My availability view (`MineView.tsx`)
- Schedule picker summary (`AvailabilitySchedulePicker.tsx`)

## Tests
Extend the availability-timeslots unit tests (or add one) covering:
- All-day preset slot renders with "All day" and no time in `formatSlot`, `summarizeSlots`, and `formatAvailabilityWindow`.
- Full-day `00:00–24:00` slot renders as all-day.
- Timed slots are unchanged; mixed slot lists only label the all-day ones.

## Technical details
- No data migration needed: existing `08:00–22:00` slots are detected by matching the preset window.
- Mirrors the established all-day rule in `src/lib/format.ts` (games never show a clock time when all-day).
