## Goal

Let any signed-in user (no trainer profile required) request to join an org from `/orgs/$orgId`, and let owners/admins approve or deny with an optional reason. Keep the existing trainer-based flow intact and unchanged.

## Database (new migration)

New table `public.org_member_requests` for generic user memberships:

- Columns: `id`, `org_id → trainer_orgs`, `user_id → auth.users`, `message text`, `status text ('pending'|'approved'|'denied'|'withdrawn')`, `denial_reason text`, `reviewed_by uuid`, `reviewed_at`, `created_at`, `updated_at`.
- Unique partial index on `(org_id, user_id) WHERE status = 'pending'` so a user has at most one open request per org.
- GRANTs to `authenticated` and `service_role`; RLS enabled.
- Policies:
  - Requester can `SELECT`/`INSERT`/`UPDATE (withdraw)` their own rows.
  - Org owners/admins (via existing `is_trainer_org_admin(org_id, auth.uid())`) can `SELECT`/`UPDATE` rows on their org.
- Triggers: `updated_at` bumper; validation trigger to force `status='pending'` on insert, cap `message` length, and only allow legal status transitions.

New table `public.org_members` (generic membership, separate from `trainer_org_members`):

- Columns: `id`, `org_id`, `user_id`, `role text default 'member'`, `created_at`; unique `(org_id, user_id)`.
- GRANTs + RLS: anyone can `SELECT` (public roster on org page); owners/admins can `INSERT`/`DELETE`; members can `DELETE` their own row (leave).

Security-definer RPCs (all `SET search_path=public`):

- `approve_org_member_request(_req uuid)` — checks caller is admin; inserts into `org_members`; sets request `status='approved'`.
- `deny_org_member_request(_req uuid, _reason text)` — checks caller is admin; sets `status='denied'`, `denial_reason`, `reviewed_at`, `reviewed_by`.

Notifications: on approve/deny insert into `public.notifications` for the requester (title, body with reason if denied, link `/orgs/<id>`).

## Server functions (`src/lib/trainer-orgs.functions.ts`)

Append (auth-required unless noted):

- `requestOrgMembership({ orgId, message? })` — inserts pending row.
- `withdrawOrgMemberRequest({ id })` — sets `status='withdrawn'`.
- `listMyOrgMemberRequest({ orgId })` — my current row for CTA state.
- `listOrgMemberRequests({ orgId })` — admin-only list of pending, joined with `profiles` for display name/avatar.
- `approveOrgMemberRequest({ id })` / `denyOrgMemberRequest({ id, reason })` — call the RPCs.
- `listOrgMembers({ orgId })` — public list joined with `profiles`.
- `removeOrgMember({ orgId, userId })` — admin removes; `leaveOrgMembership({ orgId })` — self-remove.

## UI on `/orgs/$orgId`

- **New Members section** below existing Trainers section: grid of avatars + names linking to profile; admin can remove.
- **MembershipCta additions** (works even when the user has no trainer profile):
  - Not signed in → existing sign-in link.
  - Not a trainer + not member + no pending → **"Request to join"** button opens a small dialog with optional message.
  - Pending → "Requested — awaiting review" chip with **Withdraw** button.
  - Denied → red chip with denial reason and **Request again** button.
  - Member → "Member" chip with **Leave** button.
  - Trainer-based join path stays as-is when the user owns a trainer profile.
- **Admin panel additions**: new "Pending member requests" list next to the existing trainer requests. Each row shows requester name/avatar, message, Approve (green check) and Deny (opens dialog for reason). Toasts on success; realtime `qc.invalidateQueries` for `org-member-requests` and `org-members`.

## Types & wiring

- After migration, regenerated Supabase types feed the new functions and hooks.
- Add queries `["org-members", orgId]`, `["org-member-requests", orgId]`, `["my-org-member-request", orgId]` and invalidate them together after each action.

## Out of scope

- No change to trainer join flow, invites, roles, or the edit page.
- No email delivery — only in-app notification rows.
