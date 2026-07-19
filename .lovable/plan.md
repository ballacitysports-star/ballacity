## Goal

Ship a full standalone Gym/Org system on top of the existing `trainer_orgs` / `trainer_org_members` / `trainer_org_invites` / `trainer_org_join_requests` tables and `trainer-orgs.functions.ts`. Today an org can only be spawned as a side-effect of the trainer wizard; the public profile at `/orgs/$orgId` works but has no way to create, edit, or manage members.

## Current state (verified)

- Tables + RPCs exist: `create_trainer_org_with_owner`, `approve_trainer_org_join`, `accept_trainer_org_invite`, `is_trainer_org_admin`.
- Server fns exist: create, list, get, join/invite/leave, review requests.
- `/orgs/$orgId` renders profile + roster + membership CTA + join-request review.
- `CreateOrgWizard` currently only wired to `/teams/create` (kind="team"). No `/orgs/create`, no `/orgs` index, no `/orgs/$orgId/edit`, no member admin UI, no `updateTrainerOrg` / `removeMember` / `changeMemberRole` server fns.
- Trainers tab already has a "Gyms" segment (`_tabs.trainers.tsx` mode=gyms) — reuse that as the org index and link cards to `/orgs/$id`.

## Deliverables

### 1. Migration: RLS + role-change RPCs

New migration adds what's missing so admins can manage the org:

- `UPDATE`/`DELETE` policy on `public.trainer_orgs` gated by `public.is_trainer_org_admin(id, auth.uid())` (owner-only DELETE).
- `UPDATE` policy on `public.trainer_org_members` (owner/admin can change `role`) and `DELETE` (owner/admin can remove others; a member can remove themselves — already covered by leaveTrainerOrg).
- SECURITY DEFINER RPC `public.set_trainer_org_member_role(_org uuid, _trainer_id text, _role text)` — owner-only, forbids demoting the last owner.
- SECURITY DEFINER RPC `public.remove_trainer_org_member(_org uuid, _trainer_id text)` — admin can remove non-owner; owner can remove anyone except the last owner.
- Storage: existing `org-avatars` / `org-covers` policies already work via `is_trainer_org_admin` — no change needed. (User-scoped fallback added in previous migration also applies during create.)

### 2. Server functions (append to `src/lib/trainer-orgs.functions.ts`)

- `updateTrainerOrg({ id, name?, handle?, bio?, city?, website?, avatar?, cover?, address?, placeId?, geo? })` — admin-gated via RLS, direct `UPDATE public.trainer_orgs`. Validate handle regex.
- `setOrgMemberRole({ orgId, trainerId, role: "owner"|"admin"|"member" })` → RPC.
- `removeOrgMember({ orgId, trainerId })` → RPC.
- `listOrgAdmins({ orgId })` — for the manage view.

### 3. New / updated routes

- `src/routes/orgs.index.tsx` → grid of all orgs (uses `listTrainerOrgs` with search), links to `/orgs/$orgId`. Also add a "Create gym" CTA.
- `src/routes/orgs.create.tsx` → dedicated wizard (`OrgCreateWizard`) — mirrors the identity/branding/location steps of `CreateOrgWizard` but scoped to trainer_orgs schema (no formats/positions/skill). Fields: name, handle (validated + availability check), city, address+placeId+geo via `LocationAutocomplete`, bio, website, avatar/cover via `ImageUploader` (buckets `org-avatars` / `org-covers`, `pathPrefix={user.id}`). On save calls a new `createStandaloneOrg` (variant of `createTrainerOrg` without a `trainerId` — creates org row + inserts owner into `trainer_org_members` only when they have a trainer profile; otherwise creates just the org with `owner_id` set and no seed member). Redirects to `/orgs/$id`.
- `src/routes/orgs.$orgId.edit.tsx` → admin-gated (throws `notFound()` if `!is_trainer_org_admin`). Same wizard component in edit mode: identity + branding + location, plus **Members** panel:
  - Table of members with role dropdown (owner-only), remove button.
  - "Invite trainer" — search by handle (reuse existing `inviteTrainerToOrg`).
  - Pending join requests (already exists) surfaced here too.
  - "Delete organization" (owner only, confirm dialog).
- `src/routes/orgs.$orgId.tsx` → add an "Edit" button in the header for admins that links to `/orgs/$orgId/edit`, and surface admin/owner badges next to each member.
- `_tabs.trainers.tsx` (Gyms mode) → make each gym card link to `/orgs/$id` instead of the trainer profile.

### 4. Small server-fn split

Split `createTrainerOrg` into two variants that share the same validator:
- `createTrainerOrgForTrainer` (existing behavior — used by trainer wizard, requires `trainerId`).
- `createStandaloneOrg` (new — used by `/orgs/create`, no `trainerId`, inserts org + owner-role member only if caller has any trainer profile).

Keep existing name as alias to avoid breaking `CreateOrgWizard` and `CreateTrainerWizard`.

## Out of scope

- Payments/subscriptions per org.
- Multi-owner audit log.
- Redesigning the trainer wizard's inline gym-create flow (already works).

## Verification

1. Signed in with no trainer profile → `/orgs/create` succeeds, redirects to org page, I'm shown as Owner in the header.
2. Sign in as a trainer → request to join, sign in as owner → approve → member appears in roster.
3. Owner opens `/orgs/$id/edit` → change bio, upload new cover, promote a member to admin, remove another member — all persist; UI updates via query invalidation.
4. Non-admin visiting `/orgs/$id/edit` → not-found screen.
5. `/orgs` lists orgs, search filters by name, "Create gym" CTA visible.
6. Gyms tab on Trainers page now navigates to `/orgs/$id`.