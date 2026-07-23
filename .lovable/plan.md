## Goal
Add a dedicated `/orgs/$orgId/members` page where owners/admins can view members, change roles, remove them, approve/deny pending join requests, and directly invite (add) other users.

## Route
New file `src/routes/orgs.$orgId.members.tsx` (`ssr: false`), gated to org owners/admins via `is_trainer_org_admin` check (client-side redirect for non-admins, RLS enforces on server). Add a "Manage members" link from `src/routes/orgs.$orgId.tsx` (visible to admins) and from `src/routes/orgs.$orgId.edit.tsx`.

## UI (three sections, single scroll)
1. **Members** — reuses the existing `listOrgMembers` query. Each row: avatar + display name + role chip; role select (`member` / `admin`); "Remove" button. Owners can’t be demoted or removed here (owner is the trainer‑org owner). Uses `setGenericOrgMemberRole` and `removeGenericOrgMember`.
2. **Pending join requests** — reuses `listOrgMemberRequests`, `approveOrgMemberRequest`, `denyOrgMemberRequest` (with a small "reason" input on deny). Approve/deny buttons per row.
3. **Invite people** — search input that queries profiles by `display_name ilike`. Results show avatar + name + "Add" button. Choosing "Add" calls a new `addOrgMemberDirect` server fn that inserts into `public.org_members` (role `member` by default; toggleable to `admin`). Users already in the org are shown greyed out with "Already a member".

## Server changes (`src/lib/trainer-orgs.functions.ts`)
- New `searchProfilesForInvite({ orgId, q })` — auth + admin‑gated (checks `is_trainer_org_admin`), returns up to 20 profiles matching `display_name ilike %q%`, excluding existing members and the caller.
- New `addOrgMemberDirect({ orgId, userId, role })` — auth + admin‑gated. Inserts into `public.org_members` (RLS already permits admins). Also inserts a `notifications` row (`type: 'org_membership'`, link `/orgs/<id>`) so the added user is notified. Idempotent via unique `(org_id, user_id)`.

No schema changes required — existing RLS on `org_members`, `org_member_requests`, and existing `is_trainer_org_admin` cover this.

## Query wiring
Query keys: `["org-members", orgId]`, `["org-member-requests", orgId]`, `["org-invite-search", orgId, q]` (debounced 250ms, disabled when q < 2). Mutations invalidate the two list keys and clear the search result cache.

## Out of scope
No changes to trainer‑org (`trainer_org_members`) invite/join flow, notifications preferences, or the org detail page beyond adding the "Manage members" link.