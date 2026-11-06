# P2-1 design proposal: one `events` model for tryouts, clinics, camps and tournaments

Status: **approved by the owner on 2026-11-06** (decisions recorded at the end). Stage 1 (additive
tables, no reads yet) is being built and applied to the E2E sandbox only; nothing is applied to
production.
P2-1 in `docs/phase0-audit-and-implementation-plan.md` is rated high risk because it moves existing data.

## Why

There are three event shapes today, and none of them knows when an event ends or whether it is for
minors:

| Shape                    | Where                                                                                                | Problem                                                                                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team tryouts and clinics | `team_posts` with `kind in ('tryout','clinic')`                                                      | A post row carries event fields: `event_date` (may be NULL), `location`, lat/lng, `price`, `spots_max`/`spots_taken`, cancel and refund rules. No end time and no age range. |
| Facility events          | `hosted_games` rows with `org_id`; the kind is guessed from the title (`facility-events.ts` regexes) | "Clinic" and "tournament" are guessed from the title text, and there is no capacity separate from the game roster.                                                           |
| Trainer sessions         | `trainer_session_requests`                                                                           | Requests only: no bookings, no venue, no price.                                                                                                                              |

Sign-up (`tryout_rsvps`), waivers (`team_waivers`, team-level) and availability
(`team_event_availability`) work well, but they are keyed to `team_posts.id`.

## Safety finding to settle first (applies today, before P2-1)

Anonymous visitors can read a tryout's or clinic's **exact coordinates and street address**, for any
team, including youth teams. This was reproduced against main's schema on 2026-11-06:

- `GRANT SELECT ON public.team_posts TO anon`;
- `team_posts_public_read` allows any approved, unhidden post;
- no column is withheld.

Hosted games handle this differently: anonymous visitors only see adult-only games
(`20261029150000_hosted_games_anon_minors_guard.sql`).

Decision **D0** (below) is whether youth tryout venues stay public. The events design follows that
answer either way.

## Proposed model

```
events
  id uuid pk
  host_kind   text  check in ('team','facility','trainer')
  host_ref    text  -- teams.id, trainer_orgs.id or the trainer's teams.id (all text today)
  kind        text  check in ('tryout','clinic','camp','tournament')
  title, body, image_url
  starts_at timestamptz null      -- null = "date TBA", as today
  ends_at   timestamptz null
  min_age int null, max_age int null   -- drives youth rules, like hosted_games
  venue_label text                 -- coarse, public ("Riverside Park")
  price_cents int null, currency text default 'usd'
  capacity int null
  cancel_cutoff_min, refund_rule, late_refund_pct   -- carried over unchanged
  share_scores, share_notes                          -- tryout settings, carried over
  pinned, author_id, created_at, updated_at
  moderation_status, hidden_at, owner_hidden_at, moderator_hidden_at  -- same meanings as team_posts
  legacy_post_id uuid unique null  -- the team_posts row it came from

event_locations (private)
  event_id pk -> events, place_id, formatted_address, lat, lng

event_registrations   -- generalises tryout_rsvps (same columns plus event_id)
event_availability    -- generalises team_event_availability
```

### Rules

- **Read.** The same public read as `team_posts` today: approved, unhidden, and the host not hidden.
  Anonymous visitors also need the event to be adult-only (`min_age >= 18`), mirroring hosted
  games, unless D0 says otherwise.
- **Exact location** (`event_locations`). Readable by:
  - host staff (owner, manager, coach);
  - registrants;
  - guardians of registrants;
  - everyone, for adult-only events.

  Everyone else sees `venue_label` only.

- **Writes.** Host staff only, through RPCs that keep today's checks: kind,
  moderation, and `announcement` staying a `team_posts` thing.
- **Registration.** `register_for_event` carries over `rsvp_tryout`:
  - the guardian-on-behalf rule;
  - the waiver gate (team waiver, or a facility waiver later);
  - the capacity check.

  Capacity is counted from registrations, not from a separately maintained counter.

- **Minors.** The same caps as reels and posts apply to anything a minor can see or write. No
  minor-hosted events.

### Migration plan, staged so each step can be rolled back

1. **Additive.** Create the tables, RLS, RPCs and SQL tests. Nothing reads them yet. Guarded
   rollback: drop the new objects.
2. **Backfill and mirror.**
   - Copy `team_posts` tryout and clinic rows into `events` (`legacy_post_id` set) and their RSVPs,
     evaluations and availability into the new tables. Recount capacity from registrations.
   - Keep the copy in step: triggers mirror new writes from the old RPCs into the new tables until
     step 4.
   - Verify with counts per team and per post, through a SQL check script like the P0-1 runbook's.
3. **Switch reads.** Point the app at `events` behind `app_settings.events_v2`, which is off by
   default:
   - `/tryouts/$postId` keeps working: it resolves `legacy_post_id`.
   - `TeamEventsCalendar` reads from `events`.
4. **Switch writes.** The create, edit and register flows call the new RPCs, and the mirror reverses
   direction for one release so a flag rollback loses nothing.
5. **Facility events.** New facility clinics and tournaments become `events` rows. Existing
   `hosted_games` stay games: a pickup run is a game, not an event.
6. **Cleanup** (a separate, later PR). Drop the mirror. Then decide whether `team_posts` keeps
   tryout and clinic rows as read-only history or gets a view.

### Tests (per stage)

- SQL:
  - port the guardian and anonymous-visitor tests in the style of `150` and `160`;
  - a stranger cannot read the exact location of a youth event;
  - a guardian can register a child and read the venue;
  - capacity holds under concurrent registration (a race test);
  - backfill counts match exactly.
- Unit and E2E: the tryout sign-up and check-in flows on the sandbox, through the flag, once the E2E
  baseline (#298) is green.

## Owner decisions (recorded 2026-11-06)

- **D0. Youth venue privacy: hide, and stricter than proposed.** A team's tryout or clinic venue is
  hidden from everyone except host staff, registrants and their guardians until the team is known to
  be adult-only (#330). For events this becomes: the exact location is public only when the event is
  adult-only (`min_age >= 18`); every other event shows `venue_label` only to the public.
- **D1. Age range is required.** Every event is created with `min_age` and `max_age`. Youth status
  is explicit, never inferred from the roster. (Backfilled rows from `team_posts` get the range from
  the team, and are treated as youth when the team is not known to be adult-only, so stage 2 cannot
  make a venue public that is private today.)
- **D2. Waivers stay per team.** Facility waivers come later, as their own item.
- **D3. Trainer sessions are out of scope** for P2-1. They remain booking requests.
- **D4. The staged plan is approved.** Each stage is its own PR with a SQL test, a negative control
  and a guarded rollback. Migrations go to the E2E sandbox only; production waits for the owner.
