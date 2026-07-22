## Problem
In the Create screen "Host as" picker, a trainer profile (kind=`coach` in the `teams` table) is labeled "Club". That's wrong — `coach` means an individual trainer. Real clubs/gyms live in `trainer_orgs`, a different table entirely, and they aren't in the picker at all right now.

## Fix (in `src/routes/_tabs.create.tsx`)

1. **Relabel `kind === "coach"` as "Trainer"** everywhere in the Host as UI:
   - Multi-team pill list (currently shows "Club")
   - Single-team auto-selected chip (currently shows "Club / gym")
   - Screen-reader / uppercase kind badge

   Mapping used everywhere: `team → "Team"`, `coach → "Trainer"`.

2. **Add real clubs/gyms to the picker** by also listing the user's owned `trainer_orgs`:
   - Add `listMyOrgs` server function in `src/lib/trainer-orgs.functions.ts` that returns `{ id, name, handle, avatar }[]` where `owner_id = context.userId`.
   - In the Create route, fetch both `listMyTeams` and `listMyOrgs`, merge into a single list with a `source: "team" | "org"` tag plus the existing `kind`, so each pill knows whether it points at a team, a trainer profile, or a club/gym.
   - Label badge per entry:
     - `source === "org"` → "Club / gym"
     - `source === "team"` + `kind === "team"` → "Team"
     - `source === "team"` + `kind === "coach"` → "Trainer"

3. **Persist the choice correctly**
   - `hosted_games.team_id` today is a text column referencing `teams.id`. To keep this scoped, store the selection as-is when `source === "team"`, and add a sibling `org_id` field on the input for `source === "org"`.
   - New migration: `ALTER TABLE public.hosted_games ADD COLUMN org_id text REFERENCES public.trainer_orgs(id) ON DELETE SET NULL;` plus an index.
   - Extend `HostedGameInput` / `addHostedGame` / `rowToGame` in `src/lib/hosted-games-store.ts` with an optional `orgId` and pass it through the insert alongside `teamId` (only one of the two is set per game).

4. **Empty state CTAs** in the Create screen still say "Create a club / gym" but link to `/trainers/create` (the trainer wizard). Repoint that CTA to `/orgs/create` so it actually creates a club/gym.

## Zero-affiliation gate
Unchanged: users with no teams AND no owned orgs still see the empty state. Users with any combination totalling ≥1 continue as before (auto-select if only one across both lists; picker if more).

## Out of scope
- Rendering the affiliation chip on game cards / detail pages (follow-up).
- Team-member (non-owner) hosting permissions.
- Backfilling `org_id` on existing games.