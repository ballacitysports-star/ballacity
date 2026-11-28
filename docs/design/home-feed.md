# Home feed: one place for everything you can join, plus news from what you follow

Status: **owner decisions recorded 2026-11-07.** Built in slices; every slice with a database change goes to the E2E
sandbox first and to production only with the owner's approval, as with P2-1.

## Owner decisions (2026-11-07)

- **F1. Three buckets.** The Home feed shows things you can join on a date, from anyone: pickup games, tryouts,
  clinics, camps, tournaments, open gym. News (announcements, recaps, venue and trainer updates) appears only under a
  **Following** chip. Standing listings (player availability, a trainer's 1-on-1 openings, venue hours) stay in
  Discover, not the feed.
- **F2. News under Following.** Team announcements and recaps are shown only for teams the viewer follows or belongs
  to. Posts from people, teams and venues the viewer follows also appear there (the `posts` work of #321 to #323).
- **F3. Venue events.** Venues can create clinics, camps, tournaments and open gym as events (events stage 5). They
  appear in the feed with the venue's name and badge.
- **F4. Trainer group sessions.** Trainers can post group sessions (a clinic, a camp) as events, shown in the feed.
  Their 1-on-1 openings stay booking requests in Discover. **This replaces P2-1 decision D3**, which kept trainer
  sessions out of the events model entirely.
- **F5. Youth rules apply to every card, whoever posted it.** A youth event's venue stays hidden from people who may
  not see it (D0), signed-out visitors see adult-only events only, seat counts are true, and the minors' caps on posts
  (#321) hold.

## Slices

| Slice | What                                                                                                                                                                                                                | Built on         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| A     | `posts` table (person, team and facility posts with audiences and minor caps), brought onto current `main`; the `followers` audience counts entity follows (#317) for team and facility posts                       | #321             |
| B     | App: composer, the Home posts section, posts in the moderation queue                                                                                                                                                | #322             |
| C     | **Following** chip: posts from people, teams and facilities you follow, plus team announcements and recaps for teams you follow or belong to                                                                        | #323, extended   |
| D     | **Type chips** on Home: All · Pickup · Tryouts · Clinics (Camps, Tournaments and Open gym appear once E/F exist). Tryouts and clinics come from `events` (`events_v2`), with the D0 venue rule and true seat counts | new              |
| E     | Venue events: `create_event` for facilities (host kind `facility`), venue staff rules, the create form on the venue page                                                                                            | events stage 5   |
| F     | Trainer group sessions as events (host kind `trainer`); the create form on the trainer page                                                                                                                         | new; replaces D3 |

Status (2026-11-07): A (#363), C (#365) and E (#367) are on production with `network_posts` and `venue_events` on;
B (#364) and D (#366) are merged. F (trainer group sessions) is built on the E2E sandbox behind a new
`trainer_events` switch (off); production waits for the owner's approval.

Slice E notes: venues create events from the venue page ("Clinics, camps & open gym"); the text is AI-screened like
posts, and an event is listed only once approved (held ones go to the superadmin Events queue). The feed shows them
with the venue's name and badge, and a sport filter keeps them (venues list no sports). Waivers stay per team (D2).

Order: A → B → C, and D in parallel (it needs no new tables). E and F follow D, so their events already have a place in
the feed when they can be created.

Slice F notes: a trainer (a `teams` row with kind `coach`) lists group clinics and camps from its page ("Group clinics
& camps"), stored as events with host kind `trainer` and no team, so they never appear on a team's pages. Screening and
moderation work as for venue events. Sign-ups ask for the trainer's own published waiver: `get_event_waiver` shows its
text to a signed-in member, and `register_for_event` signs it with the sign-up. 1-on-1 sessions stay booking requests
(D7). The feed shows them with the trainer's name, and a sport filter uses the trainer's sports.

## Post reports

Backlog P1-2a (migration `20261205100000_network_post_reports`, test `565_network_post_reports`). A signed-in member
can report a post on Home with the **Report** (flag) button on someone else's post. The button is not shown on the
member's own posts, on team announcements merged into Following (those are team posts, not network posts), or to
signed-out visitors, who see no posts section. The dialog offers the same reasons, in the same words, as a reported
message, and an optional note of up to 1,000 characters.

The report goes through `public.report_post(_post, _reason, _details)`, never a direct insert (a trigger refuses a
post report written straight into `user_reports` by an API role):

- The member must be able to read the post under the `posts` read rules (audience, a block either way, a hidden team
  or venue, the author's age cap, and approved, not hidden, not deleted). A post that does not exist and one they
  cannot read get the same answer, "That post isn't available.", so a report never tells whether a post exists.
- Nobody reports their own post, including one they wrote as a team or venue ("You can't report your own post.").
- The reason must be one `user_reports` allows. The reported user is the post's author: for a post made as a team or
  venue, the person who wrote it. The report is stored with subject `post`, the post's id (`user_reports.post_id`,
  cleared once the post is deleted for good, by its author, a manager of its team, or with its team, venue or author,
  so the report stays), and the md5 of the post's text at that moment (`user_reports.post_body_md5`). Only that
  fingerprint is kept, never a copy of the text.
- Reporting the same post again while the member's earlier report of it is still open (any status but resolved,
  actioned or dismissed) files nothing only when it adds nothing: the same reason, about the same text, with no new
  note. The dialog then says "You already reported this post for that reason. Our moderators will review it." Anything
  else is a new report, and the dialog says "Report submitted": a different reason (a follow-up such as a child-safety
  report), a new note, or a post edited since. Once a moderator closes a report, the same report again is a new one.
- Only the reporter and moderators read a report; the author never does (the `user_reports` read rules are unchanged).

In the moderation queue (`/admin/moderation`) a post report shows the post as it is now: its text, who it is shared
with, whether it is hidden, deleted by its author or waiting for its check, and a link to the team or venue it was
posted as; the author is linked as the reported user. The author can edit a post after it is reported, so the card
compares the text now with the report's fingerprint and says "Edited after this report: this is not the text that was
reported." when they differ. The reported words themselves are not on the card once the post is edited or deleted;
the reporter's note may describe them. A post that is gone shows "(the post was deleted for good)", without saying
who deleted it.

The existing actions apply as they do to a reported game or reel, with these differences (owner decision 2026-11-28:
Restore undoes only what this report's own action did):

- **Remove content** hides the post only while it is not hidden yet (`hidden_at` empty), and resolves the report. On a
  post that is already hidden (a superadmin's hide, or another report's) it changes nothing, and the summary says
  "Post already hidden", so this report never takes over a hide someone else made first. If the hide fails, the action
  fails and the report is not resolved.
- **Suspend** and **Ban** restrict the author only while nobody has (`suspended_at` empty and `moderation_state`
  'active' or 'warned'). On an account that is already suspended or banned (by a superadmin, for an abusive image
  upload, or by another report) they keep that suspension's `suspended_at` and reason, fill in `suspended_at` only
  where it is empty, raise a suspension to a ban, and never lower anything; the summary then ends with "(it was already
  restricted)". **Warn** never lowers a suspension or ban to a warning. If a write fails, the action fails and the
  report is not resolved.
- Each of these records what it wrote in its audit entry: Remove content the `hidden_at` it wrote
  (`after.hiddenAt`); Suspend or Ban the `suspended_at` it wrote, on an account nobody had restricted or filled in
  where it was empty (`after.suspendedAt`), the `moderation_state` it wrote, on an account nobody had restricted or
  raised to a ban (`after.moderationState`), whether it found the account unrestricted (`after.fresh`), and when it ran
  (`after.actedAt`). That is how Restore knows this report's own changes, whatever happened to the report since:
  a second action on it (Remove content then Warn or Ban, or the other way round), a status change, or an earlier
  Restore. A report acted on before this was recorded is judged by its notes ("Post hidden", "Account suspended",
  "Account banned") and its `reviewed_at`, which its action wrote from the same timestamp; anything that changed the
  report since keeps the change in place (fail safe).
- **Restore** on a post report reads everything it needs first: the post, every report about the post and every report
  about the author that is not dismissed, the author's profile, and the audit entries of every moderation action about
  the author. It reads every row of each list, page by page in id order, each page with an exact count of the rows still
  to come, so a server that cuts a response short (PostgREST's max-rows) never hides a report that keeps a change: a
  flood of reports about the author or the post cannot push it out. If any read fails, is cut short and cannot be read
  on, or needs more than 25 pages of 1,000 rows, it changes nothing, leaves the report as it was, and says "Couldn't
  read what this report changed, so Restore changed nothing. Please try again."

  It unhides the post only when this report owns the hide (an audit entry of its own Remove content holds exactly the
  post's `hidden_at`, or, for an older report, its notes start with "Post hidden" and `hidden_at` is exactly its
  `reviewed_at`, to the microsecond) and no other report keeps it: one resolved or actioned (as before), or one not
  dismissed that chose Remove content (its notes, or its audit entry).

  It clears the author's `suspended_at` and `suspended_reason` only by the same rule: this report owns the suspension
  (its audit entry, or for an older report its notes and `reviewed_at`). It sets `moderation_state` to 'active' (or
  back to 'warned' while another report's warning stands) only when this report's own action set it: its latest Suspend
  or Ban that recorded a state wrote exactly the state the account has, and no other Suspend or Ban may have written it
  since (one that recorded a state, or one that does not say, such as another kind of report's). An older report's own
  ban, by its notes, resets the state as before. This also holds once `suspended_at` is cleared: a superadmin's Restore
  account leaves `moderation_state` 'banned', which the database's gates still read, and Restore on the report whose
  Ban set it resets it. A `suspended_at` this report filled in on an account already banned is cleared, and the ban
  state, which was there before, stays (the summary says so). A suspension that is not this report's keeps everything,
  its state included. Either way only while no other report not dismissed suspended or banned the author or chose to
  (its notes, with or without "(it was already restricted)", or its audit entry); otherwise Restore is refused. When
  every action this report owns by found the account unrestricted, another report whose last change came before is left
  out: whatever it did had been lifted by then. Otherwise, and for an older report (notes only), every such report
  counts, however old. A state Restore keeps names no screen, since none resets it.

  It clears a warning only when this report issued it (its notes start with "Warning issued", or its audit entry) and no
  other report not dismissed did, and only while the state is still 'warned'. (Restore on the other kinds of report is
  unchanged here.)

  When this report owns a hide, suspension or state that another report keeps, Restore is refused: it changes nothing,
  leaves the report as it is, and says why ("Restore changed nothing and left this report as it is. … Dismiss that
  report first if its action no longer applies, then Restore this one again."). Otherwise Restore undoes what it may.
  Only when it undid something does it mark the report dismissed and write its summary into the notes, and only while
  the report is as Restore read it (`reviewed_at` unchanged); if another moderator acted on it meanwhile, its status and
  notes stay, and the summary says so. A Restore that undoes nothing leaves the report's status, notes and
  `reviewed_at` as they are ("Restore left this report as it is."): the report keeps counting as one that acted, and a
  later Restore can still undo its own action. So of two stacked reports, the one that owns nothing stays as it is when
  restored; a moderator dismisses it (Dismiss on its card) once its action no longer applies, and Restore on the other
  then undoes its own change. Each write applies only while `hidden_at`, `suspended_at` or `moderation_state` still holds the value Restore
  read, so a change made in between is kept; a post that is not hidden is not written at all. If a write fails, the
  report keeps its status and notes so Restore can run again. A report resolved between Restore's read and its write
  (a window of milliseconds) is not seen; the guarded writes do not cover a status-only change.

  Restore's summary (the toast, the report's notes, the audit entry) says what it undid ("Ban lifted.", "Post
  unhidden.", "Warning cleared.", "Nothing undone." or "Nothing to undo."), then each thing it kept and why:
  - the post: "this report's latest action did not hide it", "it was already hidden when this report's Remove content
    ran", or "it was hidden again, or this report was updated, after this report hid it";
  - the account: "this report's latest action did not suspend or ban it", "it was already suspended or banned when this
    report's action ran", or "the suspension was changed, or this report was updated, after this report's action";
  - the moderation state, once `suspended_at` is cleared: "The account stays banned: its suspension is lifted, but its
    moderation state is still banned, and …" "this report's latest action did not suspend or ban it", "Restore cannot
    tell that this report's own Suspend or Ban set it", "it was already suspended or banned when this report's action
    ran", or "another action may have set it after this report's own Suspend or Ban";
  - the warning: "this report's latest action did not issue it", or "another report about this account that is not
    dismissed issued a warning".

  The "latest action" wording is deliberate: for a report acted on before its actions were recorded, the rule can read
  only its notes, which its latest action wrote. A summary never starts with an action's summary. Restore's audit entry
  records what it cleared (`metadata.restore.lifted`: the post's `hidden_at`; the account's `suspended_at`,
  `suspended_reason` and `moderation_state`), and an account lift gets a second entry on the user. The card says before
  Restore runs when it would leave the post hidden, or that Restore changes nothing while another report keeps this
  report's own hide; if the card cannot read what it needs (a failed read, or a list cut short that it cannot read on),
  it says so (Restore checks again). A superadmin unhides such
  a post from the content queue (`/superadmin`, Content, Network posts), and lifts a suspension on `/superadmin`, Users
  & profiles, Restore account (`superadminSuspendUser`, which clears `suspended_at` and `suspended_reason` only).

  Only Remove content and the superadmin content queue write `posts.hidden_at`: no guardian, consent or screening hide
  does (a post's reach is capped by its author's age when it is read, and the screen's hold is `moderation_status`,
  which Restore never touches), so Restore cannot undo any of those.

- Resolve and Dismiss act on the report as before. Warn, Suspend and Ban on the other kinds of report act as before.

The queue reads `post_id` and `post_body_md5` only where the columns exist, so it keeps working before the migration is
applied and after its rollback (`docs/rollbacks/20261205100000_network_post_reports.down.sql`, which refuses while any
post report exists).
