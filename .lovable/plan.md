## Goal

One-click access to both direct messages and notifications from the bottom nav, and a cleaner nav bar without the elevated "+" host button.

## Changes

### 1. Unified Inbox (`/messages`)

Turn `src/routes/messages.index.tsx` into a two-tab surface:

- **Messages** tab — current conversation list (unchanged behavior).
- **Alerts** tab — the notification feed currently rendered by `src/routes/_tabs.notifications.tsx`.

Implementation:
- Extract the notification list body from `_tabs.notifications.tsx` into a reusable `<NotificationsPanel />` component (keeps its realtime subscription, push-permission banner, mark-as-read, and "Notification settings" link).
- Extract the conversation list body from `messages.index.tsx` into `<ConversationsPanel />`.
- In `messages.index.tsx`, render a shadcn `Tabs` header (`Messages` | `Alerts`) with unread-count badges pulled from the existing message/notification hooks.
- Persist the active tab in the URL via `validateSearch` (`?tab=messages|alerts`) so refresh and deep links keep the view.
- Header shows a single combined unread pill.

### 2. Redirect old Alerts route

- Keep `/notifications` working by redirecting `_tabs.notifications.tsx` to `/messages?tab=alerts` (via `beforeLoad`), so existing links from Feed and Players cards, push deep-links, and account settings still land correctly.
- Update the two in-app links (`src/routes/_tabs.feed.tsx:653`, `src/routes/_tabs.players.tsx:734`) to point at `/messages` with `search: { tab: "alerts" }`.

### 3. Bottom navigation cleanup (`src/components/BottomNav.tsx`)

- Remove the center elevated Host FAB (`Plus` button linking to `/create`) and its wrapper.
- Drop the `Plus` icon import and the `hostActive` variable.
- Collapse the left/right groups into a single evenly-spaced flex row containing: Play, Players, Teams, Trainers, Inbox, You (6 tabs).
- The Inbox tab label stays "Inbox"; its badge (already tracks unread messages) will now reflect messages + alerts combined via the shared unread hook.

Users can still create a game from the existing "Create game" button on the Feed header (added earlier) and from the profile/host surfaces — no other entry points change.

## Technical notes

- Unread count for the Inbox tab badge: sum of `useUnreadMessages` and `useUnreadNotifications` (already available in `src/lib/messages.ts` and `src/lib/notifications.ts`).
- Tabs state uses zod `validateSearch` with default `"messages"`, matching the URL-persistence pattern used elsewhere.
- Push notification deep-links that currently target `/notifications` continue to work via the redirect.
- No schema changes.

## Out of scope

- Merging message and notification data models.
- Changing notification preferences UI at `/account/notifications`.
