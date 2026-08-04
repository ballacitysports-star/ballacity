# Request to join by default, with host approve / decline

Today a game only becomes "request to join" if the host turned on approval; otherwise the sticky button reads "Join free · N spots left" and the player joins instantly. Games with no host settings saved (like the sample games you're viewing) fall back to instant join.

## What changes

1. **Approval is on by default**
   - New games are created with approval required (the Create screen toggle starts on).
   - A game with no host settings saved yet is treated as approval-required, so the button reads "Request to join" instead of "Join free".
   - Hosts can still switch it off in game settings for instant joining — the toggle stays.

2. **Player-side button**
   - Approval-gated games show: `Request to join · N spots left` → after tapping, `Request pending · Tap to cancel` → then `Approved` / paid flow, or a declined state with the existing resubmit rules.
   - Paid games keep the current order: approval first, payment unlocked only after approval.

3. **Host review on the game page**
   - New "Join requests" panel visible only to the host on `/games/:gameId`, above the roster.
   - Three grouped states: **Pending** (Approve / Decline buttons per player), **Approved**, **Declined**, each with player name, avatar, and their message.
   - Optimistic update on tap with rollback + toast on failure, and it refreshes live over realtime, matching the existing profile list.
   - The existing "Pending approvals" list on your profile keeps working unchanged.

## Technical notes

- `src/routes/_tabs.create.tsx`: `requiresApproval` initial state `true`.
- `src/routes/games.$gameId.index.tsx`: `requiresApproval` becomes `settings ? !!settings.requires_approval : true` so a missing settings row defaults to approval; verify `approvalCleared`, the CTA branches, and the payment gate all read from that value.
- New `src/components/games/HostJoinRequestsPanel.tsx` using existing `listHostJoinRequests` / `reviewJoinRequest` from `src/lib/payments.ts`, subscribed to `join_requests` realtime filtered by `host_id`.
- Migration: change `public.game_payment_settings.requires_approval` default to `true` (no data backfill needed — there are currently no rows).
- No changes to `validate_join_request` / `enforce_approval_before_payment`; they already enforce the pending → approved → pay order.
