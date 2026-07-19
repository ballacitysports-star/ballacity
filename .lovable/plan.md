
## Goal
Let trainers create and belong to shared organizations. Owners invite/approve members with roles (owner/admin/member). Show org on trainer profile headers, list members on the org page, and filter the trainers feed by org.

## Data model (new migration)

- `public.trainer_orgs`
  - `id uuid pk`, `owner_id uuid → auth.users`, `name text`, `handle text unique`, `bio text`, `avatar text`, `city text`, `website text`, `verified bool`, `created_at`, `updated_at`
- `public.trainer_org_roles` enum: `owner | admin | member`
- `public.trainer_org_members`
  - `id uuid pk`, `org_id`, `trainer_id uuid → teams.id` (the trainer profile), `user_id uuid → auth.users` (owner of that trainer profile), `role trainer_org_roles`, `joined_at`
  - unique `(org_id, trainer_id)`
- `public.trainer_org_invites`
  - `id uuid`, `org_id`, `invited_user_id` (nullable), `invited_trainer_id` (nullable), `invited_by`, `status` (`pending|accepted|declined|revoked`), `role`, `created_at`
- `public.trainer_org_join_requests` (trainer-initiated)
  - `id uuid`, `org_id`, `trainer_id`, `requested_by`, `status`, `created_at`, `reviewed_at`, `reviewer_notes`

All tables: GRANT to authenticated + service_role, ENABLE RLS.
Security-definer helper `is_org_role(_org uuid, _user uuid, _min_role trainer_org_roles)` used in policies to avoid recursion.

### Policies (summary)
- `trainer_orgs`: anyone signed-in can SELECT; INSERT by any authenticated (owner_id = auth.uid()); UPDATE/DELETE by owner or admin.
- `trainer_org_members`: SELECT open to authenticated; INSERT only via SECURITY DEFINER fn triggered by invite acceptance or owner add; DELETE by self, owner, or admin.
- `trainer_org_invites`: SELECT if inviter, org admin/owner, or invited user; INSERT by owner/admin; UPDATE (accept/decline) by invited user; revoke by owner/admin.
- `trainer_org_join_requests`: SELECT if requester or org admin/owner; INSERT by trainer owner; UPDATE (approve/reject) by org owner/admin.

### RPCs (SECURITY DEFINER)
- `accept_trainer_org_invite(_invite uuid)` — inserts row into members, marks invite accepted.
- `approve_trainer_org_join(_req uuid)` — inserts member row, marks request approved.
- `set_trainer_org_role(_org, _trainer, _role)` — owner/admin only.

## Server functions (`src/lib/trainer-orgs.functions.ts`)
- `listTrainerOrgs({ search? })` — public list, sortable by member count.
- `getTrainerOrg({ id })` with members joined to `teams` for display.
- `createTrainerOrg`, `updateTrainerOrg`, `deleteTrainerOrg` (auth-gated).
- `inviteTrainer({ orgId, trainerId | userId, role })`.
- `respondToInvite({ inviteId, action })`.
- `requestToJoinOrg({ orgId, trainerId })`.
- `reviewJoinRequest({ id, action, notes })`.
- `leaveOrg({ orgId, trainerId })`.

## UI

### Trainer create wizard (`src/routes/trainers.create.tsx` → `CreateOrgWizard`)
Add a step "Organization (optional)":
- Search existing orgs by name/handle → send join request.
- OR "Create new organization" inline (name, handle, city, avatar). Creator becomes owner; the new trainer profile is auto-added as owner-member on create.
- OR "Skip / I'm independent".

### Trainer profile header (`src/routes/trainers.$trainerId.tsx`)
- Show "at [Org name] ✓" chip linking to `/orgs/$orgId` when member exists.
- If viewer is org owner/admin, show "Manage" quick link.

### Trainer profile edit
- New "Organization" section: current org + leave button, or search/join, or create.
- Pending invites list with accept/decline.
- Pending join requests status.

### New route `src/routes/orgs.$orgId.tsx`
- Header (avatar, name, city, verified, member count, follow later).
- Tabs: Members (list of linked trainer cards via `OrgCard`), About, Manage (owner/admin only: invites, requests, roles).

### Directory route `src/routes/_tabs.trainers.tsx`
- Add `orgId` filter chip (searchable dropdown of orgs) persisted in URL. Filter uses server-side join or client-side after fetching org membership map.

### Notifications
- `trainer_org_invite`, `trainer_org_join_request`, `trainer_org_join_approved`, `trainer_org_role_changed`.

## Realtime
Subscribe to `trainer_org_members` and `trainer_org_invites` in profile/org pages to reflect approvals live.

## Out of scope
- Org-level billing, org-owned games, transfer of ownership UI (owner can delete or set new owner via SQL later), public follow of orgs.

## Technical notes
- Roles table pattern: use `trainer_org_members.role` (org-scoped), not the global `user_roles` table.
- Trainer identity = `teams` row where `kind='coach'`; a `user_id` may own multiple trainer profiles → membership is per trainer profile, not per user.
- Handle validation reuses lowercased slug pattern already used for teams.
