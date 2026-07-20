## Problem

On the team/trainer/gym profile page (`src/routes/teams.$teamId.index.tsx`), the "+ Post" button in the Posts tab is a static UI element with no `onClick` handler. There is also no backend for posts — `org.posts` comes from sample data only and is hardcoded to `[]` for real orgs in `src/lib/org-store.ts` (line 144). So creating a post does nothing and no posts ever appear.

## Plan

Add a working post system backed by the database.

### 1. Database (migration)
- New table `public.team_posts` with columns: `id uuid pk`, `team_id text fk → teams.id`, `author_id uuid fk → auth.users`, `kind text` (tryout | pickup | clinic | announcement | recap), `title text`, `body text`, `event_date timestamptz null`, `location text null`, `price int null`, `spots_max int null`, `spots_taken int default 0`, `pinned bool default false`, `created_at timestamptz default now()`.
- GRANT `SELECT` to `anon, authenticated`; `INSERT/UPDATE/DELETE` to `authenticated`; `ALL` to `service_role`.
- Enable RLS. Policies:
  - `SELECT`: public (anyone can read).
  - `INSERT/UPDATE/DELETE`: only the team's `owner_id` (checked via `EXISTS (SELECT 1 FROM teams WHERE id = team_id AND owner_id = auth.uid())`).

### 2. Server functions (`src/lib/team-posts.functions.ts`)
- `listTeamPosts({ teamId })` — public read, returns posts newest first (pinned first).
- `createTeamPost({ teamId, kind, title, body, eventDate?, location?, price?, spotsMax?, pinned? })` — auth-gated, verifies caller owns team via `context.supabase`.
- `deleteTeamPost({ id })` — auth-gated owner-only.

### 3. UI (`src/routes/teams.$teamId.index.tsx`)
- Replace `org.posts` in the Posts tab with a `useQuery(listTeamPosts)` result mapped into the existing `OrgPost` shape so `PostCard` still renders unchanged.
- Wire the "+ Post" button (owner-only) to open a new `CreatePostSheet` dialog with fields: kind (select), title, body, and — when kind is an event (tryout/pickup/clinic) — event date, location, price, spots. Submit calls `createTeamPost` and invalidates the query.
- Show a delete action on each post for the owner.
- Update the tab count (`Posts · N`) to use the fetched count.

### 4. Out of scope
- RSVP / Apply buttons on posts (existing static buttons stay static).
- Realtime subscription (query invalidation on mutate is enough for now).
- Editing existing posts (delete + repost only).

## Technical notes
- `team_posts.team_id` is `text` to match `teams.id`.
- Owner check reuses the pattern already used by `updateTeam` in `src/lib/teams.functions.ts`.
- New sheet component: `src/components/CreatePostSheet.tsx`.
