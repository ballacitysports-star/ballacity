# Held push notifications (minor curfew) and the flush call

A push for a minor that arrives inside their quiet window is not sent. It is
stored in `scheduled_notifications` with a `deliver_after` time (the in-app
notification is written at once). Nothing sends it later unless something calls
the flush endpoint, so **a scheduler must call it**; without one, held pushes
never go out.

## The scheduler (P2-7)

`supabase/migrations/20261108160000_scheduled_jobs.sql` schedules it with pg_cron every 5 minutes
(`flush-held-notifications`), next to `send-game-reminders` (`/api/public/reminders/run`, game
reminders, below) and a daily `purge-app-error-events`. The jobs call the app through
`private_sec.worker_post`, which reads the secret from Vault and the app's address from the
`worker_base_url` setting or, when that is empty, from the existing reels job.

## Game reminders (`src/lib/game-reminders.server.ts`)

`send-game-reminders` runs the same sweep the app runs for a signed-in player (on load and every
5 minutes while the app is open). For each reminder that is due, it:

1. Claims it, so the scheduler and the app (or two runs) send it once.
2. Writes the in-app notification: `<game> starts in <lead time>`, the start time, the venue, and
   a link to the game. If the write fails, the claim is given back, nothing is pushed, and the
   next run tries again.
3. Pushes it to the player's phone with `deliverPush` (`src/lib/push.server.ts`): the same title,
   the start time, and the game link. The game's location is left out, so a lock screen does not
   show the venue (the title is the host's, as written). No push when the player switched Game
   reminders push off
   (`notification_preferences.prefs.gameReminders.push`, read with the app's own merge rules from
   `src/lib/notification-prefs-core.ts`; on when not set), or when their preferences cannot be
   read.
4. `deliverPush` then applies the minor curfew: inside a minor's quiet window the push is held in
   `scheduled_notifications` and this flush sends it once the window ends; if a guardian switched
   the child's notifications off, nothing is sent. Each push writes a `notification_delivery_log`
   row (`sent`, `failed`, or `skipped` with the reason, e.g. `minor_notification_curfew` or
   `no_subscribers`).

A reminder reaches a phone while the app is closed only when the player has a push subscription
on it; without one, the log row says `no_subscribers`. A push sent straight away that fails is not
retried (a held one retries as below). Either way the reminder is in the app's notifications.

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
   - the settings lookup failed: the row is held and retried, never sent on a guess.
3. Sends through OneSignal. A failure retries after 5, 10, 20, 40 minutes, then the row is `failed`.
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
