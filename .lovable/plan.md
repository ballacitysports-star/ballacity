## Add date range option to Host a Game

Let hosts optionally schedule the same game on multiple days at the same time. When a range is chosen, publishing creates one game instance per day in the range.

### UI changes (`src/routes/_tabs.create.tsx`)

- Under the existing "When" datetime input, add a toggle: **"Repeat on multiple days"** (off by default).
- When on:
  - The existing "When" input becomes the **time** used for every day in the range (label switches to "Time").
  - Add two date pickers: **Start date** and **End date** (end date must be ≥ start date).
  - Show a small helper line: "Will create N games, one per day."
- When off: behavior is unchanged (single game at the chosen datetime).

### Publish logic

- Off: unchanged — one `addHostedGame` call.
- On:
  - Build the list of dates from start→end (inclusive, cap at 60 to prevent runaway).
  - For each date, combine with the chosen time to build an ISO datetime, then call `addHostedGame` with the same title/sport/location/size/price/etc.
  - If `game_payment_settings` are used, call `upsertGamePaymentSettings` for each created game (same values).
  - Show a single toast: "Created N games" and navigate to `/feed` (or the first game) as today.
- All-or-nothing failure: if any insert fails, surface the error toast and stop; already-created games remain (no rollback — matches current single-create behavior).

### Out of scope

- No schema changes (no "series" grouping table).
- No RRULE/weekday-selection recurrence — strictly one-per-day across a contiguous range.
- No edit-all-in-series; each game is independent after creation.

### Verification

- `bunx tsgo --noEmit`.
- Manually: toggle off → single game as before; toggle on with a 3-day range → 3 games appear on the feed, each at the chosen time.
