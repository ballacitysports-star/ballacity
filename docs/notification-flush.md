# Held push notifications (minor curfew) and the flush call

A push for a minor that arrives inside their quiet window is not sent. It is
stored in `scheduled_notifications` with a `deliver_after` time (the in-app
notification is written at once). So is any push whose minor-safety check could
not be made: it is held with `deliver_after` set to now, and checked again
before it goes out. Nothing sends a held push later unless something calls the
flush endpoint, so **a scheduler must call it**; without one, held pushes never
go out.

## Before a push goes out (`deliverPush`, `src/lib/push.server.ts`)

The app's pushes go out through `deliverPush` (game reminders, notifications
sent from the app, guardian prompts; the settings page's test push and the
flush below send on their own). It first asks `curfewGateFor`
(`src/lib/push-curfew.server.ts`), which reads the active age policy
(`app_settings`), the recipient's profile (age cohort, time zone) and their
guardian controls (`child_controls`):

- Guardian switched the child's notifications off: not sent.
- A minor inside their quiet window: held until the window ends
  (`reason` `minor_notification_curfew`).
- **Any of the three reads fails** (answers with an error, or throws): the gate
  fails closed. The push is held with `deliver_after` = now (`reason`
  `curfew_check_failed`) and the flush below reads the settings again before
  sending it. A failed read cannot tell a minor from an adult, so this holds
  anyone's push, adults' included; it is never sent on a guess. (Before, a
  failed profile read made a minor look like an adult and the push was sent.)
- If the hold itself cannot be written to `scheduled_notifications`, the push is
  not sent and the log row says `failed`, `queue_failed`.
- A push with `expiresAt` that would be delivered at or after it (now, or when
  its hold ends) is dropped: not sent, not held. Game reminders pass the game's
  start. The flush does not check the expiry again (`scheduled_notifications`
  has no column for it), so a held push whose window moves, or whose settings
  check keeps failing through the flush's retries, can still arrive late.

Each outcome writes a `notification_delivery_log` row: `sent`, `failed`, or
`skipped` with the reason in `error` (`guardian_notifications_off`,
`minor_notification_curfew`, `curfew_check_failed`, `expired`,
`no_subscribers`, `not_configured`). When the caller names the in-app
notification (game reminders do), the row's `notification_id` links to it.

### What the member sees

The notifications panel shows a "Push delivery issue" banner for failed and
skipped pushes of the last 7 days (`src/lib/push-delivery.ts`). Held pushes
(`minor_notification_curfew`, `curfew_check_failed`) and `expired` ones are left
out: they are not a problem the member can fix. `no_subscribers` still shows: it
tells them to turn push on.

## The scheduler (P2-7)

`supabase/migrations/20261108160000_scheduled_jobs.sql` schedules it with pg_cron every 5 minutes
(`flush-held-notifications`), next to `send-game-reminders` (`/api/public/reminders/run`, game
reminders, below) and a daily `purge-app-error-events`. The jobs call the app through
`private_sec.worker_post`, which reads the secret from Vault and the app's address from the
`worker_base_url` setting or, when that is empty, from the existing reels job. pg_net waits 5
seconds for the answer.

## Game reminders (`src/lib/game-reminders.server.ts`)

`send-game-reminders` runs the same sweep the app runs for a signed-in player (on load and every
5 minutes while the app is open). A run:

1. Reads the reminders and their games that start in the next 8 days; cancelled and past games
   are skipped.
2. Finds each reminder's due window: the **smallest** window that has opened and was not sent. A
   player who joins 100 minutes before a game with reminders at 1 day and 2 hours gets one
   reminder, for the 2-hour window; the 1-day window passes with it.
3. Takes on at most 100 due reminders, soonest game first, and reads with one query each: the
   games' roster (`game_participants`), their open join requests (`join_requests` with status
   `pending` or `approved`), and the players' notification preferences.
4. Decides who gets a reminder:
   - a place in the game: the in-app reminder and a push;
   - an open request (pending or approved, no place yet): the in-app reminder only;
   - neither (declined, withdrew, left, removed): nothing, and their reminder row for that game
     is deleted, unless they saved it again after the run read it.

   If the roster or the requests cannot be read, the run fails without sending or deleting
   anything, and the reminders stay due.
5. Goes through the reminders in order until the run has taken 3 seconds. For each, it claims
   it (so the scheduler and the app, or two runs, send it once; the claim passes the larger
   windows too) and writes the in-app notification: `<game> starts in <time left>`, worded from
   the minutes actually left ("1 hour 40 minutes", "2 hours", "1 day"), the start time, the
   venue, and a link to the game. If the write fails, the claim is given back, nothing is pushed,
   and the next run tries again. Reminders it did not reach stay due for the next run.
6. Then pushes, 4 at a time, with `deliverPush`: the same title; the start as weekday, date and
   time in New York time, never "Today" or "Tomorrow" (`Mon, Nov 9 · 6:00 PM`, or
   `Tue, Nov 10 (all day)`); the game link; and the game's start as `expiresAt`. The venue is left
   out, so a lock screen does not show it (the title is the host's, as written). No push when the
   player switched Game reminders push off (`notification_preferences.prefs.gameReminders.push`,
   read with the app's own merge rules from `src/lib/notification-prefs-core.ts`; on when not
   set), or when the preferences cannot be read.
7. `deliverPush` then applies the checks above: quiet hours, the guardian's switch, the fail-closed
   hold, and the expiry, so a minor's reminder held past the game's start is dropped.

The response is `{ ok, sent, checked, pushed, removed, deferred }`: in-app reminders written,
reminders with a game ahead, pushes handed to `deliverPush`, rows deleted, and due reminders left
for the next run.

The server runs in UTC. The push's day and time are formatted in `America/New_York`, the zone the
app uses for every game time (`src/lib/format.ts`), with no zone label, as on the game page. The
in-app reminder's body still uses the app's relative line ("Today · 6:00 PM").

A reminder reaches a phone while the app is closed only when the player has a push subscription
on it; without one, the log row says `no_subscribers`. A push sent straight away that fails is not
retried (a held one retries as below). Either way the reminder is in the app's notifications. A
held reminder keeps the title worded when it was due ("starts in 2 hours").

## The call

- `POST /api/public/notifications/flush`
- Header `x-worker-secret: <the worker secret>` (or `Authorization: Bearer <secret>`).
  The secret is `REELS_WORKER_SECRET` on the site or the `reels_worker_secret`
  entry in Vault. It is shared with the reels and payment-hold workers.
- Every 5 minutes is enough: a push goes out at most about 5 minutes after its
  quiet window ends.
- Safe to retry or to run from two schedulers: each row is claimed before it is
  sent, so overlapping calls send it once.

## What a call does (`src/lib/notification-flush.server.ts`)

For each queued row that is due (up to 50 per call), oldest first:

1. Claims it. If another call got there first, it is skipped.
2. Checks the recipient's settings **now**, not as they were when queued:
   - guardian switched notifications off: the row is `cancelled`, nothing is sent;
   - still inside a quiet window (or the window moved): the row waits for the new time;
   - the settings lookup failed (any of the reads answers with an error or throws): the row is
     held and retried, never sent on a guess.
3. Sends through OneSignal. A failure, or a failed settings lookup, retries after 5, 10, 20, 40
   minutes, then the row is `failed`.
4. Records the outcome in `notification_delivery_log`.

## The response, for monitoring

```json
{
  "ok": true,
  "processed": 3,
  "sent": 2,
  "rescheduled": 1,
  "cancelled": 0,
  "retrying": 0,
  "failed": 0,
  "skipped": 0,
  "overdue": 0
}
```

Alert when `overdue` is above 0 on consecutive calls (queued rows more than an
hour past due: the scheduler or the provider is down), when `failed` rises, or
when the call stops arriving. A `401` means the secret is wrong; `500` carries
the error text.

## Needs ONESIGNAL_REST_API_KEY

Without it, due rows are marked `failed` with `not_configured`.
