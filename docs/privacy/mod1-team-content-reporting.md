# MOD-1: reporting team posts, comments and attached media

Status: **implemented locally (database, client helpers, tests), open in a pull request. Not merged, not applied to production, not verified in production.** The report buttons on the post and comment screens are **not** wired yet (see "Not included").

## What it reuses

`user_reports` (the existing moderator queue), the existing `held` / hidden states of `team_posts` and `post_comments`, `image_moderation` (quarantine), `notifications`, `admin_audit_log`, `user_blocks` (unchanged; the reporter can still block), `ReportDialog` and `submitReport`.

## Rules

| Topic                | Rule                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Who can report       | any signed-in account that can **read** the item (checked under the reporter's own row security; a hidden, held or unknown id gives the same answer, so there is no oracle). Blocked accounts can still report. Anonymous cannot.                                                                                                                                                    |
| Who is reported      | taken from the item, never from the client. Reporting your own item is refused.                                                                                                                                                                                                                                                                                                      |
| Duplicates and abuse | one open report per reporter per item; 20 content reports per reporter per 24 hours.                                                                                                                                                                                                                                                                                                 |
| Privacy of reports   | readable only by the reporter and moderators; the author is never told who reported (notifications carry no reporter detail).                                                                                                                                                                                                                                                        |
| Escalation           | reasons `minor_safety`, `threats`, `illegal` start as `escalated`.                                                                                                                                                                                                                                                                                                                   |
| Automatic hold       | the item becomes `held` (visible only to its author and the team's managers) when enough different people report it within 30 days: 1 for `minor_safety`/`illegal`; 2 when the author is not a confirmed adult; 3 otherwise. A hold never deletes anything, records the prior status, notifies the author with a way to ask for review, and is released by a moderator or an appeal. |
| Media                | the image attached to a post is covered by the post's hold; a moderator can also quarantine it (`remove_media`), which hides it app-wide through the existing image quarantine without deleting the file.                                                                                                                                                                            |
| Moderator decisions  | `dismiss`, `hide` (uphold), `remove_media`, `restore`; moderators/administrators only; every decision audited with the actor; the author is notified neutrally. Dismissing the last open report releases an automatic hold, so brigading cannot leave content held forever.                                                                                                          |
| Appeals              | the author, or a verified guardian of a minor author, can ask for review of a held or hidden item (one open appeal at a time, 500 characters). A **different** moderator (or an administrator) reviews; reversing restores the earlier status and visibility.                                                                                                                        |
| Retention            | closed reports and decided appeals: 24 months after closure (`private_sec.purge_closed_content_reports`, service role, **not scheduled**, minimum 12 months). Escalated reports and open appeals are never purged. Documented in `src/lib/retention.ts`; legal review of the durations is still required.                                                                            |

## Compatibility and rollout

Additive: two columns, two tables, triggers and functions. Existing report types are untouched. An older app never sends the new fields. Apply after the G6 migration (reason list). Recovery is forward only; holds are reversible by moderators.

## Tests

`supabase/tests/450_team_content_reports.test.sql` (67 assertions): reporting by members, strangers, anonymous, blocked accounts and authors; spoofed reported account; held and unknown ids; duplicates; rate limit; report privacy for author, other reporters and moderators; thresholds for adult and under-18 authors; child-safety escalation; comment holds; visibility of held items for stranger, author and manager; moderator decisions, audit, media quarantine, non-moderator refusal; appeals by author, guardian and stranger; reviewer independence and administrator override; restoration; retention rules and grants. Unit: `src/lib/team-content-reports.test.ts`.

## Not included (follow-ups)

- Report buttons and the author's "ask for review" action on the team post and comment screens, and a queue filter for the new subject types in the moderation tab. The client helpers (`submitReport` fields, `describeReportError`, `appealContentDecision`) and `ReportDialog` props are in place.
- Reporting of the attached image on its own (it is covered through the post).
- Scheduling the retention purge.
