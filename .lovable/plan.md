## Goal

Turn the current DMs (basic 1:1 threads with text + one attachment + read receipts) into an Instagram-style experience: live delivery with typing/presence, reactions, quote replies, sender unsend, and a Requests inbox for strangers. Ship in two phases so you can review before media/voice lands.

## Phase 1 — Realtime chat, reactions, reply, unsend, Requests inbox

### 1. Schema & backend (single migration)

New / changed columns on `public.messages`:
- `reply_to_id uuid null` — quoted parent message (self-FK, `on delete set null`)
- `deleted_at timestamptz null` — sender unsend timestamp (soft delete; row kept so reply chains and read cursors stay valid)
- `is_request boolean not null default false` — set when the recipient hasn't accepted the thread yet

New `public.message_reactions` table (one row per user per emoji per message):
- `message_id`, `user_id`, `emoji text` (constrained to a small allowlist ❤️😂😮😢🔥👍), PK `(message_id, user_id, emoji)`
- GRANTs to `authenticated`/`service_role`, RLS: participant of the parent message's conversation can `select`; user can `insert`/`delete` their own row

New `public.conversations` columns:
- `accepted_by uuid[] not null default '{}'` — user ids who accepted the thread (auto-populated for the creator; recipient added on Accept)

RPCs / triggers:
- `accept_conversation(_conv uuid)` — appends `auth.uid()` to `accepted_by` and flips `is_request=false` on that user's incoming messages
- `decline_conversation(_conv uuid)` — deletes the participant row for the caller so the thread disappears from their inbox
- `unsend_message(_id uuid)` — sets `deleted_at=now()` when `sender_id = auth.uid()`; blanks `body`/`attachment_*`
- Update the existing DM-notification path to skip inserting notifications when `is_request=true` (prevents Requests from spamming alerts)

Bucket / RLS: reuse `message-attachments` unchanged.

### 2. Realtime, typing, presence

- Extend the existing thread channel to also carry Postgres change events for `UPDATE` on `messages` (reactions/unsend echo) and `INSERT`/`DELETE` on `message_reactions`.
- Add a Supabase Realtime **presence** track per conversation channel: `{ user_id, typing: boolean, last_active }`. Typing state is set true on keystroke and cleared after 3s of idle; UI shows an animated "typing…" bubble.
- Inbox list subscribes to a per-user channel and updates last message/unread live.

### 3. UI — thread (`messages.$conversationId.tsx`)

Redesigned to mirror Instagram:
- Header: avatar, name, small "Active now" / "Active 5m ago" dot from presence.
- Message row: swipe-left (touch) or hover "Reply" button reveals; quoted parent renders as a compact card above the bubble with a subtle left border and the parent's snippet; tapping it scrolls to the original.
- Double-tap / long-press bubble opens a small floating reaction bar (❤️😂😮😢🔥👍). Reactions render as a chip under the bubble with count; tapping your own chip removes it.
- Sender-only bubble menu (long-press / three-dot on hover): **Unsend**, **Copy**, **Reply**. Unsend replaces the bubble with a muted "You unsent a message." tombstone for both sides (driven by `deleted_at`).
- Typing indicator: three-dot animated bubble on the left when the other user is typing.
- Read receipts: keep existing `read_at` behavior; render "Seen" under the last message you sent once the other user reads it.

### 4. UI — inbox (`messages.index.tsx`)

- Add tabs: **Messages** (default) and **Requests** (with a small count badge).
- A conversation goes to Requests for me when the other user sent the first message and I haven't accepted (checked via `accepted_by`).
- Requests row shows **Accept** / **Decline** buttons inline; Accept calls `accept_conversation` and moves the row into Messages.
- Rows show the presence dot on the avatar when the other user is online.

### 5. Client library (`src/lib/messages.ts`)

New helpers: `addReaction`, `removeReaction`, `unsendMessage`, `sendMessage(..., { replyToId })`, `acceptConversation`, `declineConversation`, `listRequests()`. Update `listMyConversations` to segment by `is_request`/`accepted_by`.

### 6. Verification

- `bun x tsgo --noEmit`
- Manual: sign in as two users in two windows on `/messages/<id>`; confirm live delivery, typing bubble, reactions, quote-reply, unsend tombstone, and Requests Accept/Decline flow.

## Phase 2 — Media & voice, inbox polish (kicks off after Phase 1 lands)

Sketch only, so you can steer scope later:

- **Media**: multi-image/video attachments per message, full-screen swipeable viewer with pinch-zoom, in-line video player, thumbnails in the composer preview strip.
- **Voice notes**: hold-to-record button (MediaRecorder → webm/opus), waveform preview, playhead scrubber, stored in `message-attachments/<conv>/<user>/voice-*.webm` with a new `attachment_kind='voice'` marker.
- **Inbox polish**: thread search across your DMs, per-thread mute + pin, sharing a game/host into a DM as a rich card, unread badge on the bottom-nav Messages tab.

## Technical notes

- Presence is scoped to each conversation channel and torn down in the effect cleanup so we don't leak subscriptions (Cloud Realtime billing rule).
- All new tables/columns follow the "CREATE → GRANT → ENABLE RLS → CREATE POLICY" order; reactions use participant checks via the existing `is_conversation_participant` helper to avoid recursion.
- Unsend keeps the message row so `reply_to_id` and last-message pointers remain stable; the client renders the tombstone when `deleted_at is not null`.
- No design system changes — reuses existing `bg-lime-gradient`, `bg-surface`, `border-border`, and shadcn primitives already in the app.
