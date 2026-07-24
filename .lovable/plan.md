
# Account Type at Signup + Identity Separation

## Goal

Every login is exactly one of four types — **Player**, **Team**, **Trainer**, **Gym** — chosen at signup and permanent. Team/Trainer/Gym accounts become independent logins with their own email. A Player account can no longer own teams/trainers/gyms.

## 1. Database

Add `account_type` to `profiles`:

- `account_type text not null default 'player'` with CHECK in (`player`,`team`,`trainer`,`gym`)
- Nullable-then-backfill migration: add column nullable, backfill existing rows, then set NOT NULL.

**Backfill rule (force migration for existing users):**
- If user owns a row in `trainer_orgs` (kind gym) → `gym`
- Else if owns a `teams` row where kind=`coach` → `trainer`
- Else if owns a `teams` row (team kind) → `team`
- Else → `player`

Update `handle_new_user()` trigger to read `raw_user_meta_data->>'account_type'` (default `player`) and write it to `profiles.account_type`.

Add a `has_account_type(_user_id uuid, _type text)` SECURITY DEFINER helper for policies/UI checks.

**Ownership gates** (enforce "one type per account"):
- Trigger on `teams` INSERT: if `kind='coach'` requires owner `account_type='trainer'`; else requires `account_type='team'`.
- Trigger on `trainer_orgs` INSERT: requires owner `account_type='gym'`.
- Player account cannot own any of the above.

## 2. Signup flow (step 1 before email/password)

New route `/auth/type` (or inline step in `/auth`):

```text
┌──────────────────────────────┐
│   How will you use OpenRun?  │
│                              │
│  [🏃 Player]  [👥 Team]      │
│  [🎯 Trainer] [🏢 Gym]       │
└──────────────────────────────┘
       ↓ pick one
   Email / Password / Google  (type stored in signup state)
```

- Type persisted in component state + `sessionStorage` (survives Google OAuth round-trip).
- `signUp()` passes `options.data.account_type` so the trigger writes it.
- Google OAuth: after callback, if the user is brand new AND `sessionStorage` has a pending type, patch `profiles.account_type` once. If new Google user with no pending type → route to `/auth/type-required` migration modal.
- Sign-in flow unchanged (type already set).

## 3. Existing users — forced migration modal

On first authenticated app load, if `profiles.account_type` is null OR the user still owns entities that conflict with their type:

- Blocking full-screen modal (route `/onboarding/account-type`) forcing pick.
- If they pick a non-player type and already own the matching entity, we set the type and continue.
- If they pick `player` but own teams/trainers/gyms, show a "Move these to a separate account" screen listing owned entities with two options per entity:
  - **Transfer ownership** to another email (creates pending transfer; recipient claims via emailed link, out of scope for this pass — stub UI only).
  - **Keep as separate account**: sign out prompt to register a new dedicated login.
- Until resolved, app is gated. `AuthGate` in `__root.tsx` routes to `/onboarding/account-type`.

## 4. Type-scoped UI

- **Player accounts**: hide "My organizations", "My teams (owned)", trainer/org creation entry points from settings and profile. They can still join teams/orgs as members, RSVP games, review, follow, etc.
- **Team accounts**: Profile becomes the team profile surface. Bottom-nav Create page defaults to "Post to my team" / host a game as this team. No trainer/gym creation.
- **Trainer accounts**: Profile = trainer profile. Can create/edit their trainer profile + availability. No team ownership.
- **Gym accounts**: Profile = gym/org profile. Can invite trainers, manage members. No personal team ownership.

`useAccountType()` hook reads from `profiles` cache; wrap gated routes/components with a small `<RequireType types={['team','gym']}>` helper that redirects or hides.

## 5. Sign-out from linked ownership (disconnect existing links)

One-time migration action for existing multi-role users:
- For every existing owner whose backfilled type doesn't match all their owned entities, mark the extras as "orphan" (still in DB, hidden from that account's profile) and surface them in the migration modal for transfer/abandon.

## 6. Route changes

- New: `src/routes/auth.type.tsx` (or step in `auth.tsx`).
- New: `src/routes/onboarding.account-type.tsx` (migration gate).
- Update: `src/routes/auth.tsx` — inject type step before form, read `account_type` from state on submit.
- Update: `src/routes/__root.tsx` `AuthGate` — after session hydrates, check `profiles.account_type` and redirect to onboarding if missing/conflicting.
- Update: `src/routes/_tabs.profile.tsx`, `_tabs.create.tsx`, `settings.tsx` — hide/show sections per type.
- Update: `src/hooks/use-auth.ts` — expose `accountType` alongside `user`.

## 7. Out of scope (call out to user)

- Actual cross-account ownership transfer via email invite (stub only).
- Migrating historic game hosting rows retroactively — hosted_games keeps its host_id; type gate only affects new creations.

## Technical notes

- Enum vs text: use text + CHECK to avoid enum migration friction; can promote to enum later.
- `sessionStorage` key: `openrun.pending_account_type` cleared after successful profile write.
- All new policies scope reads to `authenticated`; `account_type` is publicly visible on profiles (needed to render badges).
- Realtime: subscribe to own `profiles` row so type flips (from migration modal) unlock UI without reload.
