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
  venue, the person who wrote it. The report is stored with subject `post` and the post's id (`user_reports.post_id`,
  cleared if the author later deletes the post for good, so the report stays).
- While the member's earlier report of the same post is still open, reporting it again files nothing new and answers
  with that report. Once a moderator resolves or dismisses it, a new report is a new row.
- Only the reporter and moderators read a report; the author never does (the `user_reports` read rules are unchanged).

In the moderation queue (`/admin/moderation`) a post report shows the post's text, who it was shared with, whether it
is hidden, deleted or waiting for its check, and a link to the team or venue it was posted as; the author is linked as
the reported user. The existing actions apply as they do to a reported game or reel: **Remove content** hides the post,
**Restore** unhides it, and Warn, Suspend, Ban, Resolve and Dismiss act on the author and the report as before. The
queue reads `post_id` only where the column exists, so it keeps working before the migration is applied and after its
rollback (`docs/rollbacks/20261205100000_network_post_reports.down.sql`, which refuses while any post report exists).
