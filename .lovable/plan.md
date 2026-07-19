## Problem

Right now the trainer's monthly availability and every booking time are stored and rendered as "naive" wall-clock strings ("Mon 09:00", `preferred_date=2026-08-04`, `preferred_start_time=09:00`) with no timezone attached. That means:

- A trainer in New York who sets "Mon 9–11 AM" appears to a viewer in Los Angeles as "9–11 AM" — but the trainer is actually free 6–8 AM Pacific.
- Overrides use `YYYY-MM-DD` computed against the viewer's local calendar, so a slot near midnight can jump one day between trainer and attendee.
- The booking sheet's "already booked" list and conflict check operate on the same naive strings, so a request "conflict-free" for an East-Coast attendee can still collide with a real West-Coast booking.
- `preferred_date` / `preferred_start_time` displayed on the request card show the trainer's raw string to attendees regardless of their own tz.

The fix is to anchor everything to the trainer's IANA timezone and convert on the viewer side.

## Plan

### 1. Data model
- Add `timezone text` to `public.teams` (IANA name, e.g. `America/New_York`). Default to the browser tz on create; back-fill existing trainer rows with `America/New_York` and let them edit.
- Keep `availability_slots` (weekly) and `availability_overrides` (date-keyed) as they are — but define them as **trainer-local wall-clock time**.
- Keep `trainer_session_requests.preferred_date` + `preferred_start_time` as **trainer-local wall-clock** (so a slot the trainer set at 9 AM stays "9 AM their time" regardless of who books). Booking rows are always compared to the trainer's availability in the same frame.

### 2. Shared timezone utilities (`src/lib/tz.ts`)
- `getBrowserTz()` → `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- `wallTimeToInstant(dateKey, "HH:MM", tz)` → real `Date` using `Intl` offset math.
- `instantToWall(date, tz)` → `{ dateKey, hhmm, weekday }`.
- `formatInTz(date, tz, opts)` for labels + short tz code (e.g. `PDT`).
- Curated tz picker list (America, Europe, Asia buckets).

### 3. Availability resolver (`src/lib/availability-resolve.ts`)
- `resolveDay(date, weekly, overrides, { trainerTz, viewerTz, venueFilter })`:
  1. For each viewer-local date, compute the trainer-local dates it touches (a single viewer day can straddle two trainer days).
  2. Pull weekly slots for those trainer weekdays + any date-override windows keyed by the trainer-local date.
  3. Convert each window's `[start, end]` from trainer-local → UTC → viewer-local, clip to the viewer day, and return `ResolvedWindow` with `start`/`end` already in viewer-local `HH:MM`, plus `sourceTz` for display.
- `hasAvailability` uses the same pipeline.

### 4. Trainer-side editing (`AvailabilityCalendar.tsx`, `CreateOrgWizard.tsx`, `teams.$teamId.edit.tsx`)
- Always edit in **trainer tz** (the profile's own tz). Header shows "Times shown in your timezone: America/New_York (EDT). Change tz".
- Add a timezone picker to the Identity step and edit page; default to browser tz for new trainers.
- Overlap validation (`availability-slots.ts`) is unchanged — it already runs in a single frame (trainer-local).

### 5. Viewer-side display (`TrainerAvailabilityMonth.tsx`, trainer profile venue rows)
- Read `org.timezone`, compute a `viewerTz = getBrowserTz()`.
- Pass both into `resolveDay`; render windows in viewer-local time with a subtle "· in your time" label and a toggle "Show trainer's time" (persisted in URL as `?tz=trainer|viewer`, default viewer).
- Show a small chip: "Trainer is in EDT (3 hours ahead)".

### 6. Booking sheet (`BookSessionSheet.tsx`)
- `date` picker + suggested times run in the **viewer's** local frame (that's what the user picks).
- On submit, convert `(viewerDateKey, viewerHHMM)` → UTC instant → trainer-local `(dateKey, HHMM)` and send those as `preferredDate` / `preferredStartTime`. This keeps DB rows aligned to the trainer's calendar.
- Same conversion applied to `listTrainerBookedSlots` results before conflict-checking so the "already booked" chips render in viewer-local.
- Warning banner text includes both times: "You picked 9:00 AM PDT (12:00 PM EDT trainer time)".
- Existing-request card in the sheet shows both `time in your tz` and `(trainer's tz)`.

### 7. Notifications / inbox
- Any place that renders `preferred_date` + `preferred_start_time` (request cards, inbox threads) uses a shared `formatBookingTime(row, trainerTz, viewerTz)` helper so both parties see the same instant labelled in their own tz.

### 8. Migration
- `ALTER TABLE public.teams ADD COLUMN timezone text NOT NULL DEFAULT 'America/New_York';` then relax default after backfill.
- No schema change needed for `trainer_session_requests` — the semantics of existing columns are simply pinned to "trainer-local" and enforced in application code. (`list_trainer_booked_slots` RPC remains unchanged.)

### Technical notes
- All conversions use `Intl.DateTimeFormat` with `timeZone` option — no external library needed; works in every modern browser and in the Worker runtime.
- The `preferred_date` invariant to remember: **it is always the trainer-local calendar date**, so the conflict RPC keeps working with its current `WHERE preferred_date = _date` predicate.
- URL param `?tz=trainer` lets a trainer share a link that shows their own hours; default remains viewer-local for attendees.
- Historical `trainer_session_requests` rows created before this change are already effectively "browser-local at time of booking" — we treat them as trainer-local going forward; a one-line note in the request card ("Times shown in trainer's timezone") covers the small ambiguity for old rows.
