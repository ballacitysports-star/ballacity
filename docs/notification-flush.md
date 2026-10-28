# Held push notifications (minor curfew) and the flush call

A push for a minor that arrives inside their quiet window is not sent. It is
stored in `scheduled_notifications` with a `deliver_after` time (the in-app
notification is written at once). Nothing sends it later unless something calls
the flush endpoint, so **a scheduler must call it**; without one, held pushes
never go out.

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
{ "ok": true, "processed": 3, "sent": 2, "rescheduled": 1, "cancelled": 0,
  "retrying": 0, "failed": 0, "skipped": 0, "overdue": 0 }
```

Alert when `overdue` is above 0 on consecutive calls (queued rows more than an
hour past due: the scheduler or the provider is down), when `failed` rises, or
when the call stops arriving. A `401` means the secret is wrong; `500` carries
the error text.

## Needs ONESIGNAL_REST_API_KEY

Without it, due rows are marked `failed` with `not_configured`.
