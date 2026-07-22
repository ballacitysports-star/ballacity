## Goal

Surface posts created by teams (and clubs/gyms) on the main Feed page so players see announcements, tryouts, pickups, clinics, and recaps without visiting each team profile.

## Scope

- Feed only. Team profile post feed stays as-is.
- Read-only in this change; RSVP/Apply buttons on `PostCard` remain visual (they already are today).
- Backed by the existing `public.team_posts` table (public-read policy already in place). No schema changes.
- Orgs/gyms do not have their own posts table today. In-scope: posts authored under a team of `kind = 'coach'` (trainer/club team) will render alongside regular teams. Out-of-scope: a separate `org_posts` table for `trainer_orgs`.

## UX

New section on `/feed`, rendered above the main games list:

- Header: "From teams & clubs" with a count and a "See all" link (links to Teams tab for now).
- Horizontally scrollable row of `PostCard` items (reuse existing component) — up to 10 most recent, pinned first, then newest.
- Each card gets a small team chip on top ("<TeamName> · <sport>") that links to the team profile.
- Hidden when there are no posts. Skeleton shown during initial load.
- Respects the active Sport chip filter: when a sport is selected, only posts from teams matching that sport show.

## Technical

1. New server fn `listRecentTeamPosts` in `src/lib/team-posts.functions.ts`:
   - Public (no auth middleware), uses the existing `publicClient()` helper.
   - Input: `{ limit?: number (default 20), sport?: string }`.
   - Query: `team_posts` joined with `teams (id, name, sport, kind, avatar)`; order by `pinned desc, created_at desc`; when `sport` provided, filter by `teams.sport`.
   - Returns a plain DTO array: `{ id, teamId, teamName, teamSport, teamKind, teamAvatar, kind, title, body, eventDate, location, price, spotsMax, pinned, createdAt }`.

2. `src/routes/_tabs.feed.tsx`:
   - Add a `useQuery(['feed-team-posts', chipSelected])` that calls the new server fn via `useServerFn`, with `staleTime: 30_000`.
   - Map DTOs to the `OrgPost` shape `PostCard` expects (`postedAt = createdAt`, `date = eventDate ?? createdAt`, `spots` omitted when `spotsMax` is null since we don't track `taken`).
   - Render the new section between the FilterBar/search results and the games list, inside both the search view and the default view.
   - Wrap each `PostCard` in a `<Link to="/teams/$teamId">` header chip; card content itself stays non-interactive.

3. No migration, no RLS change (public read already allows anon).

## Out of scope

- Creating org/gym-level posts.
- Making PostCard's RSVP/Apply buttons functional.
- Realtime updates for the new section (30s stale time is enough for now).
