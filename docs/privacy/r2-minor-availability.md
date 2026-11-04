# R2: availability posts by minors

Status: **implemented locally, open in a pull request. Not merged, not applied to production, not verified in production.**

## Audit: every path by which a player-availability post reaches another account

| Path                                                                             | Before                                                                                               | After (migration `20261106100000`)                                                                                                                                  |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct table read through the API (`player_availabilities`)                      | every open post readable by every signed-in account, minors included                                 | adult authors: unchanged. Non-adult or unknown-age authors: author, verified guardian, and anyone `can_see_minor_name` allows                                       |
| Listing screen / search (`getOpenAvailabilities`)                                | same table                                                                                           | same table, so it follows the policy; no client change needed                                                                                                       |
| Player page (`players.$userId`)                                                  | same table                                                                                           | same                                                                                                                                                                |
| Realtime (`player_availabilities` is in the publication)                         | row delivered to any subscriber                                                                      | Realtime evaluates the same SELECT policy per subscriber; the test asserts there is exactly one read policy                                                         |
| Stored precise location (`lat`, `lng`, `formatted_address`, `place_id`)          | exact when the author chose "precise"                                                                | a non-adult author's row never holds them (trigger, whatever the privacy setting or client sends)                                                                   |
| Free-text `note`                                                                 | any text                                                                                             | a non-adult author's note naming an address, map link or coordinates is refused (heuristic detector; see G6 for its limits)                                         |
| Contact request or game invitation from a post (`availability_contact_requests`) | only user blocks and the recipient's privacy setting; the minor-messaging rules were **not** applied | requests to a non-adult need the sender to be a guardian or `can_see_minor_name`; guardian controls and the under-16 shared-context rule now also apply to requests |
| Notifications / invitations                                                      | built from the request                                                                               | a request that cannot be created produces no notification; invitation location is already coarse (PRIV-2D)                                                          |
| `profile_ages`, player stats, trait counts                                       | already restricted for non-adults (profile visibility, cohort checks)                                | unchanged                                                                                                                                                           |
| Cached data                                                                      | availability is fetched fresh; no persistent cache                                                   | the client-storage manifest scan (G5) fails if a new cache key is not registered                                                                                    |

Preserved: the author's own posts (open and closed), a verified guardian's view of a child's posts, team managers and teammates, hosts and organization administrators dealing with the minor, moderators and administrators, and every adult-to-adult flow.

## Behaviour change to expect

A teen or child's open post is no longer discoverable by unrelated adults or other minors. Adults who want to find a teen go through a team, an organization or a game (the relationships that already reveal a minor's name). This is intended: it removes "find a minor by sport, schedule and area" from the product.

## Tests

`supabase/tests/420_minor_availability_privacy.test.sql` (55 assertions): anonymous; adult stranger; teen stranger; another minor; unknown age; the author; guardian; teammate; manager; accepted follower; moderator; administrator; closed posts; one read policy; grants; write-side stripping and note refusal for a teen; adult unaffected; contact requests from a stranger, a minor, a teammate (with and without the guardian's teammates setting), a guardian, and adult to adult. Run against the schema without the migration it fails (12 failures before the run aborts), so the assertions are not vacuous.

## Rollout, compatibility, recovery

- Additive plus one policy swap; no data is rewritten. Apply after the PRIV-2B/2D migrations (needs `can_see_minor_name` and the detector).
- New app, old database: nothing breaks. Old app, new database: fewer posts, and a contact request to an unrelated minor fails with the generic "safety settings" message.
- Recovery is forward only. Relaxing the policy needs a new owner-approved migration.

## Verification after a production apply (read-only, aggregates)

```sql
-- posts by non-adults that still hold coordinates or a street address (to be blanked in a separately approved step)
select count(*) filter (where lat is not null or formatted_address is not null or place_id is not null) as with_precise,
       count(*) as total
  from public.player_availabilities a
 where coalesce(public.age_cohort_of(a.user_id), 'unknown') <> 'adult';
-- the read policy
select polname from pg_policy where polrelid = 'public.player_availabilities'::regclass and polcmd in ('r', '*');
```

## Residual

Old rows by minors keep their stored coordinates until a separately approved blanking step; they are unreadable to unrelated accounts but remain in backups. A minor can still contact an adult through the adult's own post (for 16 and 17, unless a guardian restricts it). See the R7 audit.

## Legacy data procedure (defined, not run)

`private_sec.blank_minor_availability_location(limit)` (service role only) removes the stored coordinates, street address and place id from posts of non-adult or unknown-age authors in batches and returns the rows changed, until it returns 0. It keeps the city, copies nothing anywhere, writes an audit row with counts only, and is idempotent. A precise value can never return to such a row (the write trigger drops it), and the trigger checks the note only when the note changes, so an old note naming a place never blocks the blanking or an unrelated edit. Moderators get `list_minor_availability_notes_with_location_text()` (post ids and a reason, never the text) and `moderator_scrub_availability_note(post, reason)` (removes the note, audited, no copy). Run order, preconditions and verification are in `docs/release/legacy-data-procedures.md`. Production counts (read-only) are taken with the query in the verification section above before any run.
