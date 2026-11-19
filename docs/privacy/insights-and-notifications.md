# Two closed gaps: review summaries and notifications sent by the app

Status: **on branch `claude/lucid-franklin-bxb02r`, tested on scratch databases and applied to the sandbox. Not merged, not
published, not applied to production.**

## 1. An AI review summary follows the reviews behind it

Migration `supabase/migrations/20261120100000_insights_follow_review_visibility.sql` (md5 65a76982); test
`supabase/tests/910_insights_follow_review_visibility.test.sql` (44 assertions); rollback
`docs/rollbacks/20261120100000_insights_follow_review_visibility.down.sql`.

**What was wrong.** A summary (`reputation_insights`) is written from a person's public, unflagged reviews and kept. When those
reviews were later made private, flagged by moderation or deleted, the summary of them stayed readable to everyone, signed-out
visitors included. The read rule checked only the minor protection.

**The sandbox's earlier fix was not used.** The sandbox carried an out-of-repo rule (ledger `20261118021038`) that let a summary
be read by its subject or whenever any non-private review existed. That rule dropped the minor protection (a summary about a
16-year-old with one old public review row became readable) and ignored moderation flags.

**What it changes.** One read rule, "Insights follow review visibility": the minor protection as before
(`private_sec.insight_is_publishable`) **and** a review of the same subject and kind that is public, not flagged and publishable
under the minor rules (`private_sec.insight_has_public_review`). Nothing is written to or deleted from any table: a summary that
is hidden comes back if a review behind it becomes public again, and the server regenerates summaries as before.

The subject no longer sees a summary none of whose reviews is public. Before, they saw it like everyone else.

**Tests.**

- 910: hidden after its only review is made private, flagged or deleted (for visitors, members and the subject), readable again
  when made public; one public review among private ones is enough; a review of another kind or one written by a minor does not
  count; a 16-year-old's summary stays hidden; a summary from when its subject was 17 stays hidden after an adult-era public
  review exists, and a regenerated one is readable.
- Negative control: against the old rule, 15 of the behaviour assertions fail (the private, flagged, deleted and minor-authored
  cases for each of the three viewers); the minor-protection ones pass under both rules.
- 310 (minor reviews) gained two fixture reviews so the summaries it expects to be readable are backed by a public review; no
  assertion changed, and it passes with and without the migration (130/130).

**Checked.** Local rehearsal of the ledger route: a wrong md5 refuses and leaves nothing; the right one gives the branch replay's
catalog (82436982, 3377 objects). The rollback refuses without its confirmation, then returns the catalog exactly to `main`'s
(2bfce7f3, 3376), and refuses a second run. On the sandbox (`qkukefvzwlyusvspablz`): the wrong-md5 control refused (ledger
stayed 56); the apply put ledger row 57 (md5 65a76982) and replaced the out-of-repo rule. The sandbox now equals the branch
replay (82436982), apart from one table no migration creates (`public._schema_import_requests`), which was left alone.

## 2. What the app may send another member

Code `src/lib/notification-guard.ts`, `src/lib/notifications.functions.ts`, `src/lib/push.functions.ts`,
`src/lib/notifications.ts`; tests `src/lib/notification-guard.test.ts`, `src/lib/sec2-helper-callers.test.ts`.

**What was wrong.** `createNotificationForUser` checked only that the sender had some relationship with the recipient
(`can_notify`: a shared game, chat, team or a contact request). The type, title, body and link were whatever the sender's app sent,
and `sendPushToUser` pushed any title, text and URL the same way. One contact request was enough to send someone a "safety" alert
(a category that cannot be switched off) or a push linking to any website.

**What it changes.**

- For someone else, the server accepts only the 18 types the app's own screens send (games, payments, waitlist, messages,
  availability updates) and only a link into the app under `/games/`, `/messages/` or `/players` (absolute only on BallaCity's
  own hosts or a Lovable preview). Anything else is refused (`NOTIFICATION_TYPE_NOT_ALLOWED`, `NOTIFICATION_LINK_NOT_ALLOWED`);
  the title is cut to 120 characters and the body to 500.
- The push is sent by the server from the stored notification, so it carries the same text and link. `sendPushToUser` no longer
  pushes to anyone but the caller.
- Notifications to oneself and the ones the database writes (game invitations, reminders, safety notices) are unchanged.
- A unit test reads every `createNotification` call in `src` and checks its type and link against the guard, so the list cannot
  fall behind the screens unnoticed (a mutation to `safety_alert` or an outside link fails it).

**Before the release.** An app still open from before the publish sends its notifications through the new server, which also
pushes them, and its separate push call is refused. Nothing is sent twice.
