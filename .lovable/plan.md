## Goal

When a user picks a session date/time in `BookSessionSheet`, warn clearly and block the booking if the chosen window falls outside the trainer's availability or overlaps another pending/accepted session.

## Changes

### 1. DB — add start time to session requests

Migration on `public.trainer_session_requests`:
- Add `preferred_start_time TIME NULL` (nullable so legacy rows stay valid).
- Add index `(trainer_id, preferred_date)` for fast per-day conflict lookup.

### 2. Booking UI (`src/components/BookSessionSheet.tsx`)

- Add a **Start time** field beside Duration. Render 30-minute chips generated from `resolveDay(date, slots, overrides)` (each availability window split into slots long enough to fit the selected duration); include a free "Custom time" `<input type="time">` for anything else.
- Introduce a `selectedWindow` = `{ startMin, endMin }` derived from start time + duration.
- Load conflicts for the chosen date once (server function `listTrainerBookingsForDate({ trainerId, date })` in a new `src/lib/trainer-requests.functions.ts`) — returns `{ start, end, status }[]` for accepted + pending requests belonging to that trainer where `preferred_date = date` and `preferred_start_time IS NOT NULL`. Uses `requireSupabaseAuth`; RLS already lets participants read their own rows, so use `supabaseAdmin` inside after validating input to expose only start/end/status (no identifying data).
- Compute two flags:
  - `offAvailability`: chosen window is not fully covered by any available window for that day (via `resolveDay`).
  - `overlapping`: chosen window intersects any loaded booking window.
- Render a red banner at the top of the form when either flag is true:
  - "Trainer isn't available at this time" (off-availability), listing today's available windows.
  - "This time overlaps another session" (conflict), listing the conflicting window(s) and status.
  - Provide a "Pick a suggested time" button that jumps to and selects the next free slot from `resolveDay` that fits the duration and doesn't overlap.
- Disable the **Send request** button while either flag is true; keep the button label ("Send request") and add `aria-disabled` + a tooltip title explaining why.
- Skip the check (and allow submit) only when no date is chosen — matches existing "date-optional" flow; if a time is picked, a date becomes required.

### 3. Server-side hard block

- Update `createTrainerSessionRequest` in `src/lib/trainer-requests.ts` (or its `.functions` counterpart) to accept `preferredStartTime`, validate it with Zod, and — inside the handler — re-check for overlaps against the same trainer/date using the authenticated client. Throw a friendly `Error("This time just got booked — please pick another slot.")` on conflict so the client shows a toast even if the UI check was stale.
- Return the new row shape including `preferred_start_time`.

### 4. Types & display

- Extend `TrainerSessionRequest` type with `preferred_start_time: string | null`.
- Show the start time in `ExistingRequestView`'s "Preferred date" row when present (formatted `Wed, Mar 5 · 6:00–7:00 PM`).

## Out of scope

- Multi-day/recurring bookings.
- Time-zone selection (uses trainer's local time, matching the existing availability model).
- Blocking overlaps against the requesting user's *own* calendar (only trainer-side conflicts).
