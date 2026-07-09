## Scope

Fix four broken/missing flows. Each touches the database + UI.

## 1. Notifications bell (header alert button)

- Audit current bell icon usage in the header / bottom nav; make it a real `<Link to="/notifications">` (mapped to `_tabs.notifications.tsx`).
- Build a `notifications` table (id, user_id, type, title, body, link, read_at, created_at) with RLS scoping to `auth.uid()`.
- Realtime subscription on the bell to show an unread dot/count.
- Notifications list page reads from the table, marks as read on click, deep-links to the related game/request/message.

## 2. Host approve/decline pickups (join requests)

Join requests already exist in DB (`join_requests` table + RLS). What's missing is UI.

- **Per-game section** on `games.$gameId.tsx`: if viewer is host, show pending join requests with Approve / Decline buttons + reviewer notes input.
- **Host dashboard route** `/host/requests` listing all pending requests across the host's games (filter tabs: Pending / Approved / Rejected).
- On approve/decline, insert a row into `notifications` for the player ("Your request to join X was approved/declined"), so the bell lights up.
- Approved players auto-added to the game roster.

## 3. Messaging (build from scratch)

- New tables:
  - `conversations` (id, created_at, last_message_at, context game_id nullable)
  - `conversation_participants` (conversation_id, user_id) — used for RLS membership
  - `messages` (id, conversation_id, sender_id, body, created_at, read_at)
- RLS: only participants can read/insert in a conversation.
- Realtime on `messages` for live updates.
- UI:
  - `/messages` — inbox list (sorted by last_message_at).
  - `/messages/$conversationId` — thread view with composer.
  - "Message host" button on game detail page → finds-or-creates a 1:1 conversation, navigates to thread.
- New-message arriving → notification row for the recipient.

## 4. Payment feature

The "Pay" CTA on the game detail page doesn't route to payment info. Fix:

- Audit `games.$gameId.tsx`: the Pay button should `<Link to="/games/$gameId/pay">` (route already exists at `games.$gameId.pay.tsx`).
- If the host has no `game_payment_settings` yet, surface the existing empty-state instead of failing silently.
- Host-side: ensure the "Set up payments" entry point on a hosted game routes to `games.$gameId.payment-setup.tsx`.
- Verify the join → pay → submit-proof flow end-to-end once routed.

## Tech notes

- All new tables: explicit `GRANT` to `authenticated` + `service_role`, RLS enabled, policies scoped to `auth.uid()`.
- Realtime via `ALTER PUBLICATION supabase_realtime ADD TABLE ...` for `messages` and `notifications`.
- All data access from client uses the browser `supabase` client (RLS-scoped); no server functions needed for this scope.
- No new design tokens; reuse existing `lime` / `coral` / `surface` styles.

## Out of scope

- Push notifications (browser/native) — in-app only.
- Group chat (only 1:1 for now).
- Editing/deleting sent messages.

Shall I proceed?