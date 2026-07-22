## Goal

Require every host to be affiliated with at least one team/club before they can create a game. When the host owns multiple teams/clubs, let them pick which one to host under from the Create screen.

## Behavior

1. **Gate the Create screen** (`src/routes/_tabs.create.tsx`)
   - Fetch the current user's owned teams/clubs (from `public.teams` where `owner_id = user.id`) via a new `listMyTeams` server function.
   - If the user has **zero** teams/clubs, replace the form with an empty state:
     - Title: "Create a team or club first"
     - Body: short explanation ("Games are hosted under a team or club so players know who they're joining.")
     - Two CTAs: "Create a team" → `/teams/create`, "Create a club/gym" → `/orgs/create` (or `teams.create` with `kind=coach`, matching the existing wizard).
   - If the user has **one** team/club, auto-select it (show a small read-only chip: "Hosting as: {name}") and let them submit normally.
   - If the user has **multiple**, add a required "Host as" selector at the top of the form (below the header) rendered as a horizontal pill list of their teams/clubs (avatar + name + kind badge). Selection persists in local component state; submit is blocked with a toast until one is chosen.

2. **Attach the chosen team to the game**
   - Extend `addHostedGame` (in `src/lib/hosted-games-store.ts`) to accept an optional `teamId` and persist it on the game (`hosted_games.team_id`, new nullable column). Include it in the row insert and in the in-memory snapshot returned to the UI.
   - The multi-day repeat path passes the same `teamId` to every created game.

3. **Show affiliation on the game**
   - No new UI in this change beyond persisting `team_id`. A follow-up can render the team chip on the game detail card.

## Technical details

- **Data**
  - Add migration: `ALTER TABLE public.hosted_games ADD COLUMN team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;` plus an index on `team_id`. No RLS change needed (existing host-scoped policies still apply).
- **Server functions** (`src/lib/teams.functions.ts`)
  - Add `listMyTeams` (`requireSupabaseAuth`) returning `{ id, name, kind, avatar, handle }[]` for `owner_id = context.userId`, ordered by `created_at desc`.
- **Client**
  - In `_tabs.create.tsx`, call `listMyTeams` with `useQuery` after the existing sign-in guard. While loading, show a small skeleton. Based on count, render the three states above.
  - Add a `selectedTeamId` state; auto-set when count === 1.
  - Pass `teamId: selectedTeamId ?? undefined` into `addHostedGame` and the multi-day loop.
- **Types**
  - Extend the `addHostedGame` input type with `teamId?: string`.
  - `HostedGame` snapshot gains an optional `teamId` field.

## Out of scope

- Rendering the team chip on game cards / detail pages (follow-up).
- Migrating existing games without `team_id`.
- Team-member (non-owner) hosting permissions — for now only the team's `owner_id` can host under it. Can be expanded later using `trainer_org_members` / a future `team_members` table.
