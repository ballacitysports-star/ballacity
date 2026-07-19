## Goal
Gate the admin-only areas on `/orgs/:orgId` correctly and give unauthorized visitors a clear, correct CTA (view-only, sign-in, request to join, pending, or member/owner status).

## Current state
- `src/routes/orgs.$orgId.tsx` already hides the "Pending join requests" panel behind an `isAdmin` check (owner or member with role `owner`/`admin`), and RLS on `trainer_org_join_requests` enforces the same server-side.
- However the page shows **no CTA for anyone else** — a signed-in trainer cannot request to join, a member sees no indication they're in, and signed-out users get no prompt. Join/leave UI only lives on the trainer's own profile via `TrainerOrgSection`.

## Changes (UI only, `src/routes/orgs.$orgId.tsx`)

Add a `MembershipCta` block in the header, rendered based on the viewer's state:

1. **Signed out** → "Sign in to join" button linking to `/auth?redirect=/orgs/<id>`.
2. **Signed in, no trainer profile** → muted note: "Create a trainer profile to join this organization" with link to `/trainers/create`.
3. **Signed in, owns trainer profile(s)** — fetch via `listMyTrainerOrgMemberships({})` and `listInvitesForTrainer` per owned trainer, plus their own trainer profiles from existing teams store/query:
   - Already a **member of this org** → badge "Member · <role>" + Leave button (hidden for owner).
   - Has a **pending invite** to this org → Accept / Decline buttons (reuse `respondToTrainerOrgInvite`).
   - Has a **pending join request** to this org → disabled "Requested" pill (query `trainer_org_join_requests` filtered to `requested_by = me` + this org via a small new public server fn `getMyJoinRequestForOrg`).
   - Otherwise → "Request to join" button opening a small trainer-picker (if the user owns >1 trainer profile) then calling `requestToJoinTrainerOrg`.
4. **Owner/admin** → keep the existing pending-requests panel; also show a compact "You manage this org" badge in the header so the role is obvious.

Membership/approval-only elements (`Pending join requests` section, approve/reject buttons, manage badge) remain gated by the existing `isAdmin` boolean, which is derived from server-provided membership rows — no client-only trust.

## Server additions
- New `getMyJoinRequestForOrg({ orgId })` in `src/lib/trainer-orgs.functions.ts` (auth-required) returning `{ status, trainer_id } | null` for the caller's own pending request. RLS already restricts rows to requester/admins, so no policy changes needed.
- New helper to list the caller's owned trainer profiles: reuse existing `listMyTrainers` if present; otherwise add a thin `listMyTrainerProfiles` fn selecting `id,name` from `teams` where `owner_id = auth.uid()` and `kind = 'coach'`.

## Verification
- Verify RLS on `trainer_org_join_requests` and `trainer_org_members` already restricts SELECT to org admins/requesters before shipping (query with `supabase--read_query`); the UI gating mirrors that so a hostile client cannot see admin data even if they force-render the panel.
- Manual: signed-out, non-trainer, non-member trainer, requester, invitee, member, admin, owner — each should see exactly one appropriate CTA/state and no admin controls unless admin/owner.

## Out of scope
No schema changes, no changes to `TrainerOrgSection` on the trainer profile.
